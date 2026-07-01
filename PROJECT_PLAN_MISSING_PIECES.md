# AuthClaw Project Plan Missing Pieces

Source reviewed: `C:\Users\WIN10\Downloads\AuthClaw_Project_Plan.pdf`

Date: 2026-06-30

This checklist maps the project plan epics and exit criteria against the current AuthClaw repo state. It focuses on what is still missing or only partially complete for the full MVP described in the plan.

## Executive Summary

AuthClaw now has meaningful coverage for the gateway, provider adapters, streaming redaction, HITL, remediation state machine with rollback, audit hash-chain, signed audit exports, ClickHouse audit analytics, Kafka event backbone, auth/API-key lifecycle, secret envelopes, Terraform baseline, regulatory RAG, ephemeral worker tokens, Auditor Trust Center sharing, compliance scoring, and multi-region RDS standby design. The remaining gaps are concentrated in five areas:

1. Full external worker runtimes and cloud/SCM connector execution beyond the current AWS path.
2. Broader compliance report packaging and auditor-ready evidence bundles.
3. CI/CD security gates and staging/prod promotion proof.
4. Enterprise auth/SSO, full RBAC administration, and tenant administration polish.
5. Phase 4 hardening: latency proof, red-team harness, pentest, HA drills, SOC 2 evidence automation.

## Completed Since Original Review

- HITL expiry aligned to the 30-minute SRS default across gateway policy, starter YAML, UI defaults, and tests.
- Streaming redaction hardened for flush behavior, chunk boundaries, provider SSE formats, and reduced buffering.
- Heavy benchmark profile and NFR p95/p99 thresholds established for the stable local profile.
- Policy enforcement hardened with YAML validation, dry-run/simulation, explainability, activation, and rollback.
- Provider coverage expanded with Cohere and Azure OpenAI adapters, contract tests, streaming format tests, route compatibility checks, and credential-injection tests.
- Audit store hardened with ClickHouse analytics ingestion, replay/backfill, consistency checks, restricted-write guidance, and broader audit schema coverage.
- Event backbone added with Kafka topic definitions, DLQ/replay/idempotency semantics, metrics, integration tests, and operations docs.
- Auth baseline hardened with API-key expiry, rotation, revocation propagation, last-used auditing, scoped enforcement, provider credential rotation, secret-provider runbook, and OIDC/SSO hooks.
- PII/PHI redaction hardened with custom NER support, strategy coverage, inbound/outbound provider coverage, concurrency stabilization, timeout/fallback metrics, and tenant token retention/purge support.
- RAG added for GDPR, HIPAA, and SOC 2 with versioned corpus, citation-backed agent answers, retrieval evaluation tests, corpus sync/status/search endpoints, and remediation guardrails tied to retrieved evidence.
- Console lint hardening completed; `npm.cmd run lint` is now green.
- Ephemeral worker baseline added with scoped short-lived worker tokens, TTL enforcement, deny-by-default connector permission boundaries, GitHub/GCP connector foundations, AWS S3 sync worker-token enforcement, audit-chain events for grants/use/denials/expiry/revocation, and a console worker-token lifecycle tab.
- Cryptographic audit export added with Ed25519-signed export artifacts, SHA-256 payload digest, offline verifier CLI, tamper/chain-gap detection tests, backend export/verify endpoints, and console signed-export/verify controls.
- Compliance dashboard scoring added with live SOC 2/GDPR/HIPAA readiness scores from evidence, findings, audit-chain events, redaction records, policies, gateways, and approvals; control-by-control explanations, score history snapshots, trend API, and console framework dashboard are present.
- Auditor Trust Center added with scoped share links, token-hash storage, expiry/revocation, public auditor page, live framework scores, signed export downloads, export upload verifier, auditor verification guide, and access logging.

## Phase 1 - Foundation & Architecture

### E1.1 Cloud Foundation & IaC

Current status: Partial.

Missing pieces:

- Prove Terraform against a real staging AWS account, not only `terraform validate`.
- Add remote Terraform state backend, locking, and workspace/environment separation.
- Add production Route53 health checks and failover automation around RDS promotion.
- Add actual multi-region active-active proof. Current model is closer to active-passive for the database because secondary RDS is read-only until promotion.
- Add staging/prod environment variable sets and promotion flow.
- Add cloud cost, quotas, and capacity assumptions for ALB, ECS, RDS, Redis, Kafka/MSK, and ClickHouse.

### E1.2 CI/CD Pipeline

Current status: Partial.

Missing pieces:

