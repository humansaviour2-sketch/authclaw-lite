from __future__ import annotations

import hashlib
import os
import secrets
import smtplib
import uuid
from datetime import datetime, timedelta, timezone
from email.message import EmailMessage

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import create_engine, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, sessionmaker

from app.core.auth import get_tenant_db, require_scopes
from app.db.models import (
    APIKey,
    GatewayConfig,
    OnboardingEmailOTP,
    OnboardingStatus,
    Policy,
    Tenant,
    User,
)
from app.schemas.models import (
    OnboardingChecklistResponse,
    OnboardingSignupRequest,
    OnboardingSignupResponse,
    OnboardingVerifyRequest,
    OnboardingVerifyResponse,
)

router = APIRouter()

DEFAULT_PROVIDER = "gemini"
DEFAULT_MODEL = "gemini-2.5-flash-lite"
DEFAULT_ENDPOINT = "https://generativelanguage.googleapis.com"

STARTER_POLICY = r'''regex_rules:
  - name: customer_email
    pattern: "\\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}\\b"
    reason: "Email addresses are redacted before model egress."
    severity: medium
    action: redact

  - name: patient_health_data
    pattern: "(?i)\\b(patient|diagnosis|prescription|medical record)\\b"
    reason: "Health context requires human approval before model egress."
    severity: high
    action: require_approval
    hitl_timeout_seconds: 300

  - name: ssn_block
    pattern: "\\b\\d{3}-\\d{2}-\\d{4}\\b"
    reason: "SSNs are blocked in the Lite starter policy."
    severity: critical
    action: block

model_rules:
  whitelist:
    - gpt-4o-mini
    - gemini-2.5-flash-lite
  blacklist: []

topic_rules: []

rate_limits:
  requests_per_minute: 60
'''


def _normalize_database_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    return url


def _owner_sessionmaker():
    database_url = _normalize_database_url(
        os.getenv("OWNER_DATABASE_URL")
        or os.getenv("DATABASE_URL", "postgresql+psycopg://authclaw:authclaw@localhost:5432/authclaw")
    )
    engine = create_engine(database_url, pool_pre_ping=True)
    return sessionmaker(autocommit=False, autoflush=False, bind=engine)


OwnerSessionLocal = _owner_sessionmaker()


def _otp_hash(email: str, otp: str) -> str:
    secret = os.getenv("SESSION_SECRET") or os.getenv("JWT_SECRET") or "authclaw-lite-dev-secret"
    material = f"{email.strip().lower()}:{otp}:{secret}".encode("utf-8")
    return hashlib.sha256(material).hexdigest()


def _api_key_hash(raw_key: str) -> str:
    return hashlib.sha256(raw_key.encode("utf-8")).hexdigest()


def _generate_otp() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _generate_gateway_key() -> str:
    return "acl_live_" + secrets.token_urlsafe(24)


def _send_otp_email(email: str, otp: str, tenant_name: str) -> str:
    smtp_host = os.getenv("SMTP_HOST", "")
    if not smtp_host:
        print(f"[ONBOARDING] Email OTP for {email} ({tenant_name}): {otp}")
        return "console"

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", "")
    smtp_password = os.getenv("SMTP_PASSWORD", "")
    smtp_from = os.getenv("SMTP_FROM", "no-reply@authclaw.local")

    message = EmailMessage()
    message["Subject"] = "Your AuthClaw verification code"
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(
        f"Your AuthClaw verification code is {otp}.\n\n"
        f"It expires in 15 minutes for tenant setup: {tenant_name}."
    )

    with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
        if os.getenv("SMTP_TLS", "true").lower() == "true":
            server.starttls()
        if smtp_user:
            server.login(smtp_user, smtp_password)
        server.send_message(message)
    return "smtp"


