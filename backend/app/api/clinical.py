"""
Clinical session endpoints (Phase 4).

  POST /api/doctor/keys/ensure   — generate-or-fetch the caller doctor's RSA pair
  POST /api/sessions/complete    — finalise a session: render → sign → encrypt → store
  GET  /api/sessions/{id}        — decrypted clinical detail (either party)
  GET  /api/sessions/{id}/report — the signed PDF bytes (either party)

Every route is gated by a verified Firebase ID token (see ``deps``). Clinical
free-text is AES-256-GCM-encrypted at rest; the PDF is signed with the doctor's
RSA-2048 key so the patient can later prove it is authentic and unaltered.
"""
from __future__ import annotations

import base64
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response, status, Request
from google.cloud.firestore_v1.base_query import FieldFilter

from app.api.deps import CurrentUser, get_current_user, require_doctor
from app.ratelimit import limiter
from app.schemas import (
    DoctorKeyResponse,
    SessionCompleteRequest,
    SessionCompleteResponse,
    SessionDetailResponse,
    PatientClinicalSummaryResponse,
)
from app.services import crypto, firebase, reports, mood, habits, wellness

logger = logging.getLogger("mindease.clinical")

router = APIRouter(prefix="/api", tags=["clinical"])

# Clinical fields that are encrypted before hitting Firestore.
_ENCRYPTED_FIELDS = ("sessionNotes", "diagnosis", "prescriptions")

# The doctor's AES-sealed private key lives in its OWN collection, which the
# Firestore rules deny to every client (backend/Admin access only) — so the
# world-readable users/{uid} profile never carries key material.
_KEYS_COLLECTION = "doctor_keys"


# ---------------------------------------------------------------------------
# Doctor key management
# ---------------------------------------------------------------------------
def _sealed_private_key(uid: str) -> str | None:
    """Read the doctor's AES-sealed private PEM from the backend-only collection."""
    db = firebase.firestore_client()
    snap = db.collection(_KEYS_COLLECTION).document(uid).get()
    return (snap.to_dict() or {}).get("privateKeyEnc") if snap.exists else None


def _ensure_doctor_keys(uid: str, profile: dict) -> tuple[str, str | None, str]:
    """
    Ensure the doctor has an RSA-2048 pair.

    Public key + fingerprint live on ``users/{uid}``; the sealed private key
    lives on ``doctor_keys/{uid}`` (client-inaccessible). Returns
    ``(public_pem, new_private_pem_or_None, fingerprint)`` — the private PEM is
    only returned when freshly generated, so it can be handed to the doctor once.
    """
    db = firebase.firestore_client()
    public_pem = profile.get("publicKey")
    sealed_key = _sealed_private_key(uid)
    if public_pem and sealed_key:
        try:
            # Verify if the existing private key can be successfully decrypted/unsealed.
            crypto.recover_private_key(sealed_key)
            fp = profile.get("publicKeyFingerprint") or crypto.sha256_hex(public_pem.encode())
            return public_pem, None, fp
        except Exception as exc:
            logger.warning(
                "Doctor %s keys exist but the private key could not be unsealed (possible master-key mismatch): %s. "
                "Regenerating key-pair.",
                uid,
                exc,
            )


    # We're about to mint a key-pair (first time, or a half-provisioned doc).
    # The private key MUST be AES-sealed at rest, so refuse to publish a public
    # key we can't pair with a recoverable private key. Otherwise an absent
    # master key would leave an orphaned public identity on users/{uid} and the
    # next call would silently rotate it — invalidating any prior signatures.
    if not crypto.encryption_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Cannot provision doctor signing keys: CLINICAL_MASTER_KEY is not "
                "configured, so the private key cannot be sealed at rest. Set the "
                "master key before key setup."
            ),
        )

    # Mint the pair, then write public + sealed-private atomically (batched) so a
    # partial failure can never leave a published public key without its sealed
    # private counterpart.
    private_pem, public_pem = crypto.generate_rsa_keypair()
    fingerprint = crypto.sha256_hex(public_pem.encode())
    batch = db.batch()
    batch.set(
        db.collection("users").document(uid),
        {
            "publicKey": public_pem,
            "publicKeyFingerprint": fingerprint,
            "keyCreatedAt": datetime.now(timezone.utc).isoformat(),
        },
        merge=True,
    )
    batch.set(
        db.collection(_KEYS_COLLECTION).document(uid),
        {"privateKeyEnc": crypto.protect_private_key(private_pem)},
    )
    batch.commit()
    logger.info("Generated RSA-2048 key-pair for doctor %s", uid)
    return public_pem, private_pem, fingerprint


