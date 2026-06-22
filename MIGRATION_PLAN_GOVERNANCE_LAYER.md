# AuthClaw Migration Plan: Platform to AI Governance Layer

## 0. Demo-First Note

This document describes the full governance-layer destination. For a `$120` AWS credit demo, do not start with the full production deployment in Phase 5. Start with the lightweight pilot path in `AWS_FREE_TIER_DEMO_DEPLOYMENT.md`, prove the hosted console + gateway + audit flow, then graduate pieces into the production architecture.

For the active demo scope and feature checklist, use `AUTHCLAW_LITE_FEATURES.md`.

## 1. Decision

AuthClaw should be repositioned from a standalone AI/compliance platform into a hosted AI governance layer.

The customer should not have to move their chatbot or application logic into AuthClaw. They should keep their own app, their own provider account, and their own chatbot API code. AuthClaw becomes the runtime checkpoint between their application and the AI model provider.

Target positioning:

> Customer app -> AuthClaw Governance Gateway -> OpenAI / Anthropic / Gemini / Azure / Bedrock

AuthClaw owns:

- Login, tenant isolation, user/RBAC/MFA controls.
- Email and IP risk checks before console access.
- Encrypted storage of customer provider credentials.
- Gateway URL customers use as their AI base URL.
- PII/PHI redaction, policy enforcement, rate limits, model allowlists.
- Runtime audit logs, compliance evidence, findings, reports, and HITL approvals.
- AWS production hosting and public URLs.

Customers own:

- Their chatbot/application.
- Their AI provider account and API keys.
- Their business workflows.
- Their final policy decisions and approvals.

## 2. What We Keep From The Current Build

The current repository already contains most of the product spine required for this direction:

- Multi-tenant PostgreSQL schema with RLS.
- API key model and `resolve_api_key` based auth.
- Go gateway with tenant auth, provider routing, redaction, OPA policy checks, audit emission, and Bedrock support.
- FastAPI control plane for tenants, gateway configs, policies, redaction maps, audit logs, users, API keys, workflows, AWS, evidence, and findings.
- Next.js console with login, dashboard, gateway, policies, agent, audit, frameworks, AWS, evidence, findings, and settings pages.
- ClickHouse/Kafka/audit consumer structure.
- LangGraph compliance workflow and HITL approval model.
- Phase 13+ notes for audit inspector, chat memory, RAG, AWS integration, Playwright, smoke tests, and CI.

This means the migration is not a restart. It is a product-shape correction and deployment hardening effort.

## 3. New Customer Flow

### 3.1 Signup And Login

1. Customer visits the hosted AuthClaw console URL.
2. User enters email and password, magic link, or SSO.
3. AuthClaw validates the email:
   - Syntax and domain validation.
   - MX/domain existence check.
   - Disposable email/domain blocklist.
   - Email ownership verification using OTP or magic link.
   - Enterprise domain verification for company tenants when needed.
4. AuthClaw evaluates login IP risk:
   - Rate limiting by IP, email, and tenant.
   - VPN/proxy/Tor/datacenter ASN signal where available.
   - Geo-velocity and impossible-travel checks.
   - Tenant IP allowlist or denylist.
   - Suspicious-login MFA challenge.
5. If risk is acceptable, user gets a tenant-scoped session.
6. All auth/risk decisions are written into the audit trail.

### 3.2 Customer Onboarding

1. AuthClaw creates a tenant.
2. Admin verifies company/domain ownership.
3. Admin adds team users and roles.
4. Admin creates one or more AuthClaw gateway keys.
5. Admin connects model providers:
   - OpenAI API key.
   - Anthropic API key.
   - Gemini API key.
   - Azure OpenAI endpoint/key.
   - AWS Bedrock role or credentials through STS/assume role.
6. Provider credentials are envelope-encrypted and stored per tenant.
7. Admin configures routes:
   - Provider.
   - Endpoint/base URL.
   - Allowed models.
   - Redaction strategy.
   - Policy set.
   - Rate limits.
