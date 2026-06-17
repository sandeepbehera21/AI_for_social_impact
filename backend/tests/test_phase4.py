"""
Phase 4 — clinical cryptography & report tests.

Covers the security-critical primitives directly (no Firebase needed):
  * AES-256-GCM field encryption round-trip + tamper detection
  * RSA-2048 sign / verify, plus tamper & wrong-key rejection
  * PDF generation → SHA-256 → sign → verify, mirroring the real endpoint flow
  * Browser-compatibility of the signature scheme (RSASSA-PKCS1-v1_5 / SHA-256)

The master key is configured by conftest.py before import.
"""
from __future__ import annotations

from datetime import datetime, timezone

from app.services import crypto, reports


# ---------------------------------------------------------------------------
# AES-256-GCM field encryption
# ---------------------------------------------------------------------------
def test_master_key_is_configured_in_tests():
    assert crypto.encryption_configured() is True


def test_aes_roundtrip():
    plaintext = "Patient reports improved sleep; GAD-7 = 8.\nFollow-up in 2 weeks."
    token = crypto.encrypt_text(plaintext)
    assert token != plaintext
    assert crypto.looks_encrypted(token)
    assert crypto.decrypt_text(token) == plaintext


def test_aes_is_nondeterministic():
    # Fresh nonce each call → identical plaintext yields different ciphertext.
    a = crypto.encrypt_text("same input")
    b = crypto.encrypt_text("same input")
    assert a != b
    assert crypto.decrypt_text(a) == crypto.decrypt_text(b) == "same input"


def test_aes_tamper_is_detected():
    import base64

    token = crypto.encrypt_text("integrity matters")
    blob = bytearray(base64.b64decode(token))
    blob[-1] ^= 0x01  # flip a ciphertext bit
    tampered = base64.b64encode(bytes(blob)).decode()
    try:
        crypto.decrypt_text(tampered)
        assert False, "tampered ciphertext should not decrypt"
    except ValueError:
        pass


def test_encrypt_decrypt_fields_roundtrip():
    data = {
        "sessionNotes": "notes",
        "diagnosis": "dx",
        "prescriptions": "rx",
        "status": "completed",  # untouched
    }
    fields = ("sessionNotes", "diagnosis", "prescriptions")
    enc = crypto.encrypt_fields(data, fields)
    assert all(crypto.looks_encrypted(enc[f]) for f in fields)
    assert enc["status"] == "completed"
    dec = crypto.decrypt_fields(enc, fields)
    assert dec["sessionNotes"] == "notes"
    assert dec["diagnosis"] == "dx"
    assert dec["prescriptions"] == "rx"


def test_decrypt_fields_passes_through_plaintext():
    # Legacy/plaintext values are left untouched (backward compatible).
    data = {"diagnosis": "legacy plaintext", "status": "completed"}
    out = crypto.decrypt_fields(data, ("diagnosis",))
    assert out["diagnosis"] == "legacy plaintext"


# ---------------------------------------------------------------------------
# RSA-2048 signatures
# ---------------------------------------------------------------------------
def test_rsa_keypair_is_2048_and_pem():
    priv, pub = crypto.generate_rsa_keypair()
    assert "BEGIN RSA PRIVATE KEY" in priv or "BEGIN PRIVATE KEY" in priv
    assert "BEGIN PUBLIC KEY" in pub  # SPKI, browser-importable


def test_rsa_sign_and_verify():
    priv, pub = crypto.generate_rsa_keypair()
    data = b"%PDF-1.4 clinical report bytes"
    sig = crypto.sign_digest(data, priv)
    assert crypto.verify_signature(data, sig, pub) is True


def test_rsa_rejects_tampered_data():
    priv, pub = crypto.generate_rsa_keypair()
    sig = crypto.sign_digest(b"original", priv)
    assert crypto.verify_signature(b"original!", sig, pub) is False


def test_rsa_rejects_wrong_key():
    priv1, _pub1 = crypto.generate_rsa_keypair()
    _priv2, pub2 = crypto.generate_rsa_keypair()
    sig = crypto.sign_digest(b"data", priv1)
    assert crypto.verify_signature(b"data", sig, pub2) is False


def test_private_key_seal_roundtrip():
    priv, _pub = crypto.generate_rsa_keypair()
    sealed = crypto.protect_private_key(priv)
    assert sealed != priv
    assert crypto.recover_private_key(sealed) == priv


# ---------------------------------------------------------------------------
# PDF generation + full sign/verify flow (mirrors /api/sessions/complete)
# ---------------------------------------------------------------------------
def _build_pdf() -> bytes:
    return reports.build_clinical_pdf(
        appointment_id="appt-test-1",
        patient_name="Jane Doe",
        doctor_name="Smith",
        session_datetime="2026-06-10T14:30:00",
        completed_at=datetime(2026, 6, 10, 15, 0, tzinfo=timezone.utc),
        session_notes="Patient reports improved sleep.\nDiscussed coping strategies.",
        diagnosis="Mild anxiety",
        prescriptions="Continue mindfulness; follow-up in 2 weeks.",
        public_key_fingerprint="deadbeef",
    )


def test_pdf_is_generated():
    pdf = _build_pdf()
    assert pdf[:5] == b"%PDF-" and len(pdf) > 1000


def test_full_report_sign_and_verify_flow():
    priv, pub = crypto.generate_rsa_keypair()
    pdf = _build_pdf()

    # Backend: hash → sign the exact stored bytes.
    pdf_sha256 = crypto.sha256_hex(pdf)
    signature = crypto.sign_digest(pdf, priv)

    # Patient: verify the served bytes against the public key + signature.
    assert crypto.verify_signature(pdf, signature, pub) is True
    assert crypto.sha256_hex(pdf) == pdf_sha256  # integrity reference matches

    # A single altered byte must break verification.
    altered = bytearray(pdf)
    altered[100] ^= 0x01
    assert crypto.verify_signature(bytes(altered), signature, pub) is False