def _doctor_private_key(uid: str) -> str:
    """Recover a doctor's private PEM from the sealed copy, or fail clearly."""
    sealed = _sealed_private_key(uid)
    if not sealed:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "No server-held signing key for this doctor. Ensure CLINICAL_MASTER_KEY "
                "is configured and re-run key setup so the backend can sign reports."
            ),
        )
    try:
        return crypto.recover_private_key(sealed)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Stored signing key could not be unsealed (master-key mismatch).",
        ) from exc


@router.post("/doctor/keys/ensure", response_model=DoctorKeyResponse)
@limiter.limit("5/minute")
def ensure_doctor_keys(
    request: Request,
    doctor: CurrentUser = Depends(require_doctor),
) -> DoctorKeyResponse:
    """Idempotently provision the calling doctor's RSA-2048 key-pair."""
    public_pem, new_private, fingerprint = _ensure_doctor_keys(doctor.uid, doctor.profile)
    return DoctorKeyResponse(
        public_key=public_pem,
        public_key_fingerprint=fingerprint,
        private_key=new_private,
        created=new_private is not None,
    )


# ---------------------------------------------------------------------------
# Session completion (render → sign → encrypt → persist)
# ---------------------------------------------------------------------------
def _load_appointment(appointment_id: str) -> tuple[object, dict]:
    db = firebase.firestore_client()
    ref = db.collection("appointments").document(appointment_id)
    snap = ref.get()
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Appointment not found.")
    return ref, snap.to_dict()


def _patient_emotion_summary(appointment_id: str, patient_id: str | None) -> dict | None:
    """
    Best-effort emotional-analysis block for the report, built from the patient's
    on-device mood history and clinical chat messages. Never raises.
    """
    if not patient_id:
        return None
    try:
        import time
        from app.ml.sentiment import analyzer

        db = firebase.firestore_client()
        
        # 1. Fetch and aggregate facial emotion history
        docs = (
            db.collection("mood_entries")
            .where(filter=FieldFilter("patientId", "==", patient_id))
            .limit(2000)
            .get()
        )
        entries = [d.to_dict() or {} for d in docs]
        summary = mood.report_emotion_summary(entries, now_ms=int(time.time() * 1000)) or {}

        # 2. Fetch clinical chat messages sent by the patient during this session
        msg_docs = (
            db.collection("appointments")
            .document(appointment_id)
            .collection("messages")
            .get()
        )
        patient_msgs = []
        for d in msg_docs:
            data = d.to_dict() or {}
            if data.get("senderId") == patient_id:
                patient_msgs.append(data)

        # 3. Analyze NLP text sentiment of the clinical chat messages
        if patient_msgs:
            text_scores = {e: 0.0 for e in ("joy", "sadness", "anger", "fear", "neutral")}
            valid_count = 0
            for m in patient_msgs:
                txt = m.get("text", "").strip()
                if not txt:
                    continue
                res = analyzer.analyze(txt)
                for e in text_scores:
                    text_scores[e] += res.sentiment.get(e, 0.0)
                valid_count += 1
            
            if valid_count > 0:
                avg_scores = {e: text_scores[e] / valid_count for e in text_scores}
                # Neutral acts as a baseline/no-signal bucket. For report prose we
                # want any actual emotional signal to win whenever the chat history
                # contains one, otherwise a single neutral follow-up can drown out
                # a clearly distressed message and flatten the summary.
                emotional_scores = {
                    e: avg_scores[e] for e in ("joy", "sadness", "anger", "fear")
                }
                dom_text_emo = max(emotional_scores, key=emotional_scores.get)
                if emotional_scores[dom_text_emo] == 0:
                    dom_text_emo = "neutral"
                pct = round(avg_scores[dom_text_emo] * 100)
                summary["text_summary"] = f"Across {valid_count} clinical chat messages, the patient's dominant text sentiment was {dom_text_emo.upper()} (average confidence {pct}%)."
            else:
                summary["text_summary"] = "No clinical chat messages were sent by the patient during this session."
        else:
            summary["text_summary"] = "No clinical chat messages were recorded for this session."

        # 4. Habit adherence + overall wellness score (Phase 2).
        now_ms = int(time.time() * 1000)
        habit_rows = (
            db.collection("habit_entries").where(filter=FieldFilter("patientId", "==", patient_id)).limit(2000).get()
        )
        habit_entries = [d.to_dict() or {} for d in habit_rows]
        habit_summary_full = habits.summarize(habit_entries, now_ms=now_ms) if habit_entries else None
        habit_prose = habits.habit_report_summary(habit_entries, now_ms=now_ms)
        if habit_prose:
            summary["habit_summary"] = habit_prose["habit_summary"]
            summary["habit_breakdown"] = habit_prose["habit_breakdown"]

        journals = [d.to_dict() or {} for d in
                    db.collection("journals").where(filter=FieldFilter("patientId", "==", patient_id)).limit(2000).get()]
        cbt = [d.to_dict() or {} for d in
               db.collection("cbt_exercises").where(filter=FieldFilter("patientId", "==", patient_id)).limit(2000).get()]
        mood_summary_full = mood.summarize(entries, now_ms=now_ms) if entries else None
        score = wellness.compute_wellness_score(
            mood_summary=mood_summary_full,
            habit_summary=habit_summary_full,
            journals=journals,
            cbt=cbt,
        )
        if score.get("has_data"):
            c = score["components"]
            summary["wellness_summary"] = (
                f"Overall wellness score: {score['score']}/100 "
                f"({score['level'].replace('_', ' ')}). "
                f"Emotional {c['emotional']}, Habits {c['habit']}, Engagement {c['engagement']}."
            )

        return summary if summary else None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Emotion summary unavailable for report: %s", exc)
        return None


