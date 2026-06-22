# AuthClaw Lite: AWS Free Tier Demo Deployment

This is the demo deployment path for the request:

> A customer logs in, their email/IP can be checked, they connect their chatbot provider key, then their chatbot sends AI traffic through an AuthClaw URL where governance and audits happen.

The full production migration remains in `MIGRATION_PLAN_GOVERNANCE_LAYER.md`. This document is intentionally smaller. It is meant for a `$120` credit demo/pilot, not enterprise production.

## What This Demo Proves

- AuthClaw has a hosted console URL.
- AuthClaw has a hosted gateway URL.
- A tenant/admin can log in.
- A provider key can be configured for demo traffic.
- A chatbot/API client can send requests through the AuthClaw gateway.
- AuthClaw can apply redaction/policy logic and produce audit logs.

## What This Demo Does Not Prove

- Multi-region production reliability.
- Full SOC 2 readiness.
- Managed Kafka/MSK.
- Managed ClickHouse at scale.
- WAF/Shield-grade enterprise protection.
- Heavy traffic or many customer tenants.

## Demo Architecture

Run one EC2 instance with Docker Compose:

```text
Internet
  |
  v
EC2 public IP or demo domain
  |
  +-- console  :3001
  +-- backend  :8000
  +-- gateway  :8080
  +-- postgres :5432
  +-- redis    :6379
  +-- opa      :8181
  +-- presidio :3000
```

Kafka and ClickHouse are omitted from the default demo compose to keep cost and memory down. The gateway already falls back to structured stdout audit logs when Kafka is unavailable.

## AWS Account Guardrails

Before deploying:

1. Create an AWS Budget alert at `$20`, `$60`, `$100`, and `$120`.
2. Use one low-cost region.
3. Do not enable Bedrock for this demo unless you intentionally want model charges.
4. Do not create NAT Gateway, EKS, MSK, or ElastiCache for the demo.
5. Stop the EC2 instance when not testing.
6. Use test/sandbox AI provider keys only.

## Suggested EC2 Shape

Start with:

- Ubuntu 24.04 LTS.
- `t3.small` or `t4g.small` if ARM builds work for your images.
- 20-30 GB gp3 EBS.
- Security group allowing:
  - SSH from your IP only.
  - `3001` for console demo.
  - `8080` for gateway demo.
  - `8000` only if you need direct API debugging.

For a cleaner demo domain later, put Caddy or Nginx on the same EC2 instance and reverse proxy:

- `https://app.yourdomain.com` -> `localhost:3001`
- `https://api.yourdomain.com` -> `localhost:8000`
- `https://gateway.yourdomain.com` -> `localhost:8080`

## Files Added For Demo

- `docker-compose.demo.yml`
- `.env.demo.example`
- `backend/Dockerfile.demo`
- `gateway/Dockerfile.demo`
- `console/Dockerfile.demo`
- `console/src/app/(console)/connect/page.tsx`

## Local Demo Run

From the repo root:

```powershell
Copy-Item .env.demo.example .env.demo
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
```

Seed the Lite demo tenant and starter policy:

```powershell
docker compose --env-file .env.demo -f docker-compose.demo.yml exec backend python scripts/seed_authclaw_lite.py
```

Seeded login/API key:

```text
Email: admin@authclaw-lite.demo
AuthClaw API key: acl_lite_demo_key
```

Open:

- Console: `http://localhost:3001`
- Backend health: `http://localhost:8000/health`
- Gateway health: `http://localhost:8080/health`
- Demo onboarding: `http://localhost:3001/connect`

## EC2 Demo Run

On the EC2 instance:

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker ubuntu
newgrp docker
git clone <your-repo-url> authclaw
cd authclaw
cp .env.demo.example .env.demo
nano .env.demo
docker compose --env-file .env.demo -f docker-compose.demo.yml up -d --build
docker compose --env-file .env.demo -f docker-compose.demo.yml exec backend python scripts/seed_authclaw_lite.py
```

Set these in `.env.demo` for a public EC2 test:

```text
NEXT_PUBLIC_API_URL=http://<ec2-public-ip>:8000
NEXT_PUBLIC_GATEWAY_URL=http://<ec2-public-ip>:8080
```

## Demo Success Checklist

- `docker ps` shows all demo containers running.
- `GET /health` works for backend.
- `GET /health` works for gateway.
- Console opens in browser.
- A tenant/admin/API key exists in Postgres.
- A test request sent to the gateway gets authenticated.
- A request with test PII triggers redaction behavior.
- A policy block returns a clear forbidden response.
- Gateway logs show structured audit events.

## Next Upgrade After Demo

Once this works, upgrade in this order:

1. Add real email verification and IP risk checks.
2. Add tenant provider credential vault.
3. Add domain + HTTPS reverse proxy.
4. Add ClickHouse/Kafka back for durable audit records.
5. Move Postgres from container to RDS.
6. Move app services from one EC2 instance to ECS/Fargate.
