"""
Clinical cryptography primitives for MindEase (Phase 4).

Two independent concerns live here:

  1. RSA-2048 doctor signatures
     -------------------------------------------------------------------------
     Each doctor owns an RSA-2048 key-pair. The PUBLIC key (PEM/SPKI) is stored
     on their `users/{uid}` profile so anyone can verify their reports; the
     PRIVATE key is generated once, handed to the doctor as a downloadable PEM,
     and ALSO retained server-side (AES-encrypted, see below) so the backend can
     sign report hashes on their behalf.

     Signatures are RSASSA-PKCS1-v1_5 over a SHA-256 digest — the exact scheme
     the browser WebCrypto `subtle.verify('RSASSA-PKCS1-v1_5', ...)` understands,
     so the Patient Dashboard can verify a report with zero extra dependencies.

  2. AES-256-GCM field encryption
     -------------------------------------------------------------------------
     Sensitive clinical free-text (sessionNotes, diagnosis, prescriptions) is
     encrypted with AES-256-GCM under a single server-held master key before it
     is written to Firestore, and decrypted only for authenticated backend
     reads. GCM gives us confidentiality *and* tamper detection (the auth tag).

We use `pycryptodome` for both, matching the project's chosen crypto stack.
A missing/placeholder master key degrades gracefully (like the agora service):
encryption simply reports "not configured" rather than crashing the app.
"""
from __future__ import annotations

import base64
import hashlib
import json
import logging
import os

from Crypto.Cipher import AES
from Crypto.Hash import SHA256
from Crypto.PublicKey import RSA
from Crypto.Signature import pkcs1_15

from app.config import settings

logger = logging.getLogger("mindease.crypto")

RSA_KEY_BITS = 2048
_AES_KEY_BYTES = 32  # AES-256
_GCM_NONCE_BYTES = 12  # 96-bit nonce — the GCM standard
# Envelope marker so we can recognise (and version) our own ciphertext blobs.
_ENVELOPE_VERSION = "v1"


class CryptoConfigError(RuntimeError):
    """Raised when an operation needs the master key but it isn't configured."""


# ---------------------------------------------------------------------------
# Master key (for AES field encryption)
# ---------------------------------------------------------------------------
def _load_master_key() -> bytes | None:
    """
    Resolve the 32-byte AES master key from CLINICAL_MASTER_KEY.

    Accepts either a base64- or hex-encoded 32-byte value, or any longer
    passphrase (hashed down to 32 bytes with SHA-256). Returns None when no key
    is configured so callers can degrade gracefully.
    """
    raw = settings.CLINICAL_MASTER_KEY
    if not raw or raw.strip() in ("", "changeme", "your-master-key-here"):
        return None

    raw = raw.strip()
    # Try base64 (urlsafe and standard), then hex, then fall back to a SHA-256
    # KDF over the raw bytes so any passphrase yields a valid 256-bit key.
    for decoder in (base64.urlsafe_b64decode, base64.b64decode, bytes.fromhex):
        try:
            candidate = decoder(raw)
            if len(candidate) == _AES_KEY_BYTES:
                return candidate
        except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
            pass
    return hashlib.sha256(raw.encode("utf-8")).digest()


_MASTER_KEY = _load_master_key()


def encryption_configured() -> bool:
    """True when a usable AES master key is present."""
    return _MASTER_KEY is not None


def _require_master_key() -> bytes:
    if _MASTER_KEY is None:
        raise CryptoConfigError(
            "CLINICAL_MASTER_KEY is not configured — cannot encrypt/decrypt "
            "clinical fields. Set a 32-byte base64 key in the backend .env."
        )
    return _MASTER_KEY


# ---------------------------------------------------------------------------
# AES-256-GCM — encrypt/decrypt a single string field
# ---------------------------------------------------------------------------
def encrypt_text(plaintext: str) -> str:
    """
    Encrypt a UTF-8 string with AES-256-GCM and return a compact, self-describing
    base64 envelope: base64("v1" || nonce(12) || tag(16) || ciphertext).

    The envelope is safe to store directly in a Firestore string field.
    """
    key = _require_master_key()
    nonce = os.urandom(_GCM_NONCE_BYTES)
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(plaintext.encode("utf-8"))
    blob = _ENVELOPE_VERSION.encode("ascii") + nonce + tag + ciphertext
    return base64.b64encode(blob).decode("ascii")


def decrypt_text(token: str) -> str:
    """
    Reverse :func:`encrypt_text`. Raises ValueError on a malformed envelope or a
    failed authentication tag (i.e. the ciphertext was tampered with).
    """
    key = _require_master_key()
    try:
        blob = base64.b64decode(token)
    except (ValueError, base64.binascii.Error) as exc:  # type: ignore[attr-defined]
        raise ValueError("Ciphertext is not valid base64") from exc

    version_len = len(_ENVELOPE_VERSION)
    header = version_len + _GCM_NONCE_BYTES + 16  # version + nonce + tag
    if len(blob) < header or blob[:version_len] != _ENVELOPE_VERSION.encode("ascii"):
        raise ValueError("Unrecognised ciphertext envelope")

    nonce = blob[version_len : version_len + _GCM_NONCE_BYTES]
    tag = blob[version_len + _GCM_NONCE_BYTES : header]
    ciphertext = blob[header:]
    cipher = AES.new(key, AES.MODE_GCM, nonce=nonce)
    try:
        plaintext = cipher.decrypt_and_verify(ciphertext, tag)
    except ValueError as exc:
        raise ValueError("Decryption failed — wrong key or tampered data") from exc
    return plaintext.decode("utf-8")