8. AuthClaw generates integration instructions:
   - Gateway base URL.
   - AuthClaw API key.
   - Provider header or route name.
   - Example curl, Node, Python, and chatbot config snippets.

### 3.3 Runtime Usage

The customer updates their chatbot/application to call AuthClaw instead of calling the AI provider directly.

Example:

```text
Old:
https://api.openai.com/v1/chat/completions

New:
https://gateway.authclaw.ai/v1/chat/completions
```

Request pattern:

```http
Authorization: Bearer <authclaw_gateway_key>
X-Provider: openai
X-Request-ID: <optional-customer-request-id>
Content-Type: application/json
```

AuthClaw then:

1. Validates the AuthClaw gateway key.
2. Resolves tenant and route config.
3. Loads the tenant's encrypted provider credential.
4. Redacts sensitive data.
5. Evaluates policy.
6. Forwards the sanitized request to the provider.
7. Processes the response, including streaming where supported.
8. Writes audit/evidence/finding records.
9. Returns the provider-compatible response to the customer app.

The customer's app sees AuthClaw as a provider-compatible gateway, not a separate platform they must rebuild around.

## 4. Current Gaps To Close

| Area | Current state | Required migration |
| --- | --- | --- |
| Console login | Login is API-key based. | Add real user auth: email verification, password or magic link, optional SSO, MFA, session lifecycle. |
| Email validity | Not a first-class login control. | Add email syntax/domain/MX/disposable checks plus OTP or magic-link proof. |
| IP validity/risk | Not a first-class login control. | Add IP reputation/risk scoring, rate limits, allowlists, audit events, and MFA challenge escalation. |
| Provider credentials | Some provider keys are environment-driven, for example Gemini. | Store customer provider keys per tenant using envelope encryption and inject upstream credentials from the gateway. |
| Gateway config | Gateway has routing logic and DB auth, but provider credentials and routes need to be fully tenant-driven. | Gateway must resolve active tenant route by provider/path/model and never rely on global provider secrets for customer traffic. |
| Hosted URL | Local startup guide only. | Deploy backend, gateway, console, worker/audit services, databases, Kafka/ClickHouse, and DNS on AWS. |
| Customer integration | Gateway README has local curl examples. | Add onboarding UI, SDK examples, provider-compatible docs, and copyable endpoint snippets. |
| Audit/evidence | Strong base exists. | Ensure every login, config change, gateway request, policy decision, redaction, credential access, and report export is audit-linked. |
| Production security | Partial hardening plan exists. | Add secrets, WAF, KMS, TLS, monitoring, CI/CD, backup, disaster recovery, and pentest readiness. |

## 5. Target Architecture On AWS

### 5.1 Public Endpoints

- `https://app.authclaw.ai` -> Next.js console.
- `https://api.authclaw.ai` -> FastAPI control plane.
- `https://gateway.authclaw.ai` -> Go governance gateway.
- Optional tenant vanity domains later, for example `https://acme.gateway.authclaw.ai`.

### 5.2 AWS Services

Recommended production baseline:

- VPC with public and private subnets across at least 2 AZs.
- AWS ALB for public HTTPS ingress.
- AWS WAF on public endpoints.
- ECS Fargate or EKS for services:
  - Go gateway.
  - FastAPI backend.
  - Next.js console.
  - Audit consumer.
  - Workers/orchestrator.
- RDS PostgreSQL for tenant metadata and app state.
- ElastiCache Redis for sessions, rate limits, caches, and risk throttling.
- MSK or Amazon Managed Streaming for Apache Kafka, or a lighter queue first if Kafka ops are too heavy for MVP.
- ClickHouse Cloud or self-managed ClickHouse on ECS/EC2 for audit analytics.
- AWS KMS for envelope encryption.
- AWS Secrets Manager for service secrets.
- CloudWatch logs/metrics/alarms.
- S3 for signed audit exports and compliance report artifacts.
- Route 53 and ACM certificates for DNS/TLS.

### 5.3 Minimum MVP Deployment Topology

For a first hosted pilot:

