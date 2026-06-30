# AuthClaw Project Plan Missing Pieces

Source reviewed: `C:\Users\WIN10\Downloads\AuthClaw_Project_Plan.pdf`

Date: 2026-06-29

This checklist maps the project plan epics and exit criteria against the current AuthClaw repo state. It focuses on what is still missing or only partially complete for the full MVP described in the plan.

## Executive Summary

AuthClaw now has meaningful coverage for the gateway, redaction, HITL, remediation state machine, audit hash-chain, secret envelopes, Terraform baseline, and multi-region RDS standby design. The remaining gaps are concentrated in five areas:

1. Production-grade policy enforcement and validation.
2. Full provider coverage and contract testing.
3. RAG, scoped ephemeral workers, and cloud/SCM connectors beyond the current AWS path.
4. ClickHouse/Kafka/audit export hardening.
5. Phase 4 hardening: latency proof, red-team harness, pentest, HA drills, SOC 2 evidence automation.

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

Current status: Partial.

Missing pieces:

- Complete and verify native provider compatibility for the four project-plan providers: OpenAI, Anthropic, Cohere, Azure OpenAI.
- Current implementation also includes Gemini; keep it, but it does not replace Cohere/Azure requirements.
- Add provider contract tests for request/response fidelity for all required providers.
- Add gRPC support if still required by the gateway ingress plan.
- Add production upstream credential injection tests per provider.
- Add route-level model/provider compatibility validation.

### E1.5 Audit Store

Current status: Partial.

Missing pieces:

- Make ClickHouse the production high-volume audit analytics path, not just optional infrastructure.
- Add append-only/restricted-write deployment controls for ClickHouse.
- Add replay/backfill from Postgres audit chain into ClickHouse.
- Add consistency checks between Postgres chain of record and ClickHouse analytics copy.
- Add schema coverage for agent reasoning, approvals, remediation action attempts, and framework impact.

### E1.6 Event Backbone

Current status: Partial.

Missing pieces:

- Define production Kafka/MSK topics, partitions, retention, and dead-letter topics.
- Add producer/consumer integration tests across gateway, backend, and audit consumer.
- Add retry, idempotency, and replay semantics for audit events.
- Add operational metrics for publish failures, lag, dropped messages, and consumer restarts.

### E1.7 Auth Baseline

Current status: Partial.

Missing pieces:

- Add OIDC/IdP integration.
- Add enterprise SSO configuration UI and tests.
- Add final production choice and runbook for KMS/Vault secret provider.
- Add provider credential rotation flow.
- Add API-key lifecycle hardening: expiry, scopes, rotation, last-used auditing, revocation propagation.

## Phase 2 - Agentic Engine & Guardrails

### E2.1 PII/PHI Redaction Engine

Current status: Partial to strong.

Missing pieces:

- Add custom NER pipeline support beyond Presidio built-ins and regex recognizers.
- Prove all three strategies at scale: mask, SHA-256+salt hash, synthetic replacement.
- Prove redaction for both inbound prompts and outbound completions for all required providers.
- Finish concurrency-10+ stability work for Presidio-backed redaction.
- Add explicit fallback metrics when Presidio times out or degrades.
- Add tenant-specific reversible tokenization retention and purge policy.

### E2.2 Policy Enforcement

Current status: Partial.

Missing pieces:

- Add YAML policy-as-code validator that rejects malformed or over-scoped policies before activation.
- Add policy dry-run/simulation endpoint.
- Add explainability for allow/block/require-approval decisions.
- Add topic classification rules beyond regex/model rules.
- Add policy version rollout safety: draft, validate, activate, rollback.
- Add OPA bundle build/deploy path for Terraform/ECS.

### E2.3 Streaming Filter

Current status: Partial to strong.

Missing pieces:

- Add provider-specific streaming contract tests for OpenAI, Anthropic, Cohere, Azure OpenAI.
- Add back-pressure tests under load.
- Prove no token fragmentation for sensitive values across chunk boundaries.
- Add latency/throughput benchmarks for streaming redaction with Presidio slow/failure modes.

### E2.4 Orchestrator + RAG

Current status: Partial.

Missing pieces:

- Add RAG index over GDPR, HIPAA, and SOC 2 documentation.
- Add citation-backed framework answers in the agent chat.
- Add retrieval evaluation tests for framework questions.
- Add versioning/update workflow for the regulatory corpus.
- Add guardrails to keep remediation suggestions tied to retrieved evidence.

### E2.5 Ephemeral Workers

Current status: Partial.

Missing pieces:

- Add true short-lived worker runtimes instead of only in-process/long-lived execution.
- Add scoped temporary tokens per scan/remediation action.
- Add GitHub connector.
- Add GCP connector.
- Expand AWS connector coverage beyond the current path.
- Add token TTL enforcement and audit events for every token grant.
- Add deny-by-default permission boundaries for destructive cloud actions.

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

Current status: Partial to strong.

Missing pieces:

- Finish auth integration around real OIDC/IdP, not just local/session flows.
- Add tenant context tests across all console API routes.
- Add design-system hardening and accessibility checks.

### E3.2 Compliance Dashboard & Framework Scoring

Current status: Partial.

Missing pieces:

- Make SOC 2/GDPR/HIPAA scoring live from evidence and audit records.
- Add control-by-control scoring logic with evidence linkage.
- Add score history and trend reporting.
- Add readiness percentage definitions and tests.

### E3.3 Agent Chat + Remediation + Approvals UI

Current status: Partial to strong.

Missing pieces:

- Connect chat answers to RAG citations.
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

Current status: Partial.

Missing pieces:

- Add cryptographic export from the UI.
- Add shareable Trust Center page.
- Add export verification workflow for auditors.
- Add ClickHouse-backed search once ClickHouse ingestion is production-grade.

### E3.6 Tenant Admin

Current status: Partial.

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

Current status: Partial.

Missing pieces:

- Add signed/verifiable compliance report export.
- Include logs, redaction metrics, policy/config snapshots, approval evidence, and hash-chain proof.
- Add verifier tool or documented verification command.
- Add export tests for tamper detection.

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

- Unit tests for policy validation and provider adapters.
- Contract tests for OpenAI, Anthropic, Cohere, Azure OpenAI.
- Integration test for proxy -> redact -> policy -> provider -> audit chain.
- Streaming tests under load for every required provider.
- Multi-tenant isolation tests across all scoped tables.
- Load tests proving <= 50 ms gateway overhead.
- Red-team test harness and thresholds.
- External penetration test.
- HA/chaos tests for region failover.
- Audit export verification tests.

## Cross-Cutting Documentation Gaps

Missing pieces:

- Architecture threat model.
- Production deployment runbook.
- Secret rotation runbook.
- Provider onboarding docs.
- Policy authoring guide.
- RAG corpus update guide.
- DR drill report template.
- SOC 2 evidence collection guide.
- Auditor verification guide for cryptographic exports.

## Recommended Next Work Order

1. Policy enforcement hardening: YAML validator, dry-run, explainability, version activation/rollback.
2. Provider compatibility: complete Cohere and Azure OpenAI contract coverage.
3. RAG and regulatory corpus: GDPR/HIPAA/SOC 2 indexed retrieval with citations.
4. Ephemeral workers: scoped temporary tokens plus GitHub/GCP connector path.
5. Audit export: signed compliance export and verifier.
6. Latency and red-team evidence: official NFR benchmark and adversarial harness.
7. CI/CD hardening: SAST, dependency scan, image build, Terraform plan, benchmark gates.
