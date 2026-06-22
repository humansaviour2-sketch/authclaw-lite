# AuthClaw Lite Feature Scope

This is the working scope for the demo AI governance layer. Use this file before scanning broader platform code.

## Goal

AuthClaw Lite proves this customer flow:

```text
Customer chatbot/API -> AuthClaw Gateway URL -> governance checks -> provider API -> audit evidence
```

## Core Demo Features

1. Customer app connection [built]
   - Hosted gateway URL.
   - Copyable curl/example request.
   - Provider route selector.

2. Tenant and runtime key auth
   - AuthClaw gateway API key validates tenant.
   - Gateway request is tenant-scoped.

3. Provider route setup
   - OpenAI/Gemini/Anthropic-style route config.
   - Model whitelist.
   - Redaction strategy.

4. Custom redaction policy [built]
   - Admin can define simple YAML rules.
   - Rules support regex patterns, reason, severity, and action.
   - Rule actions:
     - `redact`: redact and pass.
     - `require_approval`: trigger HITL before redaction/pass.
     - `block`: block through policy decision.

5. HITL before risky PII passage [built]
   - Gateway scans prompt before sending it to provider.
   - If a `require_approval` rule matches, the request pauses.
   - Admin can approve or reject.
   - If no decision is made within 5 minutes, the request auto-expires and blocks.
   - Only approved requests proceed to redaction and provider forwarding.

6. Governance audit
   - Gateway emits allow/block/approval audit events.
   - Policy match reason is visible.
   - Request ID is carried through the flow.

7. Lite dashboard
   - Traffic count.
   - Redaction count.
   - Gateway latency.
   - Governance status.

8. Integration health check [built]
   - Gateway reachable.
   - Provider route configured.
   - Active policy configured.
   - Audit path available.

9. Demo-safe regex fallback redaction [built]
   - If Presidio is slow or unavailable, gateway falls back to deterministic regex detection.
   - Fallback covers custom policy regexes plus email, SSN, phone, and health keywords.
   - The same tokenization and reverse mapping path is used after fallback detection.

## Explicitly Out Of Lite Demo Scope

- Multi-region deployment.
- Managed Kafka/MSK.
- Managed ClickHouse cluster.
- Full compliance agent remediation.
- Framework control rooms as primary demo flow.
- Evidence repository as primary demo flow.
- AWS cloud scanning as primary demo flow.
- SOC 2 production readiness.

The broader platform code can stay in the repo, but the Lite UI should guide users only through the core demo flow.

## Current Build Status

Paused handoff status: stopped here by request. Continue tomorrow from the remaining items below.

- Added AuthClaw Lite demo deployment files.
- Added Connect App page as the main Lite flow.
- Reduced demo navigation to Lite-required pages.
- Added custom regex rule fields: `action`, `severity`, and `hitl_timeout_seconds`.
- Added gateway-side `require_approval` detection before redaction/provider egress.
- Added gateway-side 5-minute approval wait with auto-expire/block.
- Added gateway-side immediate `block` action for custom regex rules.
- Added backend approval APIs:
  - `GET /v1/workflows/approvals`
  - `POST /v1/workflows/approvals/{approval_id}/approve`
  - `POST /v1/workflows/approvals/{approval_id}/reject`
- Added console approval proxy APIs under `/api/approvals`.
- Added Connect App HITL approval queue.
- Replaced YAML-first policy page with easy Custom Redaction Policy builder.
- Added starter Lite policy template at `infra/policies/authclaw-lite-starter.yaml`.
- Added provider credential vault backend, console API proxy, and Connect App UI.
- Gateway now loads encrypted tenant provider credentials and injects upstream provider auth headers.
- Added Integration Health panel and `/api/lite-health`.
- Added demo seed script at `backend/scripts/seed_authclaw_lite.py`.
- Docker Compose Lite stack builds and starts locally with isolated local ports from `.env.demo.local`.
- Demo seed verified:
  - Login email: `admin@authclaw-lite.demo`
  - Gateway API key: `acl_lite_demo_key`
- Verified local health:
  - Backend: `http://localhost:18000/health`
  - Gateway: `http://localhost:18080/health`
  - Console: `http://localhost:13001/login`
- Verified gateway custom policy block path returns `403` before provider egress for seeded SSN rule.
- Presidio container currently listens but times out on analyzer requests in the local Docker image; Lite demo now degrades through gateway regex fallback.
- Console login API verified with seeded demo credentials.
- Pending but not applied to the running Docker console because rebuild approval was rejected: internal Docker URLs for Lite health checks (`API_URL=http://backend:8000`, `GATEWAY_INTERNAL_URL=http://gateway:8080`).

## Next Build Order

1. Rebuild/restart console so the internal Docker URL fix is active.
2. Verify login/session flow in the browser.
3. Verify Lite health panel after console rebuild.
4. Verify HITL approve/reject UI with a request that matches the `require_approval` rule.
5. Deploy the Lite stack on AWS EC2.

## Recommended Policy YAML Shape

```yaml
regex_rules:
  - name: customer_email
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b"
    reason: "Email addresses require masking."
    severity: medium
    action: redact

  - name: patient_health_data
    pattern: "(?i)\\b(patient|diagnosis|prescription|medical record)\\b"
    reason: "Health context requires human approval before model egress."
    severity: high
    action: require_approval
    hitl_timeout_seconds: 300

model_rules:
  whitelist:
    - gpt-4o-mini
    - gemini-2.5-flash-lite

rate_limits:
  requests_per_minute: 60
```