def looks_encrypted(value: str) -> bool:
    """
    Best-effort check that ``value`` is one of our envelopes, so reads can stay
    backward-compatible with any plaintext written before encryption existed.
    """
    if not isinstance(value, str) or not value:
        return False
    try:
        blob = base64.b64decode(value, validate=True)
    except (ValueError, base64.binascii.Error):  # type: ignore[attr-defined]
        return False
    return blob[: len(_ENVELOPE_VERSION)] == _ENVELOPE_VERSION.encode("ascii")


def encrypt_fields(data: dict, fields: tuple[str, ...]) -> dict:
    """Return a shallow copy of ``data`` with the named string fields encrypted."""
    out = dict(data)
    for field in fields:
        value = out.get(field)
        if isinstance(value, str) and value:
            out[field] = encrypt_text(value)
    return out


def decrypt_fields(data: dict, fields: tuple[str, ...]) -> dict:
    """
    Return a shallow copy of ``data`` with the named fields decrypted. Values
    that aren't recognised envelopes are passed through untouched (legacy
    plaintext), and an individual decryption failure surfaces a marker rather
    than aborting the whole read.
    """
    out = dict(data)
    for field in fields:
        value = out.get(field)
        if isinstance(value, str) and looks_encrypted(value):
            try:
                out[field] = decrypt_text(value)
            except ValueError as exc:
                logger.warning("Failed to decrypt field %r: %s", field, exc)
                out[field] = "[decryption error]"
    return out


# ---------------------------------------------------------------------------
# Private-key-at-rest protection
# ---------------------------------------------------------------------------
# The doctor's RSA private key is retained server-side so the backend can sign
# on their behalf, but it is NEVER stored in the clear: we wrap the PEM in the
# same AES-256-GCM envelope used for clinical fields.
def protect_private_key(private_pem: str) -> str:
    """AES-encrypt a private-key PEM for at-rest storage."""
    return encrypt_text(private_pem)


def recover_private_key(protected: str) -> str:
    """Decrypt a previously :func:`protect_private_key`-ed PEM."""
    return decrypt_text(protected)


# ---------------------------------------------------------------------------
# RSA-2048 — key generation, signing, verification
# ---------------------------------------------------------------------------
def generate_rsa_keypair() -> tuple[str, str]:
    """
    Generate a fresh RSA-2048 key-pair.

    Returns ``(private_pem, public_pem)`` where the public key is PEM-encoded
    SubjectPublicKeyInfo (``-----BEGIN PUBLIC KEY-----``) so the browser's
    WebCrypto ``importKey('spki', ...)`` can consume it directly.
    """
    key = RSA.generate(RSA_KEY_BITS)
    private_pem = key.export_key(format="PEM").decode("ascii")
    public_pem = key.publickey().export_key(format="PEM").decode("ascii")
    return private_pem, public_pem


def sign_digest(data: bytes, private_pem: str) -> str:
    """
    Sign ``data`` with RSASSA-PKCS1-v1_5 over its SHA-256 digest and return the
    base64-encoded signature.

        Signature = RSA.sign(SHA256(data), doctor_private_key)
    """
    key = RSA.import_key(private_pem)
    digest = SHA256.new(data)
    signature = pkcs1_15.new(key).sign(digest)
    return base64.b64encode(signature).decode("ascii")


def verify_signature(data: bytes, signature_b64: str, public_pem: str) -> bool:
    """
    Verify a base64 RSASSA-PKCS1-v1_5/SHA-256 signature against ``data``.
    Returns True/False rather than raising, for easy use in tests.
    """
    try:
        key = RSA.import_key(public_pem)
        digest = SHA256.new(data)
        pkcs1_15.new(key).verify(digest, base64.b64decode(signature_b64))
        return True
    except (ValueError, TypeError):
        return False


def sha256_hex(data: bytes) -> str:
    """Hex SHA-256 of ``data`` — handy for logging / integrity references."""
    return hashlib.sha256(data).hexdigest()


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------
def status() -> dict:
    """Capability snapshot for the /health endpoint."""
    return {
        "encryption_configured": encryption_configured(),
        "rsa_bits": RSA_KEY_BITS,
        "signature_scheme": "RSASSA-PKCS1-v1_5 / SHA-256",
    }


# Round-trippable JSON helper used by the report metadata embedding.
def _json_compact(obj) -> str:  # pragma: no cover - trivial
    return json.dumps(obj, separators=(",", ":"), ensure_ascii=False)
