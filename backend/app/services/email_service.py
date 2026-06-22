from __future__ import annotations

import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage


@dataclass(frozen=True)
class EmailDeliveryResult:
    method: str
    detail: str


class EmailDeliveryError(RuntimeError):
    pass


def demo_otp_visible() -> bool:
    return os.getenv("DEMO_OTP_VISIBLE", os.getenv("NEXT_PUBLIC_AUTHCLAW_DEMO_MODE", "true")).lower() == "true"


def smtp_configured() -> bool:
    return bool(os.getenv("SMTP_HOST", "").strip())


def send_otp_email(email: str, otp: str, tenant_name: str) -> EmailDeliveryResult:
    smtp_host = os.getenv("SMTP_HOST", "").strip()
    if not smtp_host:
        if demo_otp_visible():
            print(f"[ONBOARDING] Email OTP for {email} ({tenant_name}): {otp}")
            return EmailDeliveryResult(method="console", detail="OTP logged for local demo")
        raise EmailDeliveryError("Email delivery is not configured")

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER", os.getenv("SMTP_USERNAME", "")).strip()
    smtp_password = os.getenv("SMTP_PASSWORD", os.getenv("SMTP_PASS", ""))
    smtp_from = os.getenv("SMTP_FROM", os.getenv("EMAIL_FROM", "no-reply@authclaw.local")).strip()
    smtp_tls = os.getenv("SMTP_TLS", os.getenv("SMTP_STARTTLS", "true")).lower() == "true"

    message = EmailMessage()
    message["Subject"] = "Your AuthClaw verification code"
    message["From"] = smtp_from
    message["To"] = email
    message.set_content(
        f"Your AuthClaw verification code is {otp}.\n\n"
        f"It expires in 15 minutes for tenant setup: {tenant_name}.\n\n"
        "If you did not request this code, you can ignore this email."
    )

    try:
        with smtplib.SMTP(smtp_host, smtp_port, timeout=10) as server:
            if smtp_tls:
                server.starttls()
            if smtp_user:
                server.login(smtp_user, smtp_password)
            server.send_message(message)
    except Exception as exc:
        raise EmailDeliveryError(f"Could not send verification email: {exc}") from exc

    return EmailDeliveryResult(method="smtp", detail="OTP sent by SMTP")
