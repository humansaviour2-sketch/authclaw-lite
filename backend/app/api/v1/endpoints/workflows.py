"""
Phase 8: Compliance Workflow API Endpoints

Provides REST endpoints for managing LangGraph compliance workflows:
  POST /v1/workflows       - Start a new compliance workflow
  GET  /v1/workflows/{id}  - Get workflow status
  POST /v1/workflows/{id}/resume - Resume a paused workflow
  POST /v1/workflows/{id}/approve - Approve a workflow's remediation plan
  POST /v1/workflows/recover - Recover interrupted workflows
"""

import logging
import uuid
from typing import Optional
import pyotp

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.core.auth import get_tenant_db, require_scopes
from app.db.models import PendingApproval, ComplianceWorkflow, User, ApprovalAudit
from app.orchestrator.runner import ComplianceWorkflowRunner
from datetime import datetime, timezone

logger = logging.getLogger("api.workflows")
router = APIRouter()


# ──────────────────────────────────────────────────────────────────────────────
# Request/Response schemas
# ──────────────────────────────────────────────────────────────────────────────


class WorkflowCreateRequest(BaseModel):
    framework: str = Field(..., description="Compliance framework: HIPAA, GDPR, SOC2")
    request_id: Optional[str] = Field(None, description="Optional request correlation ID")


class ApprovalRequest(BaseModel):
    totp_code: Optional[str] = Field(None, description="TOTP code or backup code for MFA validation")


class WorkflowResponse(BaseModel):
    workflow_id: str
    tenant_id: str
    framework: str
    current_state: str
    execution_status: str
    risk_score: Optional[float] = None
    findings: Optional[list] = None
    remediation_plan: Optional[list] = None
    approval_status: Optional[str] = None
    approval_id: Optional[str] = None
    execution_result: Optional[dict] = None
    error_message: Optional[str] = None
    retry_count: Optional[int] = 0
    started_at: Optional[str] = None
    updated_at: Optional[str] = None
    completed_at: Optional[str] = None


class RecoveryResponse(BaseModel):
    recovered: int
    results: list


# ──────────────────────────────────────────────────────────────────────────────
# Endpoints
# ──────────────────────────────────────────────────────────────────────────────


@router.post("", response_model=WorkflowResponse, status_code=201)
def create_workflow(
    body: WorkflowCreateRequest,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["write"]),
):
    """Start a new compliance workflow."""
    tenant_id = str(request.state.tenant_id)
    framework = body.framework.upper()

    if framework not in ("HIPAA", "GDPR", "SOC2"):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported framework: {framework}. Must be HIPAA, GDPR, or SOC2.",
        )

    try:
        runner = ComplianceWorkflowRunner(db)
        result = runner.start(
            tenant_id=tenant_id,
            framework=framework,
            request_id=body.request_id,
        )
        return WorkflowResponse(**result)
    except Exception as exc:
        logger.error("Failed to create workflow: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.get("/{workflow_id}", response_model=WorkflowResponse)
def get_workflow(
    workflow_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["read"]),
):
    """Get workflow status by ID."""
    tenant_id = str(request.state.tenant_id)

    runner = ComplianceWorkflowRunner(db)
    result = runner.get_status(workflow_id, tenant_id)

    if not result:
        raise HTTPException(status_code=404, detail="Workflow not found")

    return WorkflowResponse(**result)


