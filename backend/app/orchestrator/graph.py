"""
Phase 8: LangGraph Compliance Orchestrator

Workflow states:
  GATHER_EVIDENCE → ANALYZE_COMPLIANCE → GENERATE_REMEDIATION_PLAN
  → AWAITING_APPROVAL → EXECUTE_REMEDIATION → VERIFY_RESULTS → COMPLETE

All state transitions emit audit events through the existing Kafka pipeline.
Workflow state is persisted to PostgreSQL for crash recovery.
"""

import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from enum import Enum
from typing import Any, Optional, TypedDict

from langgraph.graph import StateGraph, END
import os
from app.core.compliance_utils import calculate_severity

logger = logging.getLogger("orchestrator")


# ──────────────────────────────────────────────────────────────────────────────
# Workflow States
# ──────────────────────────────────────────────────────────────────────────────


class WorkflowState(str, Enum):
    GATHER_EVIDENCE = "GATHER_EVIDENCE"
    ANALYZE_COMPLIANCE = "ANALYZE_COMPLIANCE"
    GENERATE_REMEDIATION_PLAN = "GENERATE_REMEDIATION_PLAN"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    EXECUTE_REMEDIATION = "EXECUTE_REMEDIATION"
    VERIFY_RESULTS = "VERIFY_RESULTS"
    COMPLETE = "COMPLETE"
    FAILED = "FAILED"


class ExecutionStatus(str, Enum):
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


# ──────────────────────────────────────────────────────────────────────────────
# Graph State Schema
# ──────────────────────────────────────────────────────────────────────────────


class ComplianceState(TypedDict, total=False):
    """LangGraph state schema for the compliance workflow."""
    workflow_id: str
    tenant_id: str
    request_id: str
    framework: str  # GDPR, HIPAA, SOC2
    current_state: str
    findings: list[dict]
    risk_score: float
    remediation_plan: list[dict]
    approval_status: str
    approval_id: str
    execution_status: str
    execution_result: dict
    error_message: str
    retry_count: int
    started_at: str
    updated_at: str
    completed_at: str
    # Callbacks injected by the runner — graph nodes must only use state.get("_cb") pattern
    _emit_audit: Any  # callable(workflow_id, tenant_id, request_id, transition, action, status)
    _persist_state: Any  # callable(state) -> None
    _create_approval: Any  # callable(tenant_id, workflow_id, plan) -> approval_id
    _check_approval: Any  # callable(approval_id) -> status string
    # Phase 16: callable(tenant_id, workflow_id, framework, source_type, source_reference,
    #                     evidence_type, evidence_data, severity) -> None
    _store_evidence: Any
    # Phase 17: callable(tenant_id, workflow_id, evidence_id, framework, finding_type, source_reference, title, description, severity, status, risk_score, remediation_summary) -> None
    _store_finding: Any


# ──────────────────────────────────────────────────────────────────────────────
# Node Implementations
# ──────────────────────────────────────────────────────────────────────────────