- Add SAST and dependency scanning gates.
- Add Docker image build and push jobs for backend, gateway, console, audit consumer, OPA bundle image.
- Add environment promotion gates for staging and production.
- Add Terraform plan checks for pull requests.
- Add integration test stage using gateway, backend, console, Postgres, Redis, OPA, Presidio, Kafka, and ClickHouse.
- Add benchmark gate for gateway latency/redaction regressions.
- Add security-scan fail policy for high/critical findings.

### E1.3 Multi-Tenant Data Model

Current status: Mostly present.

Missing pieces:

- Broaden automated cross-tenant RLS tests across every tenant-owned table, not only the core paths.
- Add CI gate that fails if a new tenant-scoped table lacks RLS policy coverage.
- Add physical isolation option or documented plan for enterprise tenants if required by project-plan wording.

### E1.4 Gateway Proxy Skeleton

Current status: Mostly complete.

Completed:

- Native provider adapters are present for OpenAI, Anthropic, Cohere, Azure OpenAI, and Gemini.
- Provider contract tests cover request/response fidelity for required providers.
- Streaming contract tests cover provider SSE formats.
- Route-level model/provider compatibility validation is present.
- Credential injection tests cover provider-specific upstream credentials.

Missing pieces:

- Add gRPC support if still required by the gateway ingress plan.
- Run provider contract tests against staging credentials before production sign-off.

### E1.5 Audit Store

Current status: Mostly complete.

Completed:

- ClickHouse is wired as the production analytics path while Postgres remains the hash-chain system of record.
- Replay/backfill from Postgres audit chain into ClickHouse is present.
- Consistency check/reporting between Postgres chain and ClickHouse copy is present.
- Append-only/restricted-write ClickHouse migration and operational guidance are present.
- Audit schema coverage was extended for approvals, remediation action attempts, rollback events, and framework impact.

Missing pieces:

- Prove ClickHouse retention and restricted-write controls in staging/prod infrastructure.
- Add large-volume replay timing evidence.

### E1.6 Event Backbone

Current status: Mostly complete.

Completed:

- Kafka/MSK topics are defined for gateway traffic, audit events, and audit dead-letter handling.
- Topic partitioning, retention, replay policy, and tenant keying are documented.
- Gateway/backend/audit-consumer integration tests cover emit, ClickHouse write, DLQ failure, and replay reconciliation paths.
- Stable event IDs, duplicate handling, restart safety, and idempotent ClickHouse writes are implemented.
- Metrics cover publish failures, consumer lag, DLQ count, ClickHouse insert failures, and replay inserted/skipped counts.
- Operational docs cover setup, retention choices, replay, and failure runbook.

Missing pieces:

- Prove MSK deployment and consumer lag alarms in a real staging AWS account.

### E1.7 Auth Baseline

Current status: Partial to strong.

Completed:

- API-key expiry, rotation, revocation propagation, last-used auditing, and scoped enforcement are implemented.
- Provider credential rotation flow is implemented.
- Production secret-provider runbook is present.
- OIDC/SSO extension hooks are present.

Missing pieces:

- Add full OIDC/IdP integration.
- Add enterprise SSO configuration UI and tests.
- Make final production choice for KMS/Vault secret provider and prove it in staging.

## Phase 2 - Agentic Engine & Guardrails

### E2.1 PII/PHI Redaction Engine

Current status: Strong.

Completed:

- Custom NER pipeline support beyond Presidio defaults is present.
- Redaction strategies are covered: mask, salted hash, synthetic replacement, and reversible tokenization.
- Inbound prompts and outbound completions are redacted across required providers.
- Presidio-backed redaction was stabilized for concurrency-10+ paths.
- Timeout/fallback metrics are explicit.
- Tenant-specific reversible token retention and purge policy is present.

Missing pieces:

- Add larger staging soak tests with real Presidio latency/failure modes.

### E2.2 Policy Enforcement

Current status: Mostly complete.

Completed:

- YAML policy-as-code validator rejects malformed or over-scoped policies before activation.
- Policy dry-run/simulation endpoint is present.
- Decision explainability is present for allow/block/require-approval paths.
- Policy version rollout safety covers draft, validate, activate, and rollback.
- Console policy page exposes validation, simulation, explanations, validation warnings/errors, activation, and rollback controls.

Missing pieces:

- Add topic classification rules beyond regex/model rules.
- Add OPA bundle build/deploy path for Terraform/ECS.

### E2.3 Streaming Filter

Current status: Strong.

Completed:

- Streaming flush behavior was fixed.
- Chunk-boundary tests cover sensitive-value fragmentation.
- Provider SSE format support was hardened.
- Buffering was reduced where possible.
- Provider-specific streaming contract coverage was added for required providers.