@router.post("/{workflow_id}/resume", response_model=WorkflowResponse)
def resume_workflow(
    workflow_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["write"]),
):
    """Resume a paused workflow (typically after approval)."""
    tenant_id = str(request.state.tenant_id)

    try:
        runner = ComplianceWorkflowRunner(db)
        result = runner.resume(workflow_id, tenant_id)
        return WorkflowResponse(**result)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        logger.error("Failed to resume workflow: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


def _auto_expire_stale(db: Session, tenant_id: str, actor_id: uuid.UUID) -> None:
    """Helper to auto-expire stale PENDING approvals and write immutable logs."""
    now = datetime.now(timezone.utc)
    stale = db.query(PendingApproval).filter(
        PendingApproval.tenant_id == uuid.UUID(tenant_id),
        PendingApproval.status == "PENDING",
        PendingApproval.expires_at < now
    ).all()
    
    for approval in stale:
        approval.status = "EXPIRED"
        wf = db.query(ComplianceWorkflow).filter(
            ComplianceWorkflow.approval_id == approval.id
        ).first()
        if wf:
            wf.approval_status = "EXPIRED"
            wf.execution_status = "COMPLETED"
            
        audit = ApprovalAudit(
            id=uuid.uuid4(),
            tenant_id=uuid.UUID(tenant_id),
            approval_id=approval.id,
            actor_id=actor_id,
            action="EXPIRED",
            mfa_verified=False,
            mfa_timestamp=None,
        )
        db.add(audit)
    if stale:
        db.commit()


@router.post("/mfa/setup", status_code=200)
def mfa_setup(
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["admin"]),
):
    """Generate TOTP secret and 5 backup codes for the current admin user."""
    user_id = request.state.user_id
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
        
    secret = pyotp.random_base32()
    backup_codes = [pyotp.random_base32()[:8].lower() for _ in range(5)]
    
    user.mfa_secret = secret
    user.mfa_backup_codes = backup_codes
    user.mfa_enabled = True
    db.commit()
    
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user.email, issuer_name="AuthClaw")
    
    return {
        "mfa_secret": secret,
        "provisioning_uri": uri,
        "backup_codes": backup_codes,
        "mfa_enabled": True
    }


@router.post("/approvals/expire-stale", status_code=200)
def expire_stale_approvals(
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["admin"]),
):
    """Explicitly trigger expiration of all stale pending approvals."""
    tenant_id = str(request.state.tenant_id)
    user_id = request.state.user_id
    
    now = datetime.now(timezone.utc)
    stale = db.query(PendingApproval).filter(
        PendingApproval.tenant_id == uuid.UUID(tenant_id),
        PendingApproval.status == "PENDING",
        PendingApproval.expires_at < now
    ).all()
    
    expired_count = len(stale)
    if expired_count > 0:
        _auto_expire_stale(db, tenant_id, user_id)
        
    return {"expired_count": expired_count}


@router.post("/{workflow_id}/approve", response_model=WorkflowResponse)
def approve_workflow(
    workflow_id: str,
    request: Request,
    body: Optional[ApprovalRequest] = None,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["admin"]),
):
    """Approve a workflow's remediation plan and resume execution (MFA challenged)."""
    tenant_id = str(request.state.tenant_id)
    user_id = request.state.user_id
    
    # Run auto-expiry checks
    _auto_expire_stale(db, tenant_id, user_id)

    runner = ComplianceWorkflowRunner(db)
    status_dict = runner.get_status(workflow_id, tenant_id)

    if not status_dict:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if status_dict.get("execution_status") != "PAUSED":
        raise HTTPException(
            status_code=400,
            detail=f"Workflow is not awaiting approval (status={status_dict.get('execution_status')})",
        )

    approval_id = status_dict.get("approval_id")
    if not approval_id:
        raise HTTPException(status_code=400, detail="No approval associated with this workflow")

    approval = db.query(PendingApproval).filter(
        PendingApproval.id == uuid.UUID(approval_id),
    ).first()
    
    if not approval:
        raise HTTPException(status_code=404, detail="Approval record not found")

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Approval request is already resolved (status={approval.status})",
        )

    # Validate MFA if enabled on user
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="Approver user record not found")

    mfa_verified = False
    if user.mfa_enabled and user.mfa_secret:
        totp_code = None
        if body:
            totp_code = body.totp_code
        if not totp_code:
            totp_code = request.query_params.get("totp_code")
        if not totp_code:
            totp_code = request.headers.get("X-MFA-Code") or request.headers.get("X-TOTP-Code")

        if not totp_code:
            raise HTTPException(
                status_code=400,
                detail="MFA token required: user has MFA enabled"
            )

        totp = pyotp.TOTP(user.mfa_secret)
        if totp.verify(totp_code, valid_window=1):
            mfa_verified = True
        else:
            # Check backup codes
            backup_codes = user.mfa_backup_codes or []
            if totp_code in backup_codes:
                mfa_verified = True
                new_codes = [c for c in backup_codes if c != totp_code]
                user.mfa_backup_codes = new_codes
                db.commit()
            else:
                raise HTTPException(
                    status_code=400,
                    detail="Invalid MFA token or backup code"
                )

    # Update PendingApproval (non-transferable, bound to current user)
    approval.status = "APPROVED"
    approval.approver_id = user_id
    approval.approved_at = datetime.now(timezone.utc)
    approval.mfa_verified = mfa_verified
    approval.mfa_timestamp = datetime.now(timezone.utc) if mfa_verified else None

    # Sync workflow status
    wf = db.query(ComplianceWorkflow).filter(
        ComplianceWorkflow.workflow_id == workflow_id
    ).first()
    if wf:
        wf.approval_status = "APPROVED"
        
    # Write to immutable ApprovalAudit log
    audit = ApprovalAudit(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(tenant_id),
        approval_id=approval.id,
        actor_id=user_id,
        action="APPROVED",
        mfa_verified=mfa_verified,
        mfa_timestamp=datetime.now(timezone.utc) if mfa_verified else None,
    )
    db.add(audit)
    db.commit()

    # Resume workflow execution
    try:
        result = runner.resume(workflow_id, tenant_id)
        return WorkflowResponse(**result)
    except Exception as exc:
        logger.error("Failed to approve/resume workflow: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/{workflow_id}/reject", response_model=WorkflowResponse)