def gather_evidence(state: ComplianceState) -> ComplianceState:
    """GATHER_EVIDENCE: Collect documents from S3 and scan for PII/PHI."""
    logger.info("[%s] Gathering evidence for %s", state["workflow_id"], state["framework"])
    
    tenant_id = state["tenant_id"]
    findings = []
    
    try:
        from app.orchestrator.connectors import DocumentScanner
        scanner = DocumentScanner()
        docs = scanner.list_documents(tenant_id)
        
        presidio_url = os.getenv("PRESIDIO_URL", "http://localhost:3000")
        if not presidio_url.endswith("/analyze"):
            presidio_url = f"{presidio_url.rstrip('/')}/analyze"
        import requests
        
        for doc in docs:
            try:
                # Fetch text
                text_content = scanner.fetch_and_extract_text(doc["object_key"], doc["file_name"])
                if not text_content.strip():
                    continue
                
                # Analyze with Presidio
                payload = {
                    "text": text_content,
                    "language": "en",
                    "entities": ["EMAIL_ADDRESS", "PERSON", "PHONE_NUMBER", "US_SSN", "CREDIT_CARD"]
                }
                resp = requests.post(presidio_url, json=payload, timeout=10)
                if resp.status_code == 200:
                    results = resp.json()
                    if results:
                        entity_types = list(set([r["entity_type"] for r in results]))
                        findings.append({
                            "control": doc["object_key"],
                            "description": f"Found {len(results)} sensitive entities in document",
                            "status": "non_compliant",
                            "evidence": f"Entities: {', '.join(entity_types)}",
                            "entity_count": len(results)
                        })
                        # Phase 16: store evidence via callback — no direct DB access here
                        store_fn = state.get("_store_evidence")
                        if store_fn:
                            try:
                                severity = calculate_severity(len(results))
                                store_fn(
                                    state["tenant_id"],
                                    state["workflow_id"],
                                    state["framework"],
                                    "s3_document",
                                    doc["object_key"],
                                    "pii_detected",
                                    {
                                        "object_key": doc["object_key"],
                                        "file_name": doc.get("file_name", ""),
                                        "entity_count": len(results),
                                        "entity_types": entity_types,
                                        "presidio_results": results,
                                    },
                                    severity,
                                )
                            except Exception as _ev_exc:
                                logger.warning(
                                    "Evidence storage failed for %s (non-fatal): %s",
                                    doc["object_key"], _ev_exc,
                                )
                    else:
                        findings.append({
                            "control": doc["object_key"],
                            "description": "Document contains no detected sensitive data",
                            "status": "compliant",
                            "evidence": "Clean scan",
                            "entity_count": 0
                        })
                        # Phase 16: store clean scan evidence via callback
                        store_fn = state.get("_store_evidence")
                        if store_fn:
                            try:
                                store_fn(
                                    state["tenant_id"],
                                    state["workflow_id"],
                                    state["framework"],
                                    "s3_document",
                                    doc["object_key"],
                                    "scan_result",
                                    {
                                        "object_key": doc["object_key"],
                                        "file_name": doc.get("file_name", ""),
                                        "entity_count": 0,
                                        "result": "clean",
                                    },
                                    "info",
                                )
                            except Exception as _ev_exc:
                                logger.warning(
                                    "Evidence storage failed for clean scan %s (non-fatal): %s",
                                    doc["object_key"], _ev_exc,
                                )
                else:
                    logger.warning("Presidio returned %d for %s", resp.status_code, doc["object_key"])
            except Exception as e:
                logger.error("Failed to process document %s: %s", doc["object_key"], e)
                
    except Exception as e:
        logger.error("Evidence gathering failed: %s", e)
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             "GATHER_EVIDENCE→ANALYZE_COMPLIANCE", "gather_evidence", "completed")
    
    persist = state.get("_persist_state")
    new_state = {
        **state,
        "findings": findings,
        "current_state": WorkflowState.ANALYZE_COMPLIANCE.value,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if persist:
        persist(new_state)
    return new_state


def analyze_compliance(state: ComplianceState) -> ComplianceState:
    """ANALYZE_COMPLIANCE: Score findings based on number of sensitive entities."""
    logger.info("[%s] Analyzing compliance for %s", state["workflow_id"], state["framework"])
    
    findings = state.get("findings", [])
    non_compliant = [f for f in findings if f.get("status") == "non_compliant"]
    total_entities = sum(f.get("entity_count", 0) for f in non_compliant)
    
    # Simple risk score: maxes out at 1.0 around 50 entities
    risk_score = min(1.0, total_entities / 50.0)
    if not findings:
        risk_score = 0.0
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             "ANALYZE_COMPLIANCE→GENERATE_REMEDIATION_PLAN", "analyze_compliance", "completed")
    
    persist = state.get("_persist_state")
    new_state = {
        **state,
        "risk_score": round(risk_score, 2),
        "current_state": WorkflowState.GENERATE_REMEDIATION_PLAN.value,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if persist:
        persist(new_state)
    return new_state


def generate_remediation_plan(state: ComplianceState) -> ComplianceState:
    """GENERATE_REMEDIATION_PLAN: Create REPORT ONLY remediation actions for documents with PII."""
    logger.info("[%s] Generating remediation plan", state["workflow_id"])
    
    findings = state.get("findings", [])
    non_compliant = [f for f in findings if f.get("status") == "non_compliant"]
    
    plan = []
    for finding in non_compliant:
        priority = "high" if state.get("risk_score", 0) > 0.5 else "medium"
        plan.append({
            "finding_control": finding["control"],
            "action": f"Review document and remove sensitive data ({finding['evidence']})",
            "priority": priority,
            "estimated_effort": "1 hour",
            "steps": [
                f"Locate document in S3: {finding['control']}",
                "Review the detected sensitive entities",
                "Manually redact or delete the file from S3 (Report Only Mode)"
            ],
        })
        
        store_finding_fn = state.get("_store_finding")
        if store_finding_fn:
            try:
                entity_count = finding.get("entity_count", 0)
                finding_severity = calculate_severity(entity_count)
                
                # Extract clean filename
                raw_control = finding["control"]
                file_name = raw_control.split("/")[-1] if "/" in raw_control else raw_control
                
                store_finding_fn(
                    state["tenant_id"],
                    state["workflow_id"],
                    None,  # evidence_id not tracked in state
                    state["framework"],
                    "PII_EXPOSURE",
                    finding["control"],
                    f"PII detected in {file_name}",
                    finding["description"],
                    finding_severity,
                    "OPEN",
                    state.get("risk_score", 0.0),
                    plan[-1]["action"] + "\n\nSteps:\n- " + "\n- ".join(plan[-1]["steps"])
                )
            except Exception as e:
                logger.warning("Finding storage failed (non-fatal): %s", e)
    
    # Scans execute without immediate approval, completing the scan stage
    next_state = WorkflowState.COMPLETE.value
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             "GENERATE_REMEDIATION_PLAN→COMPLETE", "generate_plan", "completed")
    
    persist = state.get("_persist_state")
    new_state = {
        **state,
        "remediation_plan": plan,
        "current_state": next_state,
        "execution_status": ExecutionStatus.COMPLETED.value,
        "completed_at": datetime.now(tz=timezone.utc).isoformat(),
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if persist:
        persist(new_state)
    return new_state


def awaiting_approval(state: ComplianceState) -> ComplianceState:
    """AWAITING_APPROVAL: Create or check a HITL approval request."""
    logger.info("[%s] Awaiting approval", state["workflow_id"])
    
    approval_id = state.get("approval_id")
    
    if not approval_id:
        # First entry: create the approval request
        create_fn = state.get("_create_approval")
        if create_fn:
            approval_id = create_fn(
                state["tenant_id"],
                state["workflow_id"],
                state.get("remediation_plan", []),
            )
        else:
            # No approval function — auto-approve for testing
            approval_id = str(uuid.uuid4())
        
        emit = state.get("_emit_audit")
        if emit:
            emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
                 "AWAITING_APPROVAL", "create_approval", "pending")
        
        persist = state.get("_persist_state")
        new_state = {
            **state,
            "approval_id": approval_id,
            "approval_status": "PENDING",
            "execution_status": ExecutionStatus.PAUSED.value,
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        if persist:
            persist(new_state)
        return new_state
    
    # Subsequent entry: check approval status
    check_fn = state.get("_check_approval")
    status = "PENDING"
    if check_fn:
        status = check_fn(approval_id)
    
    if status == "APPROVED":
        next_state = WorkflowState.EXECUTE_REMEDIATION.value
        exec_status = ExecutionStatus.RUNNING.value
    elif status == "REJECTED":
        next_state = WorkflowState.COMPLETE.value
        exec_status = ExecutionStatus.COMPLETED.value
    elif status == "EXPIRED":
        next_state = WorkflowState.COMPLETE.value
        exec_status = ExecutionStatus.COMPLETED.value
    else:  # PENDING — stay paused
        return {**state, "approval_status": status,
                "execution_status": ExecutionStatus.PAUSED.value,
                "updated_at": datetime.now(tz=timezone.utc).isoformat()}
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             f"AWAITING_APPROVAL→{next_state}", "approval_resolved", status.lower())
    
    persist = state.get("_persist_state")
    new_state = {
        **state,
        "approval_status": status,
        "current_state": next_state,
        "execution_status": exec_status,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if persist:
        persist(new_state)
    return new_state


def execute_remediation(state: ComplianceState) -> ComplianceState:
    """EXECUTE_REMEDIATION: Apply the approved remediation plan in REPORT ONLY mode."""
    logger.info("[%s] Executing remediation", state["workflow_id"])
    
    plan = state.get("remediation_plan", [])
    
    try:
        from app.orchestrator.connectors import DocumentScanner
        scanner = DocumentScanner()
    except Exception as e:
        logger.error("Failed to initialize DocumentScanner: %s", e)
        scanner = None
    
    details = []
    actions_successful = 0
    actions_failed = 0
    
    for action in plan:
        control = action.get("finding_control", "")
        if scanner:
            try:
                res = scanner.simulate_remediation(control, action.get("action", "Unknown action"))
                details.append(res)
                actions_successful += 1
            except Exception as e:
                details.append({
                    "connector": "S3Document",
                    "control": control,
                    "status": "failed",
                    "details": str(e)
                })
                actions_failed += 1
        else:
            details.append({
                "connector": "S3Document",
                "control": control,
                "status": "failed",
                "details": "Scanner not initialized"
            })
            actions_failed += 1
            
    result = {
        "actions_executed": len(plan),
        "actions_successful": actions_successful,
        "actions_failed": actions_failed,
        "details": details,
    }
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             "EXECUTE_REMEDIATION→VERIFY_RESULTS", "execute_remediation", "completed")
    
    persist = state.get("_persist_state")
    new_state = {
        **state,
        "execution_result": result,
        "current_state": WorkflowState.VERIFY_RESULTS.value,
        "updated_at": datetime.now(tz=timezone.utc).isoformat(),
    }
    if persist:
        persist(new_state)
    return new_state