Missing pieces:

- Add back-pressure tests under load.
- Add latency/throughput benchmarks for streaming redaction with Presidio slow/failure modes.

### E2.4 Orchestrator + RAG

Current status: Complete for MVP.

Completed:

- Versioned RAG corpus exists for GDPR, HIPAA, and SOC 2.
- Agent chat produces citation-backed framework answers.
- Retrieval evaluation tests cover common framework questions.
- Corpus sync/status/search endpoints provide update workflow and corpus version reporting.
- Remediation guidance is guardrailed to retrieved evidence.

Missing pieces:

- Add larger authoritative corpus expansion and scheduled corpus review/approval process before external auditor use.

### E2.5 Ephemeral Workers

Current status: Mostly complete.

Completed:

- Scoped temporary worker tokens can be issued per scan/remediation action.
- Token TTL enforcement is present with a 30-minute hard cap.
- Worker token grant, use, denial, expiry, and revocation are emitted into the audit hash-chain.
- Deny-by-default permission boundaries are implemented for destructive cloud actions.
- GitHub and GCP connector foundations are registered with explicit scopes and action maps.
- AWS S3 sync now runs through a scoped ephemeral worker token before touching AWS.
- Console Settings exposes connector boundaries, token issuance, one-time token reveal, token inventory, and revocation.

Missing pieces:

- Run workers in isolated short-lived runtime infrastructure instead of only issuing scoped credentials inside the control plane.
- Implement live GitHub and GCP API execution paths behind the connector foundations.
- Expand AWS connector execution coverage beyond S3 sync.
- Add staging proof for worker-token expiry, revocation propagation, and destructive-action denial.

### E2.6 HITL Workflow Engine

Current status: Partial to strong.

Missing pieces:

- Prove MFA challenge is fresh, action-bound, approver-bound, non-transferable, and single-use.
- Add tests for approval replay prevention.
- Add tests for concurrent approval/race handling.
- Add strict three-state model verification: read-only scan, remediation plan, execution.
- Add full audit coverage for approval creation, expiry, MFA challenge, execution, and rollback.

## Phase 3 - Developer Experience Console

### E3.1 Console Foundation

Current status: Strong.

Completed:

- Console lint hardening is complete; `npm.cmd run lint` is green.
- Production console build passes.

Missing pieces:

- Finish auth integration around real OIDC/IdP, not just local/session flows.
- Add tenant context tests across all console API routes.
- Add accessibility checks.

### E3.2 Compliance Dashboard & Framework Scoring

Current status: Mostly complete.

Completed:

- SOC 2/GDPR/HIPAA scoring is live from evidence, audit records, findings, redactions, policies, gateways, and approvals.
- Control-by-control scoring logic includes evidence signals, active gaps, readiness status, and weighted framework totals.
- Daily score snapshots are persisted for score history and trend reporting.
- Readiness percentage definitions and tests are present.
- Overview and Frameworks console pages use the live scoring endpoint instead of static demo scores.

Missing pieces:

- Expand evidence linkage to named auditor controls and source artifacts once the Trust Center package is built.
- Add staging/prod score baselines after real customer traffic and evidence volume exist.

### E3.3 Agent Chat + Remediation + Approvals UI

Current status: Strong.

Completed:

- Chat answers are connected to RAG citations and show grounding evidence in the conversation and inspector panel.
- Remediation workflows and approvals are visible in the agent UI.

Missing pieces:

- Show action-scoped MFA binding and approval audit trail in UI.
- Add richer remediation diff previews for Terraform/CLI changes.
- Add approval replay/expiry states in UI tests.

### E3.4 Gateway & Redaction Config UI

Current status: Partial.

Missing pieces:

- Add per-route validation for provider-specific fields.
- Add live traffic inspector tied to actual gateway events.
- Add provider credential status per route.
- Add redaction strategy preview/test runner.

### E3.5 Audit Explorer + Trust Center

Current status: Mostly complete.

Completed:

- Cryptographic export is available from the Audit Explorer UI.
- Signed export verification workflow is available from the Audit Explorer UI.
- Backend exposes signed export, signing-key metadata, and verifier endpoints.
- Shareable Trust Center pages are present with scoped auditor links, expiry, revocation, access logging, live framework scores, signed export downloads, and an embedded verifier guide.
- Console Compliance Frameworks page can create and revoke auditor Trust Center links.

Missing pieces:

- Add ClickHouse-backed search once ClickHouse ingestion is production-grade.
- Broaden the Trust Center package into a full executive/auditor evidence bundle with policy snapshots, approvals, redaction metrics, and owner attestations.