- ECS Fargate for all stateless services.
- RDS PostgreSQL.
- ElastiCache Redis.
- ClickHouse single production cluster or ClickHouse Cloud.
- Kafka-compatible managed service, or defer Kafka if audit writes can be made reliable through direct append plus retry queue.
- ALB + WAF + ACM + Route 53.
- GitHub Actions or equivalent CI/CD to build, scan, migrate, and deploy.

## 6. Migration Phases

### Phase 0: Product Reframe And Cutover Inventory

Goal: Freeze the new direction and avoid building features that make AuthClaw look like a replacement chatbot platform.

Tasks:

- Rename product language from "platform app shell" to "AI governance gateway/layer" across docs and UI where relevant.
- Define the canonical customer integration contract:
  - Gateway URL.
  - AuthClaw gateway key.
  - Provider selector.
  - Route config.
  - Audit correlation ID.
- Identify all places currently using global provider env vars.
- Identify which console pages support governance-layer onboarding and which are secondary.
- Create migration tickets from this document.

Exit criteria:

- Everyone agrees AuthClaw is a hosted governance layer.
- Customer integration contract is documented.
- No new work starts that requires customers to rebuild their chatbot inside AuthClaw.

### Phase 1: Real Identity, Email, And IP Risk

Goal: A user can safely log in to AuthClaw with a verified email and risk-checked IP.

Backend tasks:

- Add auth tables or extend existing users:
  - `email_verified_at`
  - `password_hash` or magic-link token state
  - `last_login_ip`
  - `last_login_user_agent`
  - `risk_level`
  - `locked_until`
- Add login audit events:
  - login_started
  - email_verified
  - login_allowed
  - login_blocked
  - mfa_challenged
  - ip_risk_detected
- Add email validation service:
  - syntax validation
  - domain/MX validation
  - disposable domain detection
  - OTP or magic-link proof
- Add IP risk service:
  - request IP extraction behind ALB/proxy
  - allowlist/denylist
  - throttling
  - risk scoring
  - MFA escalation
- Update FastAPI auth middleware to support user sessions for console APIs and API keys for machine/gateway APIs.

Console tasks:

- Replace API-key-only login with email-first login.
- Add OTP/magic-link verification screen.
- Add MFA challenge screen.
- Show blocked/risky login states clearly.

Exit criteria:

- User cannot access console until email ownership is proven.
- Suspicious IP can be blocked or challenged.
- Every auth decision is auditable.
- Existing gateway API-key auth still works for runtime traffic.

### Phase 2: Tenant Provider Credential Vault

Goal: Customers can paste their chatbot/provider API keys into AuthClaw once, and the gateway can use them safely.

Backend tasks:

- Add `provider_credentials` table:
  - id
  - tenant_id
  - provider
  - display_name
  - encrypted_secret
  - kms_key_id
  - auth_scheme
  - endpoint
  - status
  - last_verified_at
  - created_by
  - created_at
  - rotated_at
- Encrypt secrets with AWS KMS envelope encryption.
- Add CRUD APIs:
  - create credential
  - test credential
  - rotate credential
  - revoke credential
  - list metadata only
- Never return raw provider secrets after creation.
- Audit all credential create/test/use/rotate/revoke events.

Gateway tasks:

- Resolve tenant provider credential by active route.
- Inject provider credential into upstream request.
- Remove customer-supplied provider credentials from inbound request before logging.
- Ensure provider keys are never logged.

Console tasks:

- Add "Integrations -> Model Providers" onboarding.
- Add credential health status.
- Add key rotation flow.

Exit criteria:

- Customer can configure OpenAI/Anthropic/Gemini/Azure/Bedrock credentials per tenant.
- Gateway can call providers without global env keys.
- Provider secret access is audited and scrubbed.

### Phase 3: Gateway As The Product Surface

Goal: The hosted AuthClaw URL is the thing customers integrate with.

Gateway tasks:

- Make route resolution fully tenant-driven:
  - tenant
  - provider
  - model
  - path
  - redaction strategy
  - policy set
  - credential reference
  - rate limit tier
- Add stable provider-compatible paths:
  - `/v1/chat/completions`
  - `/v1/messages`
  - Gemini-compatible path support
  - Bedrock route support where applicable