@router.post("/sessions/complete", response_model=SessionCompleteResponse)
@limiter.limit("10/minute")
def complete_session(
    request: Request,
    req: SessionCompleteRequest,
    doctor: CurrentUser = Depends(require_doctor),
) -> SessionCompleteResponse:
    """
    Finalise a clinical session: generate the PDF, sign its SHA-256 hash with the
    doctor's RSA key, encrypt the clinical fields + PDF, and persist everything
    on the appointment document.
    """
    if not crypto.encryption_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Clinical encryption is not configured (set CLINICAL_MASTER_KEY).",
        )

    ref, appt = _load_appointment(req.appointment_id)

    # Authorisation: only the appointment's own doctor may complete it.
    if appt.get("doctorId") != doctor.uid:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not the attending doctor for this appointment.",
        )

    # Make sure the doctor has a (sealed) signing key, then recover it.
    _public_pem, _new_private, fingerprint = _ensure_doctor_keys(doctor.uid, doctor.profile)
    private_pem = _doctor_private_key(doctor.uid)

    completed_at = datetime.now(timezone.utc)
    pdf_bytes = reports.build_clinical_pdf(
        appointment_id=req.appointment_id,
        patient_name=appt.get("patientName", "Patient"),
        doctor_name=doctor.name,
        session_datetime=appt.get("dateTime"),
        completed_at=completed_at,
        session_notes=req.session_notes,
        diagnosis=req.diagnosis,
        prescriptions=req.prescriptions,
        public_key_fingerprint=fingerprint,
        emotion_summary=_patient_emotion_summary(req.appointment_id, appt.get("patientId")),
    )

    # 1) Hash + 2) sign the exact PDF bytes the patient will verify.
    pdf_sha256 = crypto.sha256_hex(pdf_bytes)
    signature = crypto.sign_digest(pdf_bytes, private_pem)

    # 3) Encrypt clinical free-text + the PDF itself (base64 → AES envelope).
    encrypted = crypto.encrypt_fields(
        {
            "sessionNotes": req.session_notes,
            "diagnosis": req.diagnosis,
            "prescriptions": req.prescriptions,
        },
        _ENCRYPTED_FIELDS,
    )
    report_pdf_enc = crypto.encrypt_text(base64.b64encode(pdf_bytes).decode("ascii"))

    ref.set(
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
    logger.info("Session %s completed & signed (pdf sha256=%s)", req.appointment_id, pdf_sha256)

    return SessionCompleteResponse(
        appointment_id=req.appointment_id,
        status="completed",
        signature=signature,
        pdf_sha256=pdf_sha256,
        report_url=f"/api/sessions/{req.appointment_id}/report",
    )


# ---------------------------------------------------------------------------
# Reads (authorised party only)
# ---------------------------------------------------------------------------
def _authorise_party(appt: dict, user: CurrentUser) -> None:
    if user.uid not in (appt.get("doctorId"), appt.get("patientId")):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not a participant in this appointment.",
        )