def _checklist(status_row: OnboardingStatus) -> OnboardingChecklistResponse:
    return OnboardingChecklistResponse(
        email_verified=status_row.email_verified,
        tenant_created=status_row.tenant_created,
        api_key_issued=status_row.api_key_issued,
        provider_key_saved=status_row.provider_key_saved,
        route_created=status_row.route_created,
        policy_created=status_row.policy_created,
        snippet_viewed=status_row.snippet_viewed,
        current_step=status_row.current_step,
    )


def _snippets(api_key: str, gateway_url: str) -> tuple[str, str]:
    endpoint = f"{gateway_url.rstrip('/')}/v1/models/{DEFAULT_MODEL}:generateContent"
    powershell = f'''$body = @{{
  contents = @(
    @{{
      parts = @(
        @{{ text = "My email is jane@example.com. Make this support response safer." }}
      )
    }}
  )
}} | ConvertTo-Json -Depth 6

Invoke-WebRequest `
  -Uri "{endpoint}" `
  -Method Post `
  -Headers @{{
    Authorization = "Bearer {api_key}"
    "X-Provider" = "{DEFAULT_PROVIDER}"
    "X-Request-ID" = "onboarding-test-001"
  }} `
  -ContentType "application/json" `
  -Body $body'''
    curl = f'''curl -X POST "{endpoint}" \\
  -H "Authorization: Bearer {api_key}" \\
  -H "X-Provider: {DEFAULT_PROVIDER}" \\
  -H "X-Request-ID: onboarding-test-001" \\
  -H "Content-Type: application/json" \\
  --data-raw '{{"contents":[{{"parts":[{{"text":"My email is jane@example.com. Make this support response safer."}}]}}]}}'
'''
    return powershell, curl


@router.post("/signup", response_model=OnboardingSignupResponse, status_code=status.HTTP_202_ACCEPTED)
def signup(payload: OnboardingSignupRequest):
    email = payload.email.strip().lower()
    tenant_name = payload.tenant_name.strip()
    otp = _generate_otp()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=15)

    db = OwnerSessionLocal()
    try:
        existing_user = db.query(User).filter(User.email == email, User.is_active == True).first()
        if existing_user:
            raise HTTPException(status_code=409, detail="An active user already exists for this email")

        existing_tenant = db.query(Tenant).filter(Tenant.name == tenant_name).first()
        if existing_tenant:
            raise HTTPException(status_code=409, detail="Tenant name is already taken")

        signup_row = OnboardingEmailOTP(
            email=email,
            tenant_name=tenant_name,
            otp_hash=_otp_hash(email, otp),
            expires_at=expires_at,
        )
        db.add(signup_row)
        db.commit()
        db.refresh(signup_row)

        delivery = _send_otp_email(email, otp, tenant_name)
        dev_otp = otp if delivery == "console" and os.getenv("NEXT_PUBLIC_AUTHCLAW_DEMO_MODE", "true").lower() != "false" else None
        return OnboardingSignupResponse(
            signup_id=signup_row.id,
            email=email,
            tenant_name=tenant_name,
            expires_at=expires_at,
            delivery=delivery,
            dev_otp=dev_otp,
        )
    except HTTPException:
        db.rollback()
        raise
    finally:
        db.close()


