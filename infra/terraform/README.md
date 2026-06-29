# AuthClaw Terraform

This directory is the SRS NFR-3.1 baseline for deploying AuthClaw as a multi-region AWS stack.

It creates a primary regional stack and, by default, a warm secondary regional stack. Each region includes:

- VPC with public/private subnets across availability zones
- Public ALB listeners for console, backend API, and gateway
- ECS/Fargate services for console, backend, gateway, OPA, and Presidio
- Private Cloud Map service discovery for internal service URLs
- Encrypted RDS PostgreSQL and encrypted ElastiCache Redis
- KMS key, Secrets Manager entries, and CloudWatch log groups
- Optional audit consumer wired to managed Kafka/MSK and ClickHouse endpoints
- Optional Route53 primary/secondary failover alias record

## Usage

Copy the example variables, set image tags and cloud-specific values, then plan:

```bash
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform plan -var-file=terraform.tfvars
```

The example defaults use `authclaw_env = "staging"` so the stack can be validated before production-only dependencies are configured. For a production deployment, set:

- `authclaw_env = "production"`
- `domain_name`
- `primary_certificate_arn`
- `secondary_certificate_arn`
- `smtp_host`
- `smtp_from`
- production image digests instead of floating `latest` tags

The OPA image must include the AuthClaw Rego policy bundle from `infra/opa`, or use an equivalent OPA bundle configuration baked into the image.

## Multi-Region Model

The root module deploys identical regional stacks with separate KMS keys, RDS instances, Redis clusters, ECS services, and secrets. Route53 failover can point the same public name at the primary or secondary ALB.

The Terraform intentionally does not choose a database replication strategy. Before declaring a production multi-region RTO/RPO, pick and test one of:

- RDS cross-region read replica with promoted secondary
- Aurora Global Database
- Backup/restore runbook with accepted RPO

## Audit Integrations

Kafka and ClickHouse are treated as managed external services:

- Set `kafka_brokers` for gateway/backend audit publication.
- Set `clickhouse_host`, `clickhouse_*`, and `enable_audit_consumer = true` to run the audit consumer.

This keeps the regional AuthClaw stack portable while still making the audit path explicit in IaC.

## Operations Notes

- The backend image should run migrations before serving traffic, either in its entrypoint or via a one-off ECS task using the same `backend_database_url` secret.
- Configure ACM certificates in every region where HTTPS listeners are used.
- Avoid committing real `*.tfvars` files; only `*.tfvars.example` is tracked.
