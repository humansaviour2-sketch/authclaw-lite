# AuthClaw Event Backbone

Kafka/MSK is the production backbone for audit and gateway telemetry. Postgres remains the signed audit chain of record; ClickHouse is the analytics copy populated from Kafka and reconciled by replay.

## Topics

| Topic | Partitions | Production retention | Key | Purpose |
| --- | ---: | ---: | --- | --- |
| `gateway.traffic` | 12 | 7 days | `tenant_id` | Gateway request audit events emitted by the Go proxy. |
| `audit.events` | 12 | 30 days | `tenant_id` | Backend workflow, evidence, finding, approval, remediation, and rollback events. |
| `audit.deadletter` | 6 | 90 days | `tenant_id` | Failed consumer payloads with error reason and original payload. |

Use `infra/kafka/topics.yaml` as the source of truth. Production MSK should use replication factor `3`. Local Redpanda compose uses replication factor `1`.

## Replay Policy

- Kafka replay: reset the `authclaw-audit-consumer` group offset for `gateway.traffic` or `audit.events`.
- Backfill replay: call `POST /v1/audit-logs/store/replay` to copy missing Postgres chain-of-record rows into ClickHouse.
- DLQ replay: fix the root cause, inspect `audit.deadletter`, then republish each `original_payload` to its source topic.

Consumers are idempotent by `record_id`. Redis claim keys prevent concurrent duplicate processing, and ClickHouse is checked before insert. Replays must not create duplicate ClickHouse rows for the same audit event.

## Failure Runbook

1. Check gateway `/metrics` for `authclaw_gateway_kafka_publish_failures_total`.
2. Check audit consumer `/metrics` for:
   - `audit_consumer_lag_<topic>_<partition>`
   - `audit_consumer_dlq_published_total`
   - `audit_consumer_clickhouse_insert_failures_total`
   - `audit_consumer_duplicate_events_total`
3. Inspect `audit.deadletter` and group failures by `error_reason`.
4. Check ClickHouse availability and insert permissions.
5. Run audit consistency:
   - `GET /v1/audit-logs/store/consistency`
6. Reconcile with backfill:
   - `POST /v1/audit-logs/store/replay` using `{"dry_run": true}`
   - then `{"dry_run": false}` after review.

## Local Topic Setup

`docker-compose.yml` includes `kafka-init`, which creates:

- `gateway.traffic`
- `audit.events`
- `audit.deadletter`

The Go gateway disables auto topic creation, so missing topics surface as publish failures instead of silently creating under-partitioned topics.
