# AuthClaw Gateway Service 🚪

The AuthClaw Gateway is a high-performance Go-based reverse proxy that intercepts and routes requests to LLM providers (OpenAI, Anthropic, Cohere, Azure OpenAI) under strict multi-tenant isolation, logging audit events for security and compliance.

## 🏗️ Architecture

- **Auth Middleware**: Extracts API keys from the `Authorization: Bearer <key>` header, hashes it with SHA-256, validates it against the control plane PostgreSQL database, and injects the resolved `tenant_id` into the request context.
- **Payload Normalization**: The adapter layer parses and normalizes provider-specific payloads (like OpenAI chat completions or Anthropic messages) into a generic structure to prepare for security audits and redactions.
- **Dynamic Routing**: Re-writes request headers and URLs to proxy the requests transparently to downstream endpoints.
- **Audit Logging**: Emits traffic events (including latency, prompt metrics, and status code) to stdout as a stub for the Kafka backbone.

## Provider Compatibility

| Provider | Gateway route | Upstream auth injection | Streaming format |
| --- | --- | --- | --- |
| OpenAI | `/v1/chat/completions` | `Authorization: Bearer <provider key>` | OpenAI `data:` chat deltas |
| Anthropic | `/v1/messages` | `x-api-key` plus `anthropic-version` | Anthropic `content_block_delta` events |
| Cohere | `/v2/chat` | `Authorization: Bearer <provider key>` | Cohere `content-delta` events |
| Azure OpenAI | `/v1/chat/completions` with `X-Provider: azure_openai`, backed by a deployment-scoped endpoint, or direct `/openai/deployments/.../chat/completions` | `api-key` plus `api-version` query | OpenAI-compatible chat deltas |
| Gemini | `/v1/models/{model}:generateContent` | `x-goog-api-key` plus `key` query | Gemini candidate part deltas |

For Azure OpenAI, save the provider credential endpoint as the deployment-scoped URL, for example
`https://YOUR_RESOURCE.openai.azure.com/openai/deployments/YOUR_DEPLOYMENT/chat/completions`.
Set `AZURE_OPENAI_API_VERSION` to override the default `2024-10-21` query parameter.

---

## 🚀 Running Locally

### 1. Prerequisites
- Go 1.21+
- PostgreSQL database (running from root `docker-compose.yml`)

### 2. Start the Gateway
Ensure the database is running (`docker-compose up -d` in the project root). Then, start the gateway:

```bash
cd gateway
go run .
```

The gateway will start and listen on `http://localhost:8080`.

---

## 🧪 Testing

Run the full Go suite, which includes unit tests for health checks, payload extraction/re-serialization, database authentication checks, dynamic proxy routing, and payload fidelity contract checks:

```bash
cd gateway
go test -v
```

---

## 📡 Local curl Verification

To test the gateway locally:

### 1. Create a Test API Key (via Database)
Ensure you have created a tenant, a user, and a valid API key in PostgreSQL. You can verify this by running:
```sql
SELECT key_hash FROM api_keys;
```

### 2. Make a request
Run a curl command pointing to the local gateway (which will authenticate and proxy requests to target providers):

```bash
curl -X POST http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer <your_authclaw_api_key>" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello, gateway!"}
    ]
  }'
```

### 4. Run latency/load benchmarks

After the demo stack is running and seeded, run the gateway latency benchmark from
the repository root:

```bash
python scripts/gateway_latency_benchmark.py --ci
```

The benchmark reports total p50/p95/p99 latency, p95 time-to-first-byte,
throughput, status-code counts, and threshold failures for the default safe
scenarios. The `--ci` profile keeps request volume below the demo gateway's
default rate limits; raise `GATEWAY_RATE_LIMIT_*` before using larger request
counts for heavier load tests.

Official local NFR thresholds are p95 <= 800ms and p99 <= 1000ms for
100 requests per scenario at concurrency 5 against the local mock provider.
Gateway redaction uses `PRESIDIO_ANALYZE_TIMEOUT_MS=750` by default, then falls
back to local regex analysis with structured `[REDACTION]` fallback logs when
Presidio is slow or unavailable.
For redaction stress evidence, the benchmark also supports a concurrency-10
profile with 1200ms p95 and 1500ms p99 thresholds after raising gateway and
policy rate limits.

- `allow`: normal allowed request
- `redact`: request containing PII that should be redacted
- `block`: request matching the starter policy's SSN block rule

Useful variants:

```bash
# Include a streaming response scenario when the configured provider supports it.
python scripts/gateway_latency_benchmark.py --scenarios allow,redact,block,stream

# Write machine-readable results for CI/release evidence.
python scripts/gateway_latency_benchmark.py --ci --json-output gateway-benchmark.json

# Heavier local NFR evidence profile after raising gateway and policy rate limits.
python scripts/gateway_latency_benchmark.py --scenarios allow,redact,block,stream --requests 100 --concurrency 5 --warmup 5 --json-output gateway-benchmark-heavy.json

# Redaction/concurrency stress evidence profile after raising gateway and policy rate limits.
python scripts/gateway_latency_benchmark.py --scenarios allow,redact,block,stream --requests 100 --concurrency 10 --warmup 5 --json-output gateway-benchmark-concurrency10.json --p95-threshold-ms 1200 --p99-threshold-ms 1500

# HITL is intentionally opt-in because the SRS timeout is 30 minutes.
python scripts/gateway_latency_benchmark.py --scenarios hitl --allow-hitl --timeout-seconds 1900
```
