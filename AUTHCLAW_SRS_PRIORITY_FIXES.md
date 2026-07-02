# AuthClaw Lite SRS Priority Fixes

Date: 2026-07-02
Owner: Kunal / authclaw-lite

## Verdict

The comparison table is directionally right that AuthClaw Lite is strongest on service separation, Go gateway, Kafka/ClickHouse audit pipeline, and engineering discipline. It is stale in a few places: this repo now has Terraform, Dependabot, CI hard gates, signed audit export, a trust center, framework scoring, RLS tests, and 37 test files.

The real gap is no longer "missing big modules." The gap is hardening the modules so they satisfy the SRS under production and concurrency conditions.

## Priority 0 - SRS Blockers

### 1. Serialize the audit hash chain per tenant - DONE

**Why:** SRS FR-3.2 depends on tamper-evident audit integrity. Gateway audit writes compute `prior_hash` by selecting the latest row, then inserting the new row. That happens in a normal transaction with no tenant-level advisory lock or serializable isolation. Concurrent requests can read the same prior hash and fork the chain.

**Status:** Implemented on `codex-audit-chain-hardening`. Gateway audit writes now take a tenant-scoped 64-bit Postgres advisory transaction lock, persist a monotonic chain timestamp, and CI runs a concurrent gateway audit-chain test against Postgres.

**Evidence:**
- `gateway/audit.go` persists gateway audit metadata and computes `prior_hash`.
- `gateway/redact.go` `RunInTenantTx` uses `DB.BeginTx(ctx, nil)` with default isolation.
- `backend/app/services/audit_store.py` treats Postgres as chain-of-record and ClickHouse as analytics copy.

**Fix:**
- Add a tenant-scoped advisory transaction lock around audit-chain insert, e.g. `pg_advisory_xact_lock(hashtext(tenant_id))`, or use a dedicated per-tenant chain cursor row with `SELECT ... FOR UPDATE`.
- Add a concurrency test that fires parallel `persistAuditMetadata` writes and verifies a single valid chain.
- Make chain verification part of CI for gateway audit writes, not only backend export tests.

### 2. Stop storing raw gateway API keys in console session files - DONE

**Why:** Console login stores the raw API key server-side so API routes can proxy to backend/gateway. The cookie does not expose the key, but `console/src/lib/session-store.ts` writes `apiKey` into a JSON session file. That is too soft for NFR-2.2 secret management.

**Status:** Implemented on `codex-audit-chain-hardening`. Console sessions now encrypt gateway API keys at rest with AES-256-GCM using `SESSION_SECRET`, store only `credentialCiphertext` in the JSON session file, decrypt only inside server-side session reads, and auto-migrate legacy plaintext session files on read. Compose now passes `SESSION_SECRET` into the console container, and a Node test proves stored sessions do not contain plaintext `acl_` keys.

**Evidence:**
- `console/src/app/api/auth/login/route.ts` creates a session with `apiKey`.
- `console/src/lib/session-store.ts` stores `apiKey: string` and writes sessions to disk.
- `console/src/lib/api-client.ts` and `console/src/app/api/gateway-test/route.ts` read `session.apiKey` for proxy calls.

**Fix:**
- Short path: encrypt `apiKey` at rest with `SESSION_SECRET`/envelope crypto and decrypt only in server API routes.
- Better path: issue a backend session token and stop proxying with the original gateway API key.
- Add a test that session storage never contains the plaintext `acl_` key.

### 3. Enforce MFA for production approval execution - DONE

**Why:** SRS FR-2.3 says human approval with MFA on execution. Current code verifies TOTP/backup code only if the user already has MFA enabled; users without MFA can approve.

**Status:** Implemented on `codex-audit-chain-hardening`. HITL approval execution now rejects no-MFA approvers in `AUTHCLAW_ENV=production` before mutating approval state. Local/demo behavior remains permissive for setup flows, and tests cover both production rejection and local allowance.

**Evidence:**
- `backend/app/api/v1/endpoints/workflows.py` `_verify_mfa_if_enabled` allows approval when MFA is not configured.
- `backend/tests/test_phase10.py` covers MFA when configured, not mandatory enrollment for approvers.

**Fix:**
- In production, reject approval execution unless the approver has MFA enabled.
- Add an admin/setup path that forces owner/admin MFA enrollment before approval privileges.
- Add tests for: no-MFA admin in production cannot approve; no-MFA in local demo may still pass if explicitly configured.

### 4. Make gateway audit persistence fail-closed or durable-queued - DONE

**Why:** Gateway runtime decisions are the core SRS audit surface. `EmitAuditEvent` logs Postgres persistence errors and continues; Kafka publish errors are counted/logged. For regulated mode, a request that cannot be recorded should fail or enter a durable local outbox.

**Status:** Implemented on `codex-audit-chain-hardening`. Gateway audit writes now return persistence errors, queue events to a synchronous local NDJSON outbox when Postgres is unavailable, and fail closed when both Postgres and the outbox are unavailable under `AUDIT_FAIL_CLOSED=true` or production defaults. Audit fallback/fail-closed counters are exposed in `/metrics`, and `/health` reports audit mode/outbox path.

**Evidence:**
- `gateway/audit.go` comments say audit emit failures are "logged and swallowed."
- `persistAuditMetadata` logs `[AUDIT] Postgres metadata fallback failed` and does not return an error.
- Kafka publish errors are non-fatal in `gateway/kafka.go`.

**Fix:**
- Add `AUDIT_FAIL_CLOSED=true` for production.
- Return audit persistence errors to the proxy path before provider response is considered successful.
- If fail-open is needed for local demos, make it explicit and visible in `/metrics` and `/health`.

## Priority 1 - Match The Analysis / Close Product Gaps

