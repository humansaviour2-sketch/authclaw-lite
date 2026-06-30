"""Shared event-backbone helpers for backend audit publishers."""

from __future__ import annotations

import json
import uuid
from collections import defaultdict
from typing import Any

AUDIT_EVENTS_TOPIC = "audit.events"
AUDIT_DLQ_TOPIC = "audit.deadletter"
GATEWAY_TRAFFIC_TOPIC = "gateway.traffic"

_EVENT_NAMESPACE = uuid.UUID("3bd78033-64da-4a48-bd4f-9c105da706c7")
_metrics: defaultdict[str, int] = defaultdict(int)


def stable_event_id(*, event_type: str, tenant_id: str, subject_id: str, action: str, trace: list[str] | None = None) -> str:
    identity = {
        "event_type": event_type,
        "tenant_id": tenant_id,
        "subject_id": subject_id,
        "action": action,
        "trace": trace or [],
    }
    canonical = json.dumps(identity, sort_keys=True, separators=(",", ":"))
    return str(uuid.uuid5(_EVENT_NAMESPACE, canonical))


def increment_metric(name: str, value: int = 1) -> None:
    _metrics[name] += value


def metrics_snapshot() -> dict[str, int]:
    return dict(_metrics)


def tenant_key(tenant_id: Any) -> str:
    return str(tenant_id or "")
