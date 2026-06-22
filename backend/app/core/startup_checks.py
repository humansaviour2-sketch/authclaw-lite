"""Startup validation for production Lite deployments."""
import os


_DEMO_VALUES = {
    "change-this-demo-jwt-secret",
    "change-this-demo-session-secret",
    "change-this-demo-envelope-key",
    "demo-change-me",
    "demo-local-envelope-key-change-me",
    "authclaw-default-32-byte-key-12",
    "your-256-bit-hex-encoded-key-here",
    "dev-secret-change-in-production",
}


def is_production() -> bool:
    return os.getenv("AUTHCLAW_ENV", "").strip().lower() == "production"


def _is_missing_or_demo(value: str | None) -> bool:
    if not value:
        return True
    return value.strip() in _DEMO_VALUES or value.strip().startswith("change-this")


def validate_production_environment() -> None:
    if not is_production():
        return

    errors: list[str] = []
    for name in ("JWT_SECRET", "SESSION_SECRET", "ENVELOPE_KEY"):
        if _is_missing_or_demo(os.getenv(name)):
            errors.append(f"{name} must be set to a non-demo secret")

    envelope_key = os.getenv("ENVELOPE_KEY", "")
    if envelope_key and len(envelope_key.encode("utf-8")) < 32:
        errors.append("ENVELOPE_KEY must be at least 32 bytes")

    if os.getenv("DEMO_OTP_VISIBLE", "false").lower() == "true":
        errors.append("DEMO_OTP_VISIBLE must be false in production")

    if not os.getenv("SMTP_HOST", "").strip():
        errors.append("SMTP_HOST must be configured for production email OTP")

    if not (os.getenv("SMTP_FROM") or os.getenv("EMAIL_FROM")):
        errors.append("SMTP_FROM or EMAIL_FROM must be configured")

    public_gateway = os.getenv("PUBLIC_GATEWAY_URL") or os.getenv("NEXT_PUBLIC_GATEWAY_URL", "")
    if public_gateway and not public_gateway.startswith("https://"):
        errors.append("PUBLIC_GATEWAY_URL/NEXT_PUBLIC_GATEWAY_URL must use https:// in production")

    if errors:
        joined = "; ".join(errors)
        raise RuntimeError(f"Production environment validation failed: {joined}")
