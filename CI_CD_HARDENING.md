# AuthClaw CI/CD Hardening

This is the production gate set for the MVP SRS CI/CD gap.

## Required Pull Request Gates

- CodeQL SAST runs for Python, TypeScript, and Go.
- Gitleaks blocks committed secrets.
- `pip-audit`, `npm audit`, and `govulncheck` block vulnerable dependencies.
- Trivy filesystem scanning blocks high/critical vulnerability, secret, and IaC findings.
- Backend migrations run against Postgres before backend tests.
- Backend, audit-consumer, gateway deterministic, and console lint/type/build suites must pass.
- Full-stack Docker Compose integration starts the demo stack with a deterministic mock provider.
- Smoke tests verify backend, gateway, console, Redis, and public Trust Center routing.
- Gateway latency benchmark writes `gateway-benchmark-ci.json` and fails when p95/p99 thresholds regress.
- Terraform format, validation, and speculative `plan -refresh=false` must pass.
- Docker images are built for backend, gateway, console, audit consumer, and OPA bundle.
- Built images are scanned by Trivy before any push.

## Push / Release Behavior

On pushes to `main` or `master`, the same gates run and scanned images are pushed to GHCR:

- `ghcr.io/<owner>/<repo>/backend`
- `ghcr.io/<owner>/<repo>/gateway`
- `ghcr.io/<owner>/<repo>/console`
- `ghcr.io/<owner>/<repo>/audit-consumer`
- `ghcr.io/<owner>/<repo>/opa-bundle`

Every image receives branch/ref tags, SHA tags, and `latest` on the default branch.

## Security Fail Policy

The build is intentionally fail-closed:

- High or critical dependency/image vulnerabilities fail the workflow.
- Committed secrets fail the workflow.
- IaC high/critical misconfiguration findings fail the workflow.
- Terraform format or speculative plan failures block merge.
- Integration smoke or benchmark threshold failures block merge.

Temporary exceptions must be handled by fixing the dependency/configuration or adding a narrowly scoped ignore file with owner approval and an expiry date.

## Benchmark Gate

The CI benchmark uses the AuthClaw gateway, seeded demo tenant, and `scripts/mock_llm_provider.py` so it does not require real provider credentials. Current CI thresholds:

- Scenarios: `allow,redact,block`
- Requests per scenario: `12`
- Concurrency: `3`
- p95: `900 ms`
- p99: `1200 ms`
- Max failure rate: `0%`

The heavier local benchmark profile remains the source for official NFR threshold updates before release sign-off.

## Terraform Plan Gate

`infra/terraform/ci.tfvars.json` supplies placeholder images and enables `ci_skip_aws_validation`, allowing a speculative plan without AWS credentials or cloud-state refresh. Staging/prod plans should use real remote state and cloud credentials through protected environments.

## Manual Gateway Verification

`gateway/manual_verify_test.go` is excluded from normal CI via the `manual` build tag because it intentionally manipulates local Docker containers. Run it explicitly when needed:

```bash
go test -tags manual ./gateway -run TestManualVerificationScenarios
```