- Add request correlation:
  - `X-Request-ID`
  - tenant request ID
  - provider request ID if returned
- Add hard failure modes:
  - missing credential
  - inactive route
  - model not allowed
  - tenant suspended
  - policy blocked
  - rate limit exceeded

Backend tasks:

- Update gateway config model to reference provider credentials.
- Add route test endpoint.
- Add usage counters and rate limits per tenant/key/route.

Console tasks:

- Build "Connect Your Chatbot" onboarding page:
  - copy gateway URL
  - copy AuthClaw API key
  - select provider
  - show curl/Node/Python examples
  - run test request
  - display first audit event

Exit criteria:

- A customer can update only their base URL and auth header, then run traffic through AuthClaw.
- The first request appears in audit logs with redaction/policy status.
- The customer does not need to use AuthClaw as a chatbot UI.

### Phase 4: Governance Features For Runtime AI

Goal: AuthClaw proves governance value immediately on live AI traffic.

Tasks:

- Tighten PII/PHI redaction:
  - inbound prompt redaction
  - outbound response redaction/reversal
  - streaming support
  - per-route strategy
- Tighten OPA/YAML policies:
  - model allowlist
  - blocked topics
  - regex rules
  - tenant-specific rules
  - explainable block reasons
- Convert audit events into evidence records and findings:
  - PII detected
  - policy violation
  - unapproved model usage
  - risky provider route
  - missing logging
- Add reports:
  - AI traffic summary
  - redaction summary
  - policy decisions
  - compliance evidence export

Exit criteria:

- AuthClaw can demonstrate the board-briefing promise: stop leaks, enforce policy, and record proof.
- Governance reports are generated from actual runtime events.

### Phase 5: AWS Production Deployment

Goal: AuthClaw runs from public AWS URLs and is ready for pilot customers.

Infrastructure tasks:

- Create Terraform modules for:
  - VPC/subnets/security groups
  - ALB/WAF/ACM/Route 53
  - ECS services
  - RDS PostgreSQL
  - Redis
  - ClickHouse/Kafka choice
  - KMS keys
  - Secrets Manager
  - S3 exports bucket
  - CloudWatch dashboards/alarms
- Build container images for:
  - backend
  - gateway
  - console
  - audit consumer
  - workers
- Add deployment environments:
  - dev
  - staging
  - prod
- Add migration deployment step:
  - run Alembic before service rollout
  - block deploy if migration fails
- Add health checks:
  - `/health` backend
  - gateway health
  - console health
  - DB connectivity
  - audit write path

Security tasks:

- Force HTTPS.
- Add WAF managed rules and rate limiting.
- Store secrets only in Secrets Manager/KMS.
- Lock down security groups.
- Enable RDS backups and encryption.
- Add CloudWatch alarms for:
  - gateway 5xx
  - backend 5xx
  - login attack spikes
  - policy block spikes
  - audit write failures
  - queue lag
  - DB CPU/storage

Exit criteria:

- `app.authclaw.ai`, `api.authclaw.ai`, and `gateway.authclaw.ai` are live.
- A pilot customer can log in, connect a provider key, copy the gateway URL, send traffic, and see audit evidence.
- Rollback is documented and tested.

### Phase 6: Pilot Readiness And Trust Hardening

Goal: Make the hosted governance layer safe enough for regulated design partners.

Tasks:

- Add Playwright E2E tests for:
  - login and email verification
  - provider credential setup
  - gateway route setup
  - policy block
  - audit event inspection
  - report export
- Add gateway integration tests:
  - OpenAI-compatible request
  - Anthropic-compatible request
  - Gemini-compatible request
  - streaming redaction
  - policy denial
  - bad key rejection
- Add smoke test script for deployed URLs.
- Run dependency scan and SAST in CI.
- Create customer runbooks:
  - onboarding
  - key rotation
  - incident response
  - audit export
- Prepare pentest scope.

Exit criteria:

- Pilot onboarding can be completed without engineer handholding.
- Tests prove no cross-tenant data exposure.
- Audit chain and report export are demoable.