def verify_results(state: ComplianceState) -> ComplianceState:
    """VERIFY_RESULTS: Verify that remediation was successful."""
    logger.info("[%s] Verifying results", state["workflow_id"])
    
    result = state.get("execution_result", {})
    failed = result.get("actions_failed", 0)
    
    if failed > 0:
        # Retry logic
        retry_count = state.get("retry_count", 0)
        if retry_count < 3:
            emit = state.get("_emit_audit")
            if emit:
                emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
                     "VERIFY_RESULTS→EXECUTE_REMEDIATION", "verify_results", "retry")
            persist = state.get("_persist_state")
            new_state = {
                **state,
                "current_state": WorkflowState.EXECUTE_REMEDIATION.value,
                "retry_count": retry_count + 1,
                "updated_at": datetime.now(tz=timezone.utc).isoformat(),
            }
            if persist:
                persist(new_state)
            return new_state
        # Max retries exceeded
        emit = state.get("_emit_audit")
        if emit:
            emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
                 "VERIFY_RESULTS→FAILED", "verify_results", "max_retries_exceeded")
        persist = state.get("_persist_state")
        new_state = {
            **state,
            "current_state": WorkflowState.FAILED.value,
            "execution_status": ExecutionStatus.FAILED.value,
            "error_message": "Max retries exceeded during verification",
            "updated_at": datetime.now(tz=timezone.utc).isoformat(),
        }
        if persist:
            persist(new_state)
        return new_state
    
    emit = state.get("_emit_audit")
    if emit:
        emit(state["workflow_id"], state["tenant_id"], state.get("request_id", ""),
             "VERIFY_RESULTS→COMPLETE", "verify_results", "passed")
    
    persist = state.get("_persist_state")
    now = datetime.now(tz=timezone.utc).isoformat()
    new_state = {
        **state,
        "current_state": WorkflowState.COMPLETE.value,
        "execution_status": ExecutionStatus.COMPLETED.value,
        "updated_at": now,
        "completed_at": now,
    }
    if persist:
        persist(new_state)
    return new_state


