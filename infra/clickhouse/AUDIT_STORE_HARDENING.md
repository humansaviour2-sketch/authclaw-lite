# AuthClaw Audit Store Hardening

PostgreSQL is the tenant-scoped chain of record for audit integrity. ClickHouse is the production analytics copy used for high-volume reads, dashboards, and reporting. Every ClickHouse row must preserve the Postgres `prior_hash` and `integrity_hash` values exactly.

## Runtime Paths

- Gateway writes signed audit metadata to Postgres synchronously as the chain of record.
- Gateway also publishes audit events to Kafka when configured.
- The audit consumer appends Kafka audit events to `authclaw.audit_events` in ClickHouse.
- The backend audit API reads from ClickHouse when `CLICKHOUSE_HOST` is configured, and falls back to Postgres when it is not.
- Replay can backfill missing ClickHouse rows from Postgres without recomputing or replacing chain hashes.

## Operational Endpoints

All endpoints are tenant-scoped through the authenticated API key.

- `GET /v1/audit-logs/store/status`
  - Reports whether ClickHouse is configured and reachable.
  - Confirms that Postgres remains the chain of record.

- `GET /v1/audit-logs/store/consistency`
  - Compares Postgres audit metadata against the ClickHouse copy.
  - Reports counts, missing ClickHouse record IDs, extra ClickHouse record IDs, hash mismatches, and chain validity for both stores.

- `POST /v1/audit-logs/store/replay`
  - Owner/admin only.
  - Body: `{"dry_run": true}` previews records that would be inserted.
  - Body: `{"dry_run": false}` inserts only rows missing from ClickHouse.

Recommended backfill procedure:

1. Run `POST /v1/audit-logs/store/replay` with `{"dry_run": true}`.
2. Run `GET /v1/audit-logs/store/consistency` and review missing/mismatch fields.
3. Run replay with `{"dry_run": false}`.
4. Run consistency again and require `consistent: true`.

## Append-Only Controls

`infra/clickhouse/init.sql` creates two roles:

- `authclaw_audit_writer`: `INSERT` and `SELECT` on `authclaw.audit_events`.
- `authclaw_audit_reader`: `SELECT` on `authclaw.audit_events` and `authclaw.audit_events_daily`.

Do not grant `ALTER`, `DELETE`, `TRUNCATE`, `DROP`, or `OPTIMIZE` to application users. Create environment-specific users and assign exactly one role:

```sql
GRANT authclaw_audit_writer TO authclaw_audit_ingest;
GRANT authclaw_audit_reader TO authclaw_audit_analytics;
```

Administrative break-glass accounts should be separate from app credentials, audited externally, and unavailable to normal service workloads.

## Schema Coverage

Both Postgres and ClickHouse now carry the canonical audit fields required for gateway, approval, remediation, rollback, and framework-impact reporting:

- `actor_id`
- `actor_type`
- `action`
- `policy_id`
- `provider`
- `model`
- `reason`
- `prompt_count`
- `request_size`
- `response_status`
- `duration_ms`
- `frameworks_affected`
- `execution_trace`
- `request_id`
- `prior_hash`
- `integrity_hash`

`execution_trace` stores compact JSON for workflow/action attempt context such as remediation action attempts and rollback events. `frameworks_affected` remains an array so compliance dashboards can aggregate directly in ClickHouse.