## 7. Data Model Additions

Recommended additive tables:

```sql
login_attempts
  id
  tenant_id
  user_id
  email
  ip_address
  user_agent
  risk_score
  risk_reasons
  decision
  created_at

email_verifications
  id
  tenant_id
  email
  token_hash
  purpose
  expires_at
  verified_at
  created_at

ip_access_rules
  id
  tenant_id
  cidr
  rule_type
  description
  created_by
  created_at

provider_credentials
  id
  tenant_id
  provider
  display_name
  endpoint
  encrypted_secret
  kms_key_id
  auth_scheme
  status
  last_verified_at
  created_by
  created_at
  rotated_at

gateway_routes
  id
  tenant_id
  provider
  credential_id
  route_name
  endpoint
  model_whitelist
  redaction_strategy
  policy_id
  rate_limit_id
  is_active
  created_at

gateway_usage_events
  id
  tenant_id
  api_key_id
  route_id
  request_id
  provider
  model
  status
  decision
  latency_ms
  created_at
```

Some of these can extend existing `gateway_configs`, `api_keys`, and audit tables instead of creating all-new tables. The key rule is to keep the migration additive first, then consolidate later.

## 8. API Additions

Console/user auth:

- `POST /v1/auth/login/start`
- `POST /v1/auth/login/verify-email`
- `POST /v1/auth/login/complete`
- `POST /v1/auth/mfa/challenge`
- `POST /v1/auth/mfa/verify`
- `GET /v1/auth/session`

Provider credentials:

- `GET /v1/provider-credentials`
- `POST /v1/provider-credentials`
- `POST /v1/provider-credentials/{id}/test`
- `POST /v1/provider-credentials/{id}/rotate`
- `DELETE /v1/provider-credentials/{id}`

Gateway onboarding:

- `GET /v1/onboarding/gateway-instructions`
- `POST /v1/gateway-routes/test`
- `GET /v1/gateway-routes`
- `POST /v1/gateway-routes`
- `PUT /v1/gateway-routes/{id}`
- `DELETE /v1/gateway-routes/{id}`

## 9. Non-Negotiable Security Rules

- Never log customer provider API keys.
- Never return provider API keys after creation.
- Never send traffic to an AI provider if tenant, route, credential, policy, or model checks fail.
- Never allow console access without verified email.
- Suspicious login IP must be blocked or MFA-challenged.
- Provider credentials must be encrypted using KMS-backed envelope encryption.
- Every credential use, policy decision, redaction action, and login decision must produce an audit event.
- Gateway runtime auth and console user auth must be separate flows.
- Tenant isolation must remain enforced at the database layer.

## 10. Suggested Engineering Ticket Order

1. Add user login/email verification/IP risk design docs and tables.
2. Implement console user auth while preserving API-key machine auth.
3. Add provider credential vault schema and KMS encryption service.
4. Build provider credential CRUD/test APIs.
5. Update gateway to resolve tenant route and credential dynamically.
6. Update gateway to inject provider credentials and scrub inbound secrets.
7. Add onboarding UI for provider setup and gateway instructions.
8. Add first end-to-end hosted request flow.
9. Wire all login, credential, route, and gateway events into audit/evidence.
10. Add AWS Terraform and ECS deployment.
11. Add staging smoke tests.
12. Add production alarms, WAF, backup, and rollback process.
13. Run pilot readiness test with one complete chatbot integration.

## 11. MVP Success Test

The migration is successful when this exact demo works:

1. A new customer signs up with a real email.
2. AuthClaw verifies the email and risk-checks the login IP.
3. Customer adds their OpenAI or Gemini API key to AuthClaw.
4. Customer creates an AuthClaw gateway key.
5. Customer copies the hosted gateway URL into their chatbot config.
6. Customer sends a prompt containing test PII.
7. AuthClaw redacts the PII, enforces policy, forwards the request, and returns a provider-compatible response.
8. Customer opens the audit page and sees the request, redaction, policy decision, model/provider, latency, and integrity/audit metadata.
9. Customer exports a governance report showing AI usage evidence.

That is the governance-layer product.
