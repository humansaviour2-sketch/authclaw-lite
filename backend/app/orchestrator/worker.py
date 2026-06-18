import logging
import uuid
from typing import Callable, Optional

logger = logging.getLogger("orchestrator.worker")


class EphemeralWorker:
    """
    Phase 9: Ephemeral Worker Framework.
    Simulates a short-lived worker process executing scans and remediations.
    """

    def __init__(
        self,
        tenant_id: str,
        workflow_id: str,
        request_id: str = "",
        emit_audit_fn: Optional[Callable] = None,
        callback_fn: Optional[Callable] = None,
    ):
        self.tenant_id = tenant_id
        self.workflow_id = workflow_id
        self.request_id = request_id
        self.emit_audit_fn = emit_audit_fn
        self.callback_fn = callback_fn
        self.connectors = {}

    def _emit_audit(self, transition: str, action: str, status: str) -> None:
        if self.emit_audit_fn:
            self.emit_audit_fn(
                self.workflow_id,
                self.tenant_id,
                self.request_id,
                transition,
                action,
                status,
            )
        else:
            logger.info(
                "[AUDIT MOCK] workflow=%s tenant=%s transition=%s action=%s status=%s",
                self.workflow_id,
                self.tenant_id,
                transition,
                action,
                status,
            )

    def _report_status(self, provider: str, action: str, status: str, details: str = "") -> None:
        if self.callback_fn:
            try:
                self.callback_fn(provider, action, status, details)
            except Exception as e:
                logger.error("Error invoking backend callback: %s", e)
        logger.info(
            "[CALLBACK] Worker for %s reported %s status: %s. Details: %s",
            provider,
            action,
            status,
            details,
        )

    def _simulate_container_lifecycle(self, provider: str, action: str) -> None:
        logger.info(
            "[DOCKER] Spawning ephemeral worker container for %s:%s with 15 min TTL...",
            provider,
            action,
        )
        logger.info(
            "[SECRET] Generating scoped temporary credentials (AWS STS/GCP Service Account/Azure SP)..."
        )

    def _simulate_container_cleanup(self, provider: str, action: str) -> None:
        logger.info(
            "[DOCKER] Cleaning up and terminating ephemeral worker container for %s:%s...",
            provider,
            action,
        )

    def run_scan(self, provider: str, framework: str) -> list[dict]:
        conn = self.connectors.get(provider.lower())
        if not conn:
            raise ValueError(f"Unsupported provider: {provider}")

        self._simulate_container_lifecycle(provider, "scan")
        self._emit_audit(
            f"WORKER_START_SCAN:{provider.upper()}",
            f"worker_scan_start:{provider}",
            "running",
        )
        self._report_status(provider, "scan", "running")

        try:
            findings = conn.scan(framework)
            self._report_status(provider, "scan", "completed", f"Found {len(findings)} findings")
            self._emit_audit(
                f"WORKER_COMPLETE_SCAN:{provider.upper()}",
                f"worker_scan_complete:{provider}",
                "success",
            )
            return findings
        except Exception as e:
            self._report_status(provider, "scan", "failed", str(e))
            self._emit_audit(
                f"WORKER_FAILED_SCAN:{provider.upper()}",
                f"worker_scan_failed:{provider}",
                "failed",
            )
            raise
        finally:
            self._simulate_container_cleanup(provider, "scan")

    def run_remediation(self, provider: str, finding_control: str) -> dict:
        conn = self.connectors.get(provider.lower())
        if not conn:
            raise ValueError(f"Unsupported provider: {provider}")

        self._simulate_container_lifecycle(provider, "remediate")
        self._emit_audit(
            f"WORKER_START_REMEDIATION:{provider.upper()}",
            f"worker_remediate_start:{provider}",
            "running",
        )
        self._report_status(provider, "remediate", "running")

        try:
            res = conn.execute_remediation(finding_control)
            self._report_status(
                provider, "remediate", "completed", f"Remediation status: {res.get('status')}"
            )
            self._emit_audit(
                f"WORKER_COMPLETE_REMEDIATION:{provider.upper()}",
                f"worker_remediate_complete:{provider}",
                "success",
            )
            return res
        except Exception as e:
            self._report_status(provider, "remediate", "failed", str(e))
            self._emit_audit(
                f"WORKER_FAILED_REMEDIATION:{provider.upper()}",
                f"worker_remediate_failed:{provider}",
                "failed",
            )
            raise
        finally:
            self._simulate_container_cleanup(provider, "remediate")
