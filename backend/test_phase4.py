#!/usr/bin/env python
"""
Phase 4 — Telehealth Clinical Crypto COMPLIANCE HARNESS (standalone).

Run directly to get a human-readable PASS/FAIL compliance report:

    cd backend
    python test_phase4.py            # or: .venv/Scripts/python.exe test_phase4.py

Unlike ``tests/test_phase4.py`` (a pytest suite for CI), this script is a
self-contained auditor's harness. It exercises the *real* production code paths
end-to-end and prints an at-a-glance compliance table:

    1. Generate a dummy clinical PDF report          (reports.build_clinical_pdf)
    2. SHA-256 hash + RSA-2048 sign it               (crypto.sha256_hex / sign_digest)
    3. Encrypt clinical fields + PDF and "write" them to a DB
    4. Inspect the RAW stored document — must be ciphertext, never plaintext
    5. Read back, decrypt, and verify nothing leaked
    6. Verify the signature against the doctor's PUBLIC key (standard RSA verify)
    7. Negative controls: tampered PDF and wrong-key signatures must FAIL

It needs no network and no Firebase credentials: the Firestore write/read is
modelled by an in-memory stand-in (`FakeFirestoreDoc`) that mimics
``set(..., merge=True)`` / ``get()`` exactly, so the encrypt-on-write /
decrypt-on-read hooks are exercised against the same envelope format the real
backend stores. Exit code is 0 only if every compliance check passes.
"""
from __future__ import annotations

import base64
import os
import sys
from datetime import datetime, timezone

# --- Make the app package importable and the crypto "configured" -------------
# Allow running from any CWD: put this file's dir (backend/) on sys.path.
_HERE = os.path.dirname(os.path.abspath(__file__))
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

# A deterministic 32-byte base64 master key so the harness runs offline even if
# the operator hasn't exported one. A real deployment sets CLINICAL_MASTER_KEY.
os.environ.setdefault(
    "CLINICAL_MASTER_KEY",
    "dGVzdC1tYXN0ZXIta2V5LTMyLWJ5dGVzLWxvbmchISE=",  # 32 bytes, base64
)

from app.services import crypto, reports  # noqa: E402

# Clinical free-text fields that MUST be encrypted at rest (mirrors clinical.py).
_ENCRYPTED_FIELDS = ("sessionNotes", "diagnosis", "prescriptions")


# ---------------------------------------------------------------------------
# Minimal in-memory Firestore document stand-in
# ---------------------------------------------------------------------------
class FakeFirestoreDoc:
    """
    Faithfully mimics the slice of the Firestore document API the backend uses:
    ``set(data, merge=True)`` and ``get()`` returning ``.exists`` / ``to_dict()``.
    Stores values verbatim so we can audit exactly what would land in Firestore.
    """

    def __init__(self) -> None:
        self._data: dict = {}

    def set(self, data: dict, merge: bool = False) -> None:
        if merge:
            self._data.update(data)
        else:
            self._data = dict(data)

    @property
    def exists(self) -> bool:
        return bool(self._data)

    def to_dict(self) -> dict:
        # Return a copy so callers can't mutate the "stored" document in place.
        return dict(self._data)

    def raw(self) -> dict:
        """The bytes-on-disk view an auditor would see in the Firestore console."""
        return self._data


# ---------------------------------------------------------------------------
# Tiny reporting helpers
# ---------------------------------------------------------------------------
class Report:
    def __init__(self) -> None:
        self.rows: list[tuple[str, bool, str]] = []

    def check(self, label: str, passed: bool, detail: str = "") -> bool:
        self.rows.append((label, bool(passed), detail))
        return bool(passed)

    @property
    def ok(self) -> bool:
        return all(p for _, p, _ in self.rows)

    def render(self) -> str:
        width = max((len(label) for label, _, _ in self.rows), default=0)
        lines = ["", "=" * (width + 24), " MindEase Phase 4 - Compliance Report", "=" * (width + 24)]
        for label, passed, detail in self.rows:
            tag = "PASS" if passed else "FAIL"
            line = f"  {label.ljust(width)} : {tag}"
            if detail:
                line += f"   ({detail})"
            lines.append(line)
        lines.append("-" * (width + 24))
        verdict = "ALL CHECKS PASSED" if self.ok else "COMPLIANCE FAILURES DETECTED"
        lines.append(f"  RESULT: {verdict}")
        lines.append("=" * (width + 24))
        return "\n".join(lines)


