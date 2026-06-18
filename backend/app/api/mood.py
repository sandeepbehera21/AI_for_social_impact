"""
Mood-history endpoints.

  GET /api/patients/{patient_id}/mood-summary   (doctor-only)

Patients read and write their own mood samples directly through the Firestore
client SDK (guarded by security rules). A doctor, however, must NOT have blanket
read access to every patient's emotion history — so the doctor-facing summary
goes through this backend route, which:

  1. verifies the caller is the patient's doctor (an appointment exists between
     them), then
  2. reads the patient's ``mood_entries`` via the Admin SDK and returns an
     aggregated summary (never the raw per-second samples).

This mirrors the clinical-session pattern: sensitive cross-user reads are
mediated by the backend, not exposed wholesale in the security rules.
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, status, Request
from google.cloud.firestore_v1.base_query import FieldFilter

from app.api.deps import CurrentUser, require_doctor
from app.ratelimit import limiter
from app.schemas import MoodSummaryResponse
from app.services import firebase, mood

logger = logging.getLogger("mindease.mood")

router = APIRouter(prefix="/api", tags=["mood"])

# Cap how many samples we pull per patient (newest first) to bound the read.
_MAX_SAMPLES = 2000


def _has_appointment(db, doctor_id: str, patient_id: str) -> bool:
    """True when the doctor has at least one approved/completed appointment with consent from the patient."""
    snap = (
        db.collection("appointments")
        .where(filter=FieldFilter("doctorId", "==", doctor_id))
        .where(filter=FieldFilter("patientId", "==", patient_id))
        .where(filter=FieldFilter("status", "in", ["approved", "completed"]))
        .where(filter=FieldFilter("shareConsent", "==", True))
        .limit(1)
        .get()
    )
    return len(list(snap)) > 0


@router.get("/patients/{patient_id}/mood-summary", response_model=MoodSummaryResponse)
@limiter.limit("30/minute")
def patient_mood_summary(
    request: Request,
    patient_id: str,
    doctor: CurrentUser = Depends(require_doctor),
) -> MoodSummaryResponse:
    """Aggregated mood trend for a patient the calling doctor is treating."""
    db = firebase.firestore_client()

    if not _has_appointment(db, doctor.uid, patient_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You have no appointment with this patient.",
        )

    import time
    db.collection("consent_audit").add({
        "patientId": patient_id,
        "doctorId": doctor.uid,
        "doctorName": doctor.name,
        "accessedAt": int(time.time() * 1000),
        "accessedCategory": "mood_summary"
    })

    # Fetch patient sharing consent settings
    user_snap = db.collection("users").document(patient_id).get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    sharing = user_data.get("sharing", {})

    if not sharing.get("mood", True):
        return MoodSummaryResponse(
            patient_id=patient_id,
            total_samples=0,
            latest=None,
            periods=[],
        )

    docs = (
        db.collection("mood_entries")
        .where(filter=FieldFilter("patientId", "==", patient_id))
        .limit(_MAX_SAMPLES)
        .get()
    )
    entries = [d.to_dict() or {} for d in docs]

    summary = mood.summarize(entries, now_ms=int(time.time() * 1000))
    return MoodSummaryResponse(patient_id=patient_id, **summary)