# ──────────────────────────────────────────────────────────────────────────────
# Routing logic
# ──────────────────────────────────────────────────────────────────────────────


def route_after_plan(state: ComplianceState) -> str:
    """Route after GENERATE_REMEDIATION_PLAN based on whether a plan exists."""
    if state.get("current_state") == WorkflowState.COMPLETE.value:
        return END
    return "awaiting_approval"


def route_after_approval(state: ComplianceState) -> str:
    """Route after AWAITING_APPROVAL based on approval status."""
    status = state.get("approval_status", "PENDING")
    if status == "APPROVED":
        return "execute_remediation"
    if status in ("REJECTED", "EXPIRED"):
        return END
    # PENDING — workflow pauses here
    return END  # Will be resumed later


def route_after_verify(state: ComplianceState) -> str:
    """Route after VERIFY_RESULTS — retry or complete."""
    cs = state.get("current_state", "")
    if cs == WorkflowState.EXECUTE_REMEDIATION.value:
        return "execute_remediation"  # retry
    if cs == WorkflowState.FAILED.value:
        return END
    return END  # COMPLETE


# ──────────────────────────────────────────────────────────────────────────────
# Build the graph
# ──────────────────────────────────────────────────────────────────────────────


def build_compliance_graph() -> StateGraph:
    """Build and compile the LangGraph compliance workflow."""
    graph = StateGraph(ComplianceState)

    # Add nodes
    graph.add_node("gather_evidence", gather_evidence)
    graph.add_node("analyze_compliance", analyze_compliance)
    graph.add_node("generate_remediation_plan", generate_remediation_plan)
    graph.add_node("awaiting_approval", awaiting_approval)
    graph.add_node("execute_remediation", execute_remediation)
    graph.add_node("verify_results", verify_results)

    # Set entry point
    graph.set_entry_point("gather_evidence")

    # Edges
    graph.add_edge("gather_evidence", "analyze_compliance")
    graph.add_edge("analyze_compliance", "generate_remediation_plan")
    graph.add_conditional_edges("generate_remediation_plan", route_after_plan,
                                {"awaiting_approval": "awaiting_approval", END: END})
    graph.add_conditional_edges("awaiting_approval", route_after_approval,
                                {"execute_remediation": "execute_remediation", END: END})
    graph.add_edge("execute_remediation", "verify_results")
    graph.add_conditional_edges("verify_results", route_after_verify,
                                {"execute_remediation": "execute_remediation", END: END})

    return graph.compile()
