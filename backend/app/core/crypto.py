"""Cryptographic utilities for token decryption"""
import base64
import os
import hashlib
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.backends import default_backend

SECRET_ENVELOPE_PREFIX = "authclaw-secret-v1:"


def get_encryption_key() -> bytes:
    """Gets the encryption key and pads/truncates it to 32 bytes (matching Go gateway)"""
    key_str = os.getenv("ENCRYPTION_KEY")
    if not key_str:
        key_str = os.getenv("ENVELOPE_KEY")
    if not key_str:
        if os.getenv("AUTHCLAW_ENV", "").lower() == "production":
            raise RuntimeError("ENVELOPE_KEY is required in production")
        key_str = "authclaw-default-32-byte-key-12"

    key_bytes = key_str.encode("utf-8")
    if len(key_bytes) > 32:
        return key_bytes[:32]
    elif len(key_bytes) < 32:
        return key_bytes + b"\x00" * (32 - len(key_bytes))
    return key_bytes


def decrypt_deterministic(ciphertext_str: str) -> str:
    """Decrypts base64 encoded ciphertext using AES-256 CBC with a derived IV (matching Go gateway)"""
    key = get_encryption_key()
    try:
        data = base64.b64decode(ciphertext_str)
        if len(data) < 16:
            raise ValueError("Ciphertext too short")
        iv = data[:16]
        ciphertext = data[16:]

        cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
        decryptor = cipher.decryptor()
        padded_plaintext = decryptor.update(ciphertext) + decryptor.finalize()

        # PKCS7 unpadding
        padding_len = padded_plaintext[-1]
        if padding_len < 1 or padding_len > 16:
            raise ValueError("Invalid padding length")
        
        # Verify padding bytes
        for b in padded_plaintext[-padding_len:]:
            if b != padding_len:
                raise ValueError("Invalid padding content")

        return padded_plaintext[:-padding_len].decode("utf-8")
    except Exception as e:
        raise ValueError(f"Failed to decrypt value: {str(e)}")


def _pkcs7_pad(data: bytes) -> bytes:
    padding = 16 - (len(data) % 16)
    return data + bytes([padding]) * padding


def encrypt_deterministic(plaintext: str) -> str:
    """Encrypts plaintext using the AES-CBC format the Go gateway can decrypt."""
    key = get_encryption_key()
    plaintext_bytes = plaintext.encode("utf-8")
    iv = hashlib.sha256(plaintext_bytes + key).digest()[:16]
    cipher = Cipher(algorithms.AES(key), modes.CBC(iv), backend=default_backend())
    encryptor = cipher.encryptor()
    ciphertext = encryptor.update(_pkcs7_pad(plaintext_bytes)) + encryptor.finalize()
    return base64.b64encode(iv + ciphertext).decode("utf-8")


def encrypt_secret(plaintext: str) -> str:
    """Encrypts provider/API secrets with randomized AES-GCM envelope encryption."""
    key = get_encryption_key()
    nonce = os.urandom(12)
    ciphertext = AESGCM(key).encrypt(nonce, plaintext.encode("utf-8"), None)
    return SECRET_ENVELOPE_PREFIX + base64.b64encode(nonce + ciphertext).decode("utf-8")


def decrypt_secret(ciphertext_str: str) -> str:
    """Decrypts randomized provider/API secrets, falling back for legacy rows."""
    if not ciphertext_str.startswith(SECRET_ENVELOPE_PREFIX):
        return decrypt_deterministic(ciphertext_str)

    payload = ciphertext_str[len(SECRET_ENVELOPE_PREFIX):]
    try:
        data = base64.b64decode(payload)
        if len(data) <= 12:
            raise ValueError("Ciphertext too short")
        nonce = data[:12]
        ciphertext = data[12:]
        plaintext = AESGCM(get_encryption_key()).decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
    except Exception as e:
        raise ValueError(f"Failed to decrypt secret: {str(e)}")
