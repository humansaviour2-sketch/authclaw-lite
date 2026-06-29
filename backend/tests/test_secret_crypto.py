from app.core.crypto import decrypt_secret, encrypt_deterministic, encrypt_secret


def test_provider_secret_encryption_is_randomized_and_round_trips(monkeypatch):
    monkeypatch.setenv("ENVELOPE_KEY", "test-envelope-key-material-32-bytes!!")
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)

    first = encrypt_secret("sk-provider-secret")
    second = encrypt_secret("sk-provider-secret")

    assert first.startswith("authclaw-secret-v1:")
    assert second.startswith("authclaw-secret-v1:")
    assert first != second
    assert decrypt_secret(first) == "sk-provider-secret"
    assert decrypt_secret(second) == "sk-provider-secret"


def test_provider_secret_decrypt_supports_legacy_deterministic_rows(monkeypatch):
    monkeypatch.setenv("ENVELOPE_KEY", "test-envelope-key-material-32-bytes!!")
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)

    legacy = encrypt_deterministic("legacy-provider-secret")

    assert not legacy.startswith("authclaw-secret-v1:")
    assert decrypt_secret(legacy) == "legacy-provider-secret"