@router.post("/verify", response_model=OnboardingVerifyResponse)
def verify(payload: OnboardingVerifyRequest):
    now = datetime.now(timezone.utc)
    gateway_url = os.getenv("PUBLIC_GATEWAY_URL") or os.getenv("NEXT_PUBLIC_GATEWAY_URL") or "http://localhost:18080"

    db = OwnerSessionLocal()
    try:
        signup_row = db.query(OnboardingEmailOTP).filter(OnboardingEmailOTP.id == payload.signup_id).first()
        if not signup_row:
            raise HTTPException(status_code=404, detail="Signup request not found")
        if signup_row.status == "verified":
            raise HTTPException(status_code=409, detail="Signup request already verified")
        if signup_row.status != "pending":
            raise HTTPException(status_code=400, detail="Signup request is not pending")
        expires_at = signup_row.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < now:
            signup_row.status = "expired"
            db.commit()
            raise HTTPException(status_code=400, detail="Verification code expired")
        if signup_row.attempts >= 5:
            raise HTTPException(status_code=429, detail="Too many verification attempts")

        signup_row.attempts += 1
        if signup_row.otp_hash != _otp_hash(signup_row.email, payload.otp):
            db.commit()
            raise HTTPException(status_code=400, detail="Invalid verification code")

        if db.query(User).filter(User.email == signup_row.email, User.is_active == True).first():
            raise HTTPException(status_code=409, detail="An active user already exists for this email")
        if db.query(Tenant).filter(Tenant.name == signup_row.tenant_name).first():
            raise HTTPException(status_code=409, detail="Tenant name is already taken")

        tenant = Tenant(name=signup_row.tenant_name, tier="starter", status="active")
        db.add(tenant)
        db.flush()
        db.execute(text("SELECT set_config('app.current_tenant_id', :tenant_id, false)"), {"tenant_id": str(tenant.id)})

        user = User(
            tenant_id=tenant.id,
            email=signup_row.email,
            role="owner",
            mfa_enabled=False,
            is_active=True,
        )
        db.add(user)
        db.flush()

        raw_api_key = _generate_gateway_key()
        api_key = APIKey(
            tenant_id=tenant.id,
            key_hash=_api_key_hash(raw_api_key),
            name="Default Gateway Key",
            description="Issued during AuthClaw Lite onboarding",
            scopes=["admin", "read", "write"],
            is_active=True,
            created_by=user.id,
        )
        db.add(api_key)

        gateway = GatewayConfig(
            tenant_id=tenant.id,
            name="Default Gemini Route",
            provider=DEFAULT_PROVIDER,
            endpoint=DEFAULT_ENDPOINT,
            model_whitelist=[DEFAULT_MODEL],
            redaction_strategy="mask",
            is_active=True,
        )
        db.add(gateway)

        policy = Policy(
            tenant_id=tenant.id,
            name="AuthClaw Lite Starter Policy",
            description="Starter policy with redact, HITL, and block actions.",
            policy_yaml=STARTER_POLICY,
            version=1,
            is_active=True,
            created_by=user.id,
        )
        db.add(policy)
        db.flush()

        status_row = OnboardingStatus(
            tenant_id=tenant.id,
            user_id=user.id,
            signup_id=signup_row.id,
            email_verified=True,
            tenant_created=True,
            api_key_issued=True,
            provider_key_saved=False,
            route_created=True,
            policy_created=True,
            current_step="connect_provider",
        )
        db.add(status_row)

        signup_row.status = "verified"
        signup_row.verified_at = now
        signup_row.tenant_id = tenant.id
        signup_row.api_key_id = api_key.id
        db.commit()
        db.refresh(status_row)

        powershell, curl = _snippets(raw_api_key, gateway_url)
        return OnboardingVerifyResponse(
            tenant_id=tenant.id,
            tenant_name=tenant.name,
            user_id=user.id,
            email=user.email,
            role=user.role,
            api_key=raw_api_key,
            gateway_url=gateway_url,
            provider=DEFAULT_PROVIDER,
            model=DEFAULT_MODEL,
            checklist=_checklist(status_row),
            powershell_snippet=powershell,
            curl_snippet=curl,
        )
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=409, detail="Tenant or user already exists") from exc
    except HTTPException:
        db.rollback()
        raise
    finally:
        db.execute(text("SELECT set_config('app.current_tenant_id', '', false)"))
        db.close()


@router.get("/status", response_model=OnboardingChecklistResponse, dependencies=[require_scopes(["read"])])
def onboarding_status(request: Request, db: Session = Depends(get_tenant_db)):
    tenant_id = request.state.tenant_id
    status_row = db.query(OnboardingStatus).filter(OnboardingStatus.tenant_id == tenant_id).first()
    if not status_row:
        raise HTTPException(status_code=404, detail="Onboarding status not found")
    return _checklist(status_row)