# ---------------------------------------------------------------------------
# The audit
# ---------------------------------------------------------------------------
def run_audit() -> Report:
    r = Report()

    # --- 0. Master key configured ------------------------------------------
    r.check(
        "AES master key configured",
        crypto.encryption_configured(),
        "CLINICAL_MASTER_KEY resolves to 32 bytes",
    )

    # --- 1. Doctor key management ------------------------------------------
    private_pem, public_pem = crypto.generate_rsa_keypair()
    r.check(
        "RSA-2048 key-pair generated",
        "PRIVATE KEY" in private_pem and "BEGIN PUBLIC KEY" in public_pem,
        "public key is PEM/SPKI (browser-importable)",
    )

    # Private key is sealed (AES-GCM) before it is ever persisted server-side.
    sealed_private = crypto.protect_private_key(private_pem)
    r.check(
        "Private key sealed at rest",
        crypto.looks_encrypted(sealed_private) and sealed_private != private_pem,
        "AES-256-GCM envelope, no cleartext PEM",
    )
    r.check(
        "Private key recoverable by backend only",
        crypto.recover_private_key(sealed_private) == private_pem,
    )

    # --- 2. Build + hash + sign the PDF ------------------------------------
    completed_at = datetime(2026, 6, 10, 15, 0, tzinfo=timezone.utc)
    fingerprint = crypto.sha256_hex(public_pem.encode())
    pdf_bytes = reports.build_clinical_pdf(
        appointment_id="appt-demo-001",
        patient_name="Jane Doe",
        doctor_name="Smith",
        session_datetime="2026-06-10T14:30:00",
        completed_at=completed_at,
        session_notes="Patient reports improved sleep.\nDiscussed coping strategies.",
        diagnosis="Mild generalised anxiety (GAD-7 = 8).",
        prescriptions="Continue mindfulness practice; follow-up in 2 weeks.",
        public_key_fingerprint=fingerprint,
    )
    r.check(
        "Clinical PDF generated",
        pdf_bytes[:5] == b"%PDF-" and len(pdf_bytes) > 1000,
        f"{len(pdf_bytes)} bytes",
    )

    pdf_sha256 = crypto.sha256_hex(pdf_bytes)
    signature = crypto.sign_digest(pdf_bytes, private_pem)
    r.check(
        "RSA Signing",
        bool(signature) and base64.b64decode(signature),  # valid base64 sig
        f"SHA-256={pdf_sha256[:16]}...",
    )

    # --- 3. Encrypt clinical fields + PDF and "write" to the DB ------------
    clinical = {
        "sessionNotes": "Patient reports improved sleep.\nDiscussed coping strategies.",
        "diagnosis": "Mild generalised anxiety (GAD-7 = 8).",
        "prescriptions": "Continue mindfulness practice; follow-up in 2 weeks.",
    }
    encrypted = crypto.encrypt_fields(clinical, _ENCRYPTED_FIELDS)
    report_pdf_enc = crypto.encrypt_text(base64.b64encode(pdf_bytes).decode("ascii"))

    doc = FakeFirestoreDoc()
    doc.set(
        {
            **encrypted,
            "status": "completed",
            "signature": signature,
            "pdfSha256": pdf_sha256,
            "reportPdfEnc": report_pdf_enc,
            "signedByFingerprint": fingerprint,
            "completedAt": completed_at.isoformat(),
        },
        merge=True,
    )

    # --- 4. Inspect the RAW stored document — must be ciphertext -----------
    raw = doc.raw()
    fields_are_ciphertext = all(
        crypto.looks_encrypted(raw[f]) and raw[f] != clinical[f] for f in _ENCRYPTED_FIELDS
    )
    plaintext_leak = any(clinical[f] in str(raw.get(f, "")) for f in _ENCRYPTED_FIELDS)
    r.check(
        "AES-256 Encryption",
        fields_are_ciphertext and not plaintext_leak,
        "diagnosis / sessionNotes / prescriptions stored as ciphertext",
    )
    r.check(
        "Report PDF encrypted at rest",
        crypto.looks_encrypted(raw["reportPdfEnc"]),
    )

    # --- 5. Read back, decrypt, verify no leak ----------------------------
    fetched = doc.to_dict()
    decrypted = crypto.decrypt_fields(fetched, _ENCRYPTED_FIELDS)
    clean_decrypt = all(decrypted[f] == clinical[f] for f in _ENCRYPTED_FIELDS)
    r.check(
        "AES-256 Decryption (clean read)",
        clean_decrypt,
        "all fields decrypt back to original plaintext",
    )

    pdf_roundtrip = base64.b64decode(crypto.decrypt_text(fetched["reportPdfEnc"]))
    r.check(
        "Stored PDF round-trips byte-for-byte",
        pdf_roundtrip == pdf_bytes,
    )

    # --- 6. Signature Verification (standard RSA verify) ------------------
    r.check(
        "Signature Verification",
        crypto.verify_signature(pdf_roundtrip, fetched["signature"], public_pem),
        "RSASSA-PKCS1-v1_5 / SHA-256 over the stored PDF bytes",
    )
    r.check(
        "Integrity hash matches",
        crypto.sha256_hex(pdf_roundtrip) == fetched["pdfSha256"],
    )

    # --- 7. Negative controls (security must REJECT these) ----------------
    tampered = bytearray(pdf_bytes)
    tampered[100] ^= 0x01
    r.check(
        "Tampered PDF rejected",
        crypto.verify_signature(bytes(tampered), signature, public_pem) is False,
        "single-bit change breaks verification",
    )

    _other_priv, other_pub = crypto.generate_rsa_keypair()
    r.check(
        "Wrong-key signature rejected",
        crypto.verify_signature(pdf_bytes, signature, other_pub) is False,
    )

    tampered_cipher = bytearray(base64.b64decode(report_pdf_enc))
    tampered_cipher[-1] ^= 0x01
    leaked = True
    try:
        crypto.decrypt_text(base64.b64encode(bytes(tampered_cipher)).decode())
    except ValueError:
        leaked = False
    r.check(
        "Tampered ciphertext rejected (GCM tag)",
        leaked is False,
        "AES-GCM auth tag detects modification",
    )

    return r


def main() -> int:
    report = run_audit()
    print(report.render())
    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
