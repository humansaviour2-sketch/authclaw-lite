"""
GET /audit-logs — Paginated audit log retrieval with optional ClickHouse backend
and hash-chain integrity verification.

Primary backend: ClickHouse (when CLICKHOUSE_HOST is configured).
Fallback: PostgreSQL audit_log_metadata table (Phase 6 compatibility preserved).
"""

import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

import clickhouse_connect
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.auth import get_tenant_db, require_scopes
from app.db.models import AuditLogMetadata

logger = logging.getLogger(__name__)

router = APIRouter()

# ──────────────────────────────────────────────────────────────────────────────
# Response schemas
# ──────────────────────────────────────────────────────────────────────────────


class ClickHouseAuditEvent(BaseModel):
    record_id: str
    tenant_id: str
    timestamp: datetime
    actor_id: str
    actor_type: str
    action: str
    policy_id: str
    provider: str
    model: str
    reason: str
    prompt_count: int
    request_size: int
    response_status: int
    duration_ms: int
    frameworks_affected: List[str]
    execution_trace: str = "[]"
    request_id: str = ""  # propagated from X-Request-ID gateway header
    prior_hash: str
    integrity_hash: str
    # Populated when integrity_check=true
    chain_valid: Optional[bool] = None


class AuditLogsResponse(BaseModel):
    source: str  # "clickhouse" | "postgres"
    total: int
    records: List[Any]
    integrity_checked: bool = False


# ──────────────────────────────────────────────────────────────────────────────
# ClickHouse client factory
# ──────────────────────────────────────────────────────────────────────────────