### 5. Tighten latency benchmark gates to the SRS target

**Why:** SRS NFR-1.1 says gateway overhead should be <=50ms. Existing benchmark artifacts show provider-inclusive p95 values far above 50ms and CI gates allow p95 900ms / p99 1200ms. That may be fine for end-to-end provider latency, but it does not prove SRS gateway overhead.

**Evidence:**
- `gateway-benchmark-concurrency10.json` p95: allow 776ms, redact 914ms, block 169ms, stream 821ms.
- `.github/workflows/ci.yml` uses `AUTHCLAW_BENCH_P95_MS: "900"`.
- `scripts/gateway_latency_benchmark.py` measures full request latency.

**Fix:**
- Split benchmarks into two metrics: provider-inclusive e2e latency and gateway overhead with mock provider baseline subtraction.
- Add a CI gate for overhead p95 <=50ms on allow/block and a separate realistic threshold for redaction/streaming.
- Keep current benchmark as evidence, but stop presenting it as proof of the 50ms SRS target.

### 6. Ship a minimal SDK/developer experience package

**Why:** The comparison marks SDK/DX as missing. SRS fit improves a lot if users can route traffic through AuthClaw without hand-copying curl snippets.

**Evidence:**
- No `sdk/` package found.
- `README.md`, `startup_guide.md`, and onboarding generate curl/PowerShell snippets only.

**Fix:**
- Add `sdk/python/authclaw_lite.py` with one tiny client: `chat_completions.create(...)` forwarding to the gateway with the AuthClaw API key.
- Include install-free usage first: a single file and one test using the mock provider.
- Add generated snippets in console to show Python SDK next to curl.

### 7. Prove trust center end-to-end in CI

**Why:** Trust center is implemented, but SRS fit depends on it working from console share creation to public export download to offline verification.

**Evidence:**
- Backend service exists: `backend/app/services/trust_center.py`.
- Console page creates auditor links: `console/src/app/(console)/frameworks/page.tsx`.
- Tests cover service helpers, but CI E2E mainly checks login/onboarding.

**Fix:**
- Add Playwright E2E: create share, open public URL, download signed export, verify artifact via `/api/trust-center/public/verify`.
- Add backend integration test through HTTP endpoints, not only service-level monkeypatch tests.

### 8. Promote full-stack docs from planning docs to operator runbook

**Why:** The analysis says documentation is planning-heavy. That is still mostly true. The repo has strong docs, but they are spread across planning files and phase docs.

**Evidence:**
- `startup_guide.md` exists and now documents full local stack.
- `infra/terraform/README.md`, `infra/kafka/EVENT_BACKBONE.md`, and `infra/clickhouse/AUDIT_STORE_HARDENING.md` exist.
- Root README still reads older/lighter than the actual system.

**Fix:**
- Make root `README.md` the single SRS-aligned operator entry point.
- Link to full local, production Terraform, audit verification, trust center, and benchmark evidence.
- Add a compact "SRS coverage matrix" table and keep this file as the backlog.

## Priority 2 - Hardening And Polish

### 9. Fix stale comparison claims in project material

Update public/internal claims:
- Terraform is present under `infra/terraform`.
- Dependabot is active under `.github/dependabot.yml`.
- CI has CodeQL, gitleaks, pip/npm/go audits, backend/gateway/console/audit-consumer tests, Docker scans, integration, and benchmark gates.
- Trust center and signed audit export are present.
- Framework scoring is implemented with history snapshots.

### 10. Add production-mode startup checks for the console

Backend has production checks, but console session/security assumptions should fail at boot too.

Fix:
- Require `AUTHCLAW_COOKIE_SECURE=true` when `NODE_ENV=production` and public URL is HTTPS.
- Require non-demo `SESSION_SECRET`.
- Refuse plaintext file session storage in production unless API keys are encrypted.

### 11. Clean generated/local infra from version control

The repo contains local Terraform provider cache and plan artifacts under `infra/terraform/.terraform` and `infra/terraform/tfplan`. These are not product value and make scans/builds heavier.

Fix:
- Add/confirm ignore rules for `.terraform/`, `tfplan`, `terraform-plan.txt`.
- Remove tracked local artifacts if they are in git.

## Current SRS Fit Snapshot

| Area | Current repo state | Priority |
|---|---|---|
| Architecture | Strong: Go gateway, Python backend, audit consumer, Next console | Keep |
| In-line gateway | Strong feature coverage; needs audit fail-closed and overhead proof | P0/P1 |
| Redaction | Strong: Presidio, fallback recognizers, masking/hash/AES tokenization, streaming tests | Keep |
| Policy | Strong: YAML + OPA + validation + rate limits | Keep |
| HITL | Good: 30-minute expiry and approval flow; production MFA enforcement gap | P0 |
| Audit | Strong components; concurrency and fail-closed semantics need hardening | P0 |
| Trust center | Implemented; needs endpoint/UI E2E proof | P1 |
| Framework scoring | Implemented for SOC2/GDPR/HIPAA; needs README/SRS presentation | P2 |
| HA/IaC | Terraform exists; needs production evidence/runbook use | P2 |
| CI/CD | Stronger than comparison says | Keep |
| SDK/DX | Missing | P1 |

## Done Definition For "Match The Analysis"

We can say AuthClaw Lite matches or beats the analysis when:

1. Gateway audit chain remains valid under concurrent traffic.
2. Raw API keys are not stored plaintext in console sessions.
3. Production approvals require MFA enrollment and a valid MFA code.
4. Gateway audit failure behavior is explicit and production fail-closed.
5. Benchmark report proves SRS gateway overhead separately from provider latency.
6. Minimal SDK exists and is tested.
7. Trust center public share/export/verify has E2E coverage.
8. Root README accurately presents the implemented system.