def reject_workflow(
    workflow_id: str,
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["admin"]),
):
    """Reject a workflow's remediation plan."""
    tenant_id = str(request.state.tenant_id)
    user_id = request.state.user_id

    runner = ComplianceWorkflowRunner(db)
    status_dict = runner.get_status(workflow_id, tenant_id)

    if not status_dict:
        raise HTTPException(status_code=404, detail="Workflow not found")

    if status_dict.get("execution_status") != "PAUSED":
        raise HTTPException(
            status_code=400,
            detail=f"Workflow is not awaiting approval (status={status_dict.get('execution_status')})",
        )

    approval_id = status_dict.get("approval_id")
    if not approval_id:
        raise HTTPException(status_code=400, detail="No approval associated with this workflow")

    approval = db.query(PendingApproval).filter(
        PendingApproval.id == uuid.UUID(approval_id),
    ).first()

    if not approval:
        raise HTTPException(status_code=404, detail="Approval record not found")

    if approval.status != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=f"Approval request is already resolved (status={approval.status})",
        )

    # Reject
    approval.status = "REJECTED"
    approval.approver_id = user_id
    approval.approved_at = datetime.now(timezone.utc)

    # Sync workflow status
    wf = db.query(ComplianceWorkflow).filter(
        ComplianceWorkflow.workflow_id == workflow_id
    ).first()
    if wf:
        wf.approval_status = "REJECTED"

    # Write to ApprovalAudit
    audit = ApprovalAudit(
        id=uuid.uuid4(),
        tenant_id=uuid.UUID(tenant_id),
        approval_id=approval.id,
        actor_id=user_id,
        action="REJECTED",
        mfa_verified=False,
        mfa_timestamp=None,
    )
    db.add(audit)
    db.commit()

    # Resume workflow (which wraps up since it's rejected)
    try:
        result = runner.resume(workflow_id, tenant_id)
        return WorkflowResponse(**result)
    except Exception as exc:
        logger.error("Failed to reject/resume workflow: %s", exc)
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/recover", response_model=RecoveryResponse)
def recover_workflows(
    request: Request,
    db: Session = Depends(get_tenant_db),
    _auth=require_scopes(["admin"]),
):
    """Recover all interrupted workflows for the current tenant."""
    tenant_id = str(request.state.tenant_id)

    runner = ComplianceWorkflowRunner(db)
    results = runner.recover_interrupted(tenant_id)

    return RecoveryResponse(
        recovered=len([r for r in results if r["status"] == "recovered"]),
        results=results,
    )