def _get_clickhouse_client() -> Optional[clickhouse_connect.driver.Client]:
    """Return a ClickHouse client, or None if CLICKHOUSE_HOST is not configured.
    Bubbles up exceptions if host is configured but connection fails.
    """
    host = os.getenv("CLICKHOUSE_HOST")
    if not host:
        return None
    return clickhouse_connect.get_client(
        host=host,
        port=int(os.getenv("CLICKHOUSE_PORT", "8123")),
        database=os.getenv("CLICKHOUSE_DB", "authclaw"),
        username=os.getenv("CLICKHOUSE_USER", "authclaw"),
        password=os.getenv("CLICKHOUSE_PASSWORD", "authclaw"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Hash-chain verification
# ──────────────────────────────────────────────────────────────────────────────

_GENESIS_HASH = "GENESIS"
_EXCLUDED_FIELDS = {"prior_hash", "integrity_hash", "created_at", "chain_valid"}


import uuid
from datetime import datetime, timezone

def standardize_uuid(val: Any) -> str:
    if not val:
        return ""
    try:
        return str(uuid.UUID(str(val)))
    except ValueError:
        return str(val)

def standardize_timestamp(ts: Any) -> str:
    if isinstance(ts, (int, float)):
        dt = datetime.fromtimestamp(ts, tz=timezone.utc)
    elif isinstance(ts, str):
        dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
    elif isinstance(ts, datetime):
        dt = ts
    else:
        dt = datetime.now(tz=timezone.utc)
    
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    else:
        dt = dt.astimezone(timezone.utc)
    
    ms = dt.microsecond // 1000
    return f"{dt.strftime('%Y-%m-%dT%H:%M:%S')}.{ms:03d}Z"

def _canonical_json(record: dict) -> str:
    record_id = standardize_uuid(record.get("record_id"))
    tenant_id = standardize_uuid(record.get("tenant_id"))
    timestamp_str = standardize_timestamp(record.get("timestamp"))
    
    clean = {
        "record_id": record_id,
        "tenant_id": tenant_id,
        "timestamp": timestamp_str,
        "actor_id": str(record.get("actor_id", "")),
        "actor_type": str(record.get("actor_type", "")),
        "action": str(record.get("action", "")),
        "policy_id": str(record.get("policy_id", "")),
        "provider": str(record.get("provider", "")),
        "model": str(record.get("model", "")),
        "reason": str(record.get("reason", "")),
        "prompt_count": int(record.get("prompt_count", 0)),
        "request_size": int(record.get("request_size", 0)),
        "response_status": int(record.get("response_status", 0)),
        "duration_ms": int(record.get("duration_ms", 0)),
        "frameworks_affected": sorted(list(record.get("frameworks_affected") or [])),
        "execution_trace": str(record.get("execution_trace", "[]")),
        "request_id": str(record.get("request_id", "")),
    }
    return json.dumps(clean, sort_keys=True, separators=(",", ":"))


def _verify_chain(records: List[dict]) -> List[dict]:
    """Annotate each record with chain_valid=True/False (verifying chronologically)."""
    # Reverse records to go oldest -> newest for rolling verification
    asc_records = list(reversed(records))
    prior_by_tenant: Dict[str, str] = {}

    for record in asc_records:
        tenant_id = record.get("tenant_id", "")
        if tenant_id not in prior_by_tenant:
            prior_by_tenant[tenant_id] = record.get("prior_hash", _GENESIS_HASH)
        prior_hash = prior_by_tenant[tenant_id]
        data = _canonical_json(record) + prior_hash
        expected = hashlib.sha256(data.encode("utf-8")).hexdigest()
        actual = record.get("integrity_hash", "")
        record["chain_valid"] = expected == actual
        prior_by_tenant[tenant_id] = actual or expected

    # Reverse back to keep original order (newest first)
    return list(reversed(asc_records))


# ──────────────────────────────────────────────────────────────────────────────
# Endpoint
# ──────────────────────────────────────────────────────────────────────────────


@router.get(
    "",
    response_model=AuditLogsResponse,
    dependencies=[require_scopes(["read"])],
)
def get_audit_logs(
    request: Request,
    db: Session = Depends(get_tenant_db),
    limit: int = Query(default=100, le=1000, ge=1),
    offset: int = Query(default=0, ge=0),
    action: Optional[str] = Query(default=None, description="Filter by action: allow|block"),
    integrity_check: bool = Query(
        default=False,
        description="If true, verify SHA-256 hash chain and annotate each record with chain_valid",
    ),
):
    """
    Retrieve audit log records, tenant-scoped.

    - Primary source: ClickHouse (if CLICKHOUSE_HOST env var is set).
    - Fallback: PostgreSQL audit_log_metadata table.
    - Set integrity_check=true to verify the SHA-256 hash chain.
    """
    tenant_id: str = str(request.state.tenant_id)

    # ── ClickHouse path ────────────────────────────────────────────────────────
    host = os.getenv("CLICKHOUSE_HOST")
    if host:
        try:
            ch = _get_clickhouse_client()
            if ch is not None:
                return _query_clickhouse(ch, tenant_id, limit, offset, action, integrity_check)
        except Exception as exc:
            logger.error("ClickHouse connection or query failed: %s", exc)
            raise HTTPException(
                status_code=503,
                detail=f"ClickHouse audit storage configured but unavailable: {str(exc)}"
            )

    # ── PostgreSQL fallback ────────────────────────────────────────────────────
    return _query_postgres(db, tenant_id, limit, offset, action)


# ──────────────────────────────────────────────────────────────────────────────
# ClickHouse query
# ──────────────────────────────────────────────────────────────────────────────


def _query_clickhouse(
    ch: clickhouse_connect.driver.Client,
    tenant_id: str,
    limit: int,
    offset: int,
    action: Optional[str],
    integrity_check: bool,
) -> AuditLogsResponse:
    action_filter = "AND action = {action:String}" if action else ""
    params: dict = {"tenant_id": tenant_id, "limit": limit, "offset": offset}
    if action:
        params["action"] = action

    query = f"""
        SELECT
            toString(ae.record_id)    AS record_id,
            toString(ae.tenant_id)    AS tenant_id,
            ae.timestamp              AS timestamp,
            ae.actor_id               AS actor_id,
            ae.actor_type             AS actor_type,
            ae.action                 AS action,
            ae.policy_id              AS policy_id,
            ae.provider               AS provider,
            ae.model                  AS model,
            ae.reason                 AS reason,
            ae.prompt_count           AS prompt_count,
            ae.request_size           AS request_size,
            ae.response_status        AS response_status,
            ae.duration_ms            AS duration_ms,
            ae.frameworks_affected    AS frameworks_affected,
            ae.execution_trace        AS execution_trace,
            ae.request_id             AS request_id,
            ae.prior_hash             AS prior_hash,
            ae.integrity_hash         AS integrity_hash
        FROM authclaw.audit_events AS ae
        WHERE ae.tenant_id = {{tenant_id:UUID}}
        {action_filter}
        ORDER BY ae.timestamp DESC, ae.record_id DESC
        LIMIT {{limit:UInt32}}
        OFFSET {{offset:UInt32}}
    """

    try:
        count_query = f"SELECT count(*) FROM authclaw.audit_events AS ae WHERE ae.tenant_id = {{tenant_id:UUID}} {action_filter}"
        count_result = ch.query(count_query, parameters=params)
        total_count = count_result.result_rows[0][0] if count_result.result_rows else 0

        result = ch.query(query, parameters=params)
    except Exception as exc:
        logger.error("ClickHouse query failed: %s", exc)
        raise HTTPException(status_code=503, detail="Audit storage temporarily unavailable")

    columns = result.column_names
    records = [dict(zip(columns, row)) for row in result.result_rows]

    # Normalise datetime objects to ISO strings for Pydantic
    for rec in records:
        if isinstance(rec.get("timestamp"), datetime):
            rec["timestamp"] = rec["timestamp"].isoformat()

    if integrity_check:
        records = _verify_chain(records)

    return AuditLogsResponse(
        source="clickhouse",
        total=total_count,
        records=records,
        integrity_checked=integrity_check,
    )


# ──────────────────────────────────────────────────────────────────────────────
# PostgreSQL fallback
# ──────────────────────────────────────────────────────────────────────────────


def _query_postgres(
    db: Session,
    tenant_id: str,
    limit: int,
    offset: int,
    action: Optional[str],
) -> AuditLogsResponse:
    """Fallback: query PostgreSQL audit_log_metadata for Phase 6 compatibility."""
    try:
        q = db.query(AuditLogMetadata).filter(
            AuditLogMetadata.tenant_id == tenant_id
        )
        if action:
            q = q.filter(AuditLogMetadata.action == action)
        
        total_count = q.count()
        logs = q.offset(offset).limit(limit).all()

        records = [
            {
                "id": str(log.id),
                "record_id": str(log.record_id),
                "action": log.action,
                "frameworks_affected": log.frameworks_affected,
                "created_at": log.created_at.isoformat() if log.created_at else None,
            }
            for log in logs
        ]
        return AuditLogsResponse(
            source="postgres",
            total=total_count,
            records=records,
            integrity_checked=False,
        )
    except Exception as exc:
        logger.error("PostgreSQL audit query failed: %s", exc)
        raise HTTPException(status_code=500, detail="Audit log query failed")
