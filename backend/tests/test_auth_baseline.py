from app.core import oidc
from app.schemas.models import APIKeyCreate, APIKeyRotate


def test_api_key_create_rejects_unknown_scope():
    try:
        APIKeyCreate(name="bad", scopes=["read", "root"])
    except ValueError as exc:
        assert "Unsupported API key scopes" in str(exc)
    else:
        raise AssertionError("unknown scope should be rejected")


def test_api_key_create_normalizes_scopes_and_expiry():
    key = APIKeyCreate(name="ci", scopes=["write", "read", "read"], expires_in_days=30)

    assert key.scopes == ["read", "write"]
    assert key.expires_in_days == 30


def test_api_key_rotate_inherits_scopes_when_omitted():
    rotation = APIKeyRotate()

    assert rotation.scopes is None
    assert rotation.expires_in_days == 90


def test_oidc_config_disabled_without_env(monkeypatch):
    monkeypatch.delenv("OIDC_ISSUER_URL", raising=False)
    monkeypatch.delenv("OIDC_CLIENT_ID", raising=False)
    monkeypatch.delenv("OIDC_REDIRECT_URI", raising=False)

    config = oidc.oidc_config()

    assert config["enabled"] is False
    assert config["authorization_url"] == ""


def test_oidc_config_builds_authorization_url(monkeypatch):
    monkeypatch.setenv("OIDC_ISSUER_URL", "https://idp.example.com")
    monkeypatch.setenv("OIDC_CLIENT_ID", "authclaw-console")
    monkeypatch.setenv("OIDC_REDIRECT_URI", "https://authclaw.example.com/callback")

    config = oidc.oidc_config()

    assert config["enabled"] is True
    assert config["authorization_endpoint"] == "https://idp.example.com/authorize"
    assert "client_id=authclaw-console" in config["authorization_url"]
