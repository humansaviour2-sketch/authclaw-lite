# AuthClaw Multi-Region DR Runbook

This runbook covers the Terraform-managed RDS cross-region read-replica model for SRS NFR-3.1.

## Normal State

- Primary region ECS services write to the primary RDS PostgreSQL instance.
- Secondary region ECS services point at the secondary RDS read replica.
- The secondary database remains read-only until promotion.
- Route53 failover records may exist, but database failover is not complete until the replica is promoted.

## Failover Preconditions

- Confirm the primary region outage or planned failover decision.
- Check RDS replica lag in the secondary region.
- Confirm the secondary ECS services, OPA, Presidio, Redis, and ALB are healthy.
- Pause background jobs or remediation workers in the primary region if it is still partially reachable.

## Promotion Flow

1. Promote the secondary RDS read replica in the AWS console or with AWS CLI:

```bash
aws rds promote-read-replica \
  --region <secondary-region> \
  --db-instance-identifier <secondary-db-identifier>
```

2. Wait until the promoted database is `available`.

3. Confirm the promoted endpoint accepts writes:

```bash
psql "$DATABASE_URL" -c "create table if not exists dr_write_probe(id text primary key);"
psql "$DATABASE_URL" -c "insert into dr_write_probe(id) values ('promotion-check') on conflict do nothing;"
```

4. Run pending migrations against the promoted database if the app version changed since the last verified standby test.

5. Route traffic to the secondary ALB:

- If Route53 failover is manual, update the active record.
- If Route53 health-based failover is enabled, confirm the secondary ALB target is healthy and primary is withdrawn.

6. Verify AuthClaw health:

```bash
curl -fsS https://<domain>/api/lite-health
curl -fsS https://<domain>:8000/health
curl -fsS https://<domain>:8080/health
```

7. Create a post-failover incident record with:

- promotion start and completion time
- observed replica lag
- Route53 switch time
- p95/p99 gateway latency after failover
- audit-chain verification result

## Failback

Treat failback as a new planned migration:

- Create a new replica from the promoted secondary back to the original primary region.
- Verify replication lag and application compatibility.
- Schedule a maintenance window.
- Promote/switch only after write quiescence and audit-chain verification.

Do not point traffic back at the old primary database unless it has been rebuilt or resynchronized from the promoted database.
