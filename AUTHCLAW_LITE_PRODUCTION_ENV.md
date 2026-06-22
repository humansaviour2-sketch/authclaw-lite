# AuthClaw Lite Production Environment

Use these values when deploying Lite behind HTTPS on AWS.

Copy `.env.production.example` to `.env.production` for the full deploy template.

```env
AUTHCLAW_ENV=production
NEXT_PUBLIC_AUTHCLAW_DEMO_MODE=false
DEMO_OTP_VISIBLE=false
AUTHCLAW_COOKIE_SECURE=true

NEXT_PUBLIC_API_URL=https://console.yourdomain.com
NEXT_PUBLIC_GATEWAY_URL=https://gateway.yourdomain.com
PUBLIC_GATEWAY_URL=https://gateway.yourdomain.com

JWT_SECRET=<random-long-secret>
SESSION_SECRET=<random-long-secret>
ENVELOPE_KEY=<32+-byte-random-secret>

SMTP_HOST=email-smtp.<region>.amazonaws.com
SMTP_PORT=587
SMTP_USER=<ses-smtp-username>
SMTP_PASSWORD=<ses-smtp-password>
SMTP_FROM=no-reply@yourdomain.com
SMTP_TLS=true
```

Production startup fails if demo secrets, visible demo OTP, missing SMTP, or non-HTTPS gateway URLs are configured.
