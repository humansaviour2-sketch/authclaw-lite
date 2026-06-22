# AuthClaw Lite AWS Deployment Checklist

This checklist is for a private AWS demo or pilot of AuthClaw Lite. It is not the full enterprise production architecture.

## Target State

- Console: `https://app.yourdomain.com`
- Gateway: `https://gateway.yourdomain.com`
- Backend: internal service behind console, optionally `https://api.yourdomain.com` for debugging
- Signup OTP: real email through Amazon SES SMTP
- Runtime model traffic: customer chatbot sends requests to AuthClaw Gateway
- Provider keys: saved per tenant in the encrypted provider key vault
- Audit: Postgres fallback with hash-chain verification for new records

## AWS Services

Minimum private demo:

- EC2 instance running Docker Compose
- EBS volume for Docker/Postgres data
- Route 53 hosted zone or external DNS
- ACM certificate if using ALB, or Caddy/Nginx-managed Lets Encrypt on EC2
- Amazon SES SMTP credentials for OTP email
- Security Group locked to `80/443` public, `22` from your IP only
- AWS Budget alerts

Recommended next step after demo:

- RDS Postgres instead of container Postgres
- ElastiCache Redis instead of container Redis
- ECS/Fargate or App Runner for backend/gateway/console
- Secrets Manager or SSM Parameter Store for secrets
- CloudWatch logs and alarms

## Preflight

- [ ] Domain/subdomains decided: `app`, `gateway`, optional `api`
- [ ] SES sender or domain verified
- [ ] SES production access requested if sending outside verified test addresses
- [ ] AWS Budget alerts created
- [ ] EC2 key pair or SSM access ready
- [ ] Strong secrets generated for `JWT_SECRET`, `SESSION_SECRET`, `ENVELOPE_KEY`
- [ ] `.env.production` created from `.env.production.example`
- [ ] `AUTHCLAW_ENV=production`
- [ ] `DEMO_OTP_VISIBLE=false`
- [ ] `NEXT_PUBLIC_AUTHCLAW_DEMO_MODE=false`
- [ ] `AUTHCLAW_COOKIE_SECURE=true`
- [ ] Public URLs use `https://`
- [ ] No global provider API key is used for tenant runtime traffic
- [ ] Gateway limits are set: `30/min`, `10/10s`, `1000/day`, `128KB` max body
- [ ] Signup limits are set: `3/hour/email`, `10/day/IP`, `30 verify attempts/hour/IP`

## EC2 Security Group

Open only:

- `22/tcp` from your IP, or use SSM and close SSH
- `80/tcp` from internet for HTTP challenge/redirect
- `443/tcp` from internet for console and gateway

Keep private/closed:

- `3001` console
- `8000` backend
- `8080` gateway
- `5432` Postgres
- `6379` Redis
- `8181` OPA
- `3000` Presidio

## Deploy Steps

1. Install Docker and Git on EC2.

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-plugin git
sudo usermod -aG docker ubuntu
newgrp docker
```

2. Clone repo and create production env.

```bash
git clone <repo-url> authclaw
cd authclaw
cp .env.production.example .env.production
nano .env.production
```

3. Configure reverse proxy for HTTPS.

Example routes:

```text
app.yourdomain.com     -> 127.0.0.1:3001
gateway.yourdomain.com -> 127.0.0.1:8080
api.yourdomain.com     -> 127.0.0.1:8000 optional
```

4. Start AuthClaw Lite.

```bash
docker compose --env-file .env.production -f docker-compose.demo.yml up -d --build
```

5. Confirm services.

```bash
docker compose --env-file .env.production -f docker-compose.demo.yml ps
docker compose --env-file .env.production -f docker-compose.demo.yml logs --tail=100 backend
docker compose --env-file .env.production -f docker-compose.demo.yml logs --tail=100 gateway
```

## Required Smoke Tests

Run these before calling the deployment usable:

- [ ] `https://app.yourdomain.com/login` loads
- [ ] Signup sends a real OTP email through SES
- [ ] OTP verification creates a new tenant
- [ ] `/connect` shows first AuthClaw gateway key and HTTPS gateway URL
- [ ] Saving Gemini provider key succeeds
- [ ] One-click gateway test succeeds
- [ ] Manual chatbot-style request through `https://gateway.yourdomain.com` returns `200`
- [ ] SSN request returns `403 PolicyBlocked`
- [ ] `/audit` shows `redact`, `allow`, and `block`
- [ ] New audit records show non-empty `prior_hash` and `integrity_hash`
- [ ] Integrity verification shows `chain_valid: true` for new records
- [ ] Fresh tenant without provider key cannot call gateway directly
- [ ] OpenAI path shows graceful missing-key behavior when no OpenAI key exists
- [ ] Gateway rate limit returns `429 RateLimitExceeded` when the burst cap is exceeded

## PowerShell Gateway Smoke

```powershell
$body = @{
  contents = @(
    @{
      parts = @(
        @{ text = "My email is jane@example.com. Make this support response safer." }
      )
    }
  )
} | ConvertTo-Json -Depth 6

Invoke-WebRequest `
  -Uri "https://gateway.yourdomain.com/v1/models/gemini-2.5-flash-lite:generateContent" `
  -Method Post `
  -Headers @{
    Authorization = "Bearer <AUTHCLAW_GATEWAY_KEY>"
    "X-Provider" = "gemini"
    "X-Request-ID" = "aws-smoke-001"
  } `
  -ContentType "application/json" `
  -Body $body
```

## Go/No-Go

Go for private demo when:

- All smoke tests pass
- No demo OTP is visible
- Signup email is real
- Public URLs are HTTPS
- Tenant provider key isolation is verified
- Audit hash chain verifies on new records
- Stack restart survives `docker compose up -d`

No-go when:

- Any production startup check fails
- Console uses HTTP URLs in generated snippets
- Any tenant can use a provider without saving its own provider key
- OTP only appears on screen instead of email
- Audit records are missing for allow/block traffic

## Known Local Cleanup Before CI

- `go test ./...` currently fails because `gateway/redact_test.go` calls an older `RedactPrompts` signature. Fix this before making CI a release gate.
- Repo-wide lint still has existing issues. Clean before public beta, but it does not block a private AWS smoke demo.