### E3.6 Tenant Admin

Current status: Partial to strong.

Completed:

- API-key expiry, rotation, revocation, last-used metadata, and scoped key flows are implemented at the auth/API layer.

Missing pieces:

- Add full RBAC role editing and permission matrix.
- Add rate-limit tier management tied to gateway enforcement.
- Add billing-tier stubs if still expected by project plan.
- Add API-key expiry/rotation/revocation UX.

### E3.7 Public API + SDK + Developer Docs

Current status: Mostly missing.

Missing pieces:

- Publish public API documentation for onboarding, gateway config, audit export, policies, and approvals.
- Add SDK or generated client for gateway onboarding and audit export.
- Add developer quickstarts for OpenAI, Anthropic, Cohere, Azure OpenAI.
- Add versioned API contract tests.

## Phase 4 - Compliance Hardening

### E4.1 Penetration Testing & Remediation

Current status: Missing.

Missing pieces:

- Book external pentest.
- Add threat model document.
- Track pentest findings and remediation evidence.
- Add security sign-off gate before production MVP.

### E4.2 Continuous Red-Teaming Harness

Current status: Mostly missing.

Missing pieces:

- Add adversarial probe runner for prompt injection, data disclosure, sycophancy, harmful content.
- Add vulnerability register.
- Add severity scoring and go/no-go report.
- Add scheduled red-team runs in CI or staging.
- Add Risk & Red Teaming console surface from the project plan IA.

### E4.3 Latency Optimization

Current status: Partial.

Missing pieces:

- Produce official benchmark evidence that gateway overhead is <= 50 ms at target throughput.
- Add p95/p99 latency gates.
- Finish concurrency-10+ redaction stability work.
- Add profiling reports for gateway, Presidio, OPA, Kafka, and audit write path.

### E4.4 Cryptographic Audit Export

Current status: Mostly complete.

Completed:

- Signed/verifiable audit export is present.
- Export includes audit logs and hash-chain proof metadata.
- Verifier endpoint, UI verification workflow, standalone CLI verifier, and Trust Center verifier guide are present.
- Tamper detection and chain-gap tests are present.

Missing pieces:

- Broaden export package beyond audit logs to include redaction metrics, policy/config snapshots, approval evidence, and executive report sections.

### E4.5 HA & Resilience

Current status: Partial.

Missing pieces:

- Automate RDS read-replica promotion or explicitly gate Route53 failover on manual promotion.
- Add chaos/failover test scripts.
- Add measured RTO/RPO report.
- Add Redis failover testing.
- Add Kafka/ClickHouse resilience testing.
- Demonstrate 99.99% target assumptions with monitoring and runbooks.

### E4.6 SOC 2 Evidence Automation

Current status: Partial.

Missing pieces:

- Add SOC 2 evidence automation pipeline.
- Add policy/runbook repository for operational controls.
- Add evidence collection schedule.
- Add auditor-ready evidence package generation.
- Add control owner mapping and review workflow.

## Cross-Cutting Testing Gaps

Missing pieces:

- Broaden unit tests for newly added policy/provider/auth/redaction/RAG edge cases.
- Integration test for proxy -> redact -> policy -> provider -> audit chain.
- Streaming tests under load for every required provider.
- Multi-tenant isolation tests across all scoped tables.
- Load tests proving <= 50 ms gateway overhead.
- Red-team test harness and thresholds.
- External penetration test.
- HA/chaos tests for region failover.
- Broader compliance export package tests covering metrics, policies, approvals, and report sections.

## Cross-Cutting Documentation Gaps

Missing pieces:

- Architecture threat model.
- Production deployment runbook.
- Secret rotation runbook.
- Provider onboarding docs.
- Policy authoring guide.
- DR drill report template.
- SOC 2 evidence collection guide.
- Auditor verification guide for cryptographic exports.

## Recommended Next Work Order

1. CI/CD hardening: SAST, dependency scan, image build, Terraform plan, integration, and benchmark gates.
2. Broader compliance export package: redaction metrics, policy/config snapshots, approvals, executive report sections, and owner attestations.
3. Latency and red-team evidence: official NFR benchmark and adversarial harness.
4. HA/resilience proof: staging failover drills, RTO/RPO report, Redis/Kafka/ClickHouse resilience tests.
5. Enterprise auth/admin: OIDC/SSO UI, RBAC matrix, tenant tier/rate-limit management.
6. External ephemeral worker runtime: isolated worker launch, live GitHub/GCP execution, and broader AWS remediation execution.