@router.get("/sessions/{appointment_id}", response_model=SessionDetailResponse)
@limiter.limit("30/minute")
def get_session(
    request: Request,
    appointment_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> SessionDetailResponse:
    """Decrypted clinical detail for the patient or doctor of this appointment."""
    _ref, appt = _load_appointment(appointment_id)
    _authorise_party(appt, user)

    decrypted = crypto.decrypt_fields(appt, _ENCRYPTED_FIELDS)

    # The doctor's public key (for the patient's client-side verification).
    public_key = None
    doctor_id = appt.get("doctorId")
    if doctor_id:
        db = firebase.firestore_client()
        doc = db.collection("users").document(doctor_id).get()
        public_key = (doc.to_dict() or {}).get("publicKey") if doc.exists else None

    return SessionDetailResponse(
        appointment_id=appointment_id,
        patient_name=appt.get("patientName", "Patient"),
        doctor_name=appt.get("doctorName", "Doctor"),
        status=appt.get("status", "unknown"),
        session_notes=decrypted.get("sessionNotes", "") or "",
        diagnosis=decrypted.get("diagnosis", "") or "",
        prescriptions=decrypted.get("prescriptions", "") or "",
        signature=appt.get("signature"),
        public_key=public_key,
        pdf_sha256=appt.get("pdfSha256"),
        completed_at=appt.get("completedAt"),
        has_report=bool(appt.get("reportPdfEnc")),
        emotion_summary=_patient_emotion_summary(appointment_id, appt.get("patientId")),
    )


@router.get("/sessions/{appointment_id}/report")
@limiter.limit("30/minute")
def get_session_report(
    request: Request,
    appointment_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> Response:
    """Stream the signed clinical PDF to an authorised party."""
    _ref, appt = _load_appointment(appointment_id)
    _authorise_party(appt, user)

    sealed = appt.get("reportPdfEnc")
    if not sealed:
        raise HTTPException(status_code=404, detail="No report has been generated yet.")
    try:
        pdf_b64 = crypto.decrypt_text(sealed)
        pdf_bytes = base64.b64decode(pdf_b64)
    except ValueError as exc:
        raise HTTPException(status_code=500, detail="Stored report could not be decrypted.") from exc

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'inline; filename="mindease-report-{appointment_id}.pdf"',
            # Expose so the browser fetch() can read the integrity hash header.
            "X-PDF-SHA256": appt.get("pdfSha256", ""),
            "Access-Control-Expose-Headers": "X-PDF-SHA256",
        },
    )


@router.get("/sessions/{appointment_id}/patient-summary", response_model=PatientClinicalSummaryResponse)
@limiter.limit("30/minute")
def get_patient_clinical_summary(
    request: Request,
    appointment_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> PatientClinicalSummaryResponse:
    """Fetch the patient's full clinical summary (journals, CBT, moods, past sessions) for the attending doctor."""
    _ref, appt = _load_appointment(appointment_id)
    _authorise_party(appt, user)

    patient_id = appt.get("patientId")
    if not patient_id:
        raise HTTPException(status_code=400, detail="Appointment has no patient ID.")

    db = firebase.firestore_client()

    if user.role == "doctor":
        if not appt.get("shareConsent", False):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Patient has not consented to share clinical details for this appointment.",
            )
        import time
        db.collection("consent_audit").add({
            "patientId": patient_id,
            "doctorId": user.uid,
            "doctorName": user.name,
            "accessedAt": int(time.time() * 1000),
            "accessedCategory": "clinical_summary"
        })

    # Fetch patient sharing settings
    user_snap = db.collection("users").document(patient_id).get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    sharing = user_data.get("sharing", {})

    # 1. Fetch journals (in-memory sort to avoid index errors) if consented
    journals = []
    if sharing.get("journal", True):
        journals_docs = db.collection("journals").where(filter=FieldFilter("patientId", "==", patient_id)).stream()
        journals = [d.to_dict() for d in journals_docs]
        journals.sort(key=lambda x: x.get("ts", 0), reverse=True)

    # 2. Fetch CBT Exercises if consented
    cbt_exercises = []
    if sharing.get("cbt", True):
        cbt_docs = db.collection("cbt_exercises").where(filter=FieldFilter("patientId", "==", patient_id)).stream()
        cbt_exercises = [d.to_dict() for d in cbt_docs]
        cbt_exercises.sort(key=lambda x: x.get("ts", 0), reverse=True)

    # 3. Fetch mood logs if consented
    mood_entries = []
    if sharing.get("mood", True):
        mood_docs = db.collection("mood_entries").where(filter=FieldFilter("patientId", "==", patient_id)).stream()
        mood_entries = [d.to_dict() for d in mood_docs]
        mood_entries.sort(key=lambda x: x.get("ts", 0), reverse=True)

    # 4. Fetch past completed sessions for this patient (excluding current one)
    appt_docs = db.collection("appointments").where(filter=FieldFilter("patientId", "==", patient_id)).stream()
    past_appts = []
    for d in appt_docs:
        data = d.to_dict() or {}
        # We only want completed ones
        if data.get("status") == "completed" and d.id != appointment_id:
            # decrypt clinical fields
            decrypted = crypto.decrypt_fields(data, _ENCRYPTED_FIELDS)
            past_appts.append({
                "appointment_id": d.id,
                "doctor_name": data.get("doctorName", "Doctor"),
                "completed_at": data.get("completedAt"),
                "session_notes": decrypted.get("sessionNotes", ""),
                "diagnosis": decrypted.get("diagnosis", ""),
                "prescriptions": decrypted.get("prescriptions", ""),
            })
    # Sort past appointments by completed_at desc
    past_appts.sort(key=lambda x: x.get("completed_at") or "", reverse=True)

    return PatientClinicalSummaryResponse(
        journals=journals,
        cbt_exercises=cbt_exercises,
        mood_entries=mood_entries,
        past_sessions=past_appts,
        sharing=sharing,
    )
