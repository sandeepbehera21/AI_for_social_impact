"""
Wellness ecosystem endpoints (Phase 2).

  GET /api/patients/{patient_id}/wellness-summary   (doctor-only)

Patients generate and persist their own wellness plans + habit records directly
through the Firestore client SDK (guarded by security rules); this backend route
mirrors the mood-summary pattern so a doctor — and only a doctor with an
appointment with the patient — can read the aggregated wellness picture (score,
recommendations, habit stats, plan adherence, crisis events) without blanket
cross-user read access.
"""
from __future__ import annotations

import logging
import time

from fastapi import APIRouter, Depends, HTTPException, status, Request
from google.cloud.firestore_v1.base_query import FieldFilter

from app.api.deps import CurrentUser, require_doctor
from app.ratelimit import limiter
from app.schemas import WellnessSummaryResponse
from app.services import firebase, patient_data, wellness

logger = logging.getLogger("mindease.wellness")

router = APIRouter(prefix="/api", tags=["wellness"])


def _has_appointment(db, doctor_id: str, patient_id: str) -> bool:
    """Return True only when an active (confirmed or pending) appointment exists between
    the doctor and the patient. Cancelled/rejected appointments do NOT grant access."""
    snap = (
        db.collection("appointments")
        .where(filter=FieldFilter("doctorId", "==", doctor_id))
        .where(filter=FieldFilter("patientId", "==", patient_id))
        .where(filter=FieldFilter("status", "in", ["confirmed", "pending"]))
        .limit(1)
        .get()
    )
    return len(list(snap)) > 0


@router.get(
    "/patients/{patient_id}/wellness-summary",
    response_model=WellnessSummaryResponse,
)
@limiter.limit("30/minute")
def patient_wellness_summary(
    request: Request,
    patient_id: str,
    doctor: CurrentUser = Depends(require_doctor),
) -> WellnessSummaryResponse:
    """Aggregated wellness picture for a patient the calling doctor is treating."""
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
        "accessedCategory": "wellness_summary"
    })

    # Fetch patient sharing consent settings
    user_snap = db.collection("users").document(patient_id).get()
    user_data = user_snap.to_dict() if user_snap.exists else {}
    sharing = user_data.get("sharing", {})

    signals = patient_data.load_signals(patient_id, now_ms=int(time.time() * 1000))

    # Apply consent filters
    shared_mood = signals["mood_summary"] if sharing.get("mood", True) else None
    shared_habits = signals["habit_summary"] if sharing.get("habits", True) else None
    shared_journals = signals["journals"] if sharing.get("journal", True) else []
    shared_cbt = signals["cbt"] if sharing.get("cbt", True) else []
    shared_plan = signals["active_plan"] if sharing.get("habits", True) else None
    shared_crisis = signals["crisis_events"] if sharing.get("mood", True) else []

    score = wellness.compute_wellness_score(
        mood_summary=shared_mood,
        habit_summary=shared_habits,
        journals=shared_journals,
        cbt=shared_cbt,
        risk_score=signals["risk_score"] if sharing.get("mood", True) else 0.0,
    )
    adherence = patient_data.plan_adherence(shared_plan) if shared_plan else None
    recommendations = wellness.generate_recommendations(
        mood_summary=shared_mood,
        habit_summary=shared_habits,
        journals=shared_journals,
        cbt=shared_cbt,
        risk_score=signals["risk_score"] if sharing.get("mood", True) else 0.0,
        plan_adherence=adherence,
        prev_recommendations=signals.get("prev_recommendation_ids"),
    )

    # Recent doctor-facing crisis alerts (most severe / newest first), so the
    # dashboard can surface SOS activity without a separate query.
    recent_alerts = [
        {
            "type": ev.get("type"),
            "detail": ev.get("detail"),
            "ts": ev.get("ts"),
        }
        for ev in (shared_crisis or [])[:10]
    ]

    return WellnessSummaryResponse(
        patient_id=patient_id,
        wellness_score=score,
        recommendations=recommendations,
        habit_summary=shared_habits,
        plan=shared_plan,
        plan_adherence=adherence,
        crisis_events=shared_crisis,
        mood_summary=shared_mood,
        sharing=sharing,
        recommendation_history=signals.get("recommendation_history", []) if sharing.get("mood", True) else [],
        recent_alerts=recent_alerts if sharing.get("mood", True) else [],
    )


from pydantic import BaseModel
from app.api.deps import get_current_user

class CrisisAlertRequest(BaseModel):
    type: str
    detail: str = ""

@router.post("/patients/crisis-alert")
@limiter.limit("10/minute")
def trigger_crisis_alert(
    request: Request,
    payload: CrisisAlertRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Trigger a clinician notification for all doctors treating this patient when a crisis/SOS event is logged."""
    if user.role != "patient":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only patients can trigger crisis alerts."
        )

    db = firebase.firestore_client()
    
    # Find all doctors with whom the patient has an appointment
    appts = (
        db.collection("appointments")
        .where(filter=FieldFilter("patientId", "==", user.uid))
        .get()
    )
    
    doctor_ids = set()
    for doc_snap in appts:
        appt_data = doc_snap.to_dict() or {}
        doc_id = appt_data.get("doctorId")
        if doc_id:
            doctor_ids.add(doc_id)
            
    if not doctor_ids:
        return {"status": "success", "notified_doctors": 0}
        
    import time
    from firebase_admin import firestore
    
    labels = {
        "sos_opened": "Opened SOS Center",
        "grounding_completed": "Completed grounding exercise",
        "breathing_completed": "Completed breathing exercise",
        "chat_crisis": "Crisis detected in chat",
        "trusted_contact_used": "Reached out to a trusted contact",
    }
    event_label = labels.get(payload.type, payload.type)
    
    patient_name = user.profile.get("name") or user.profile.get("email") or "A patient"
    detail_msg = f"{patient_name} triggered a crisis: {event_label}"
    if payload.detail:
        detail_msg += f" ({payload.detail})"
        
    notified_count = 0
    for doc_id in doctor_ids:
        db.collection("notifications").add({
            "userId": doc_id,
            "patientId": user.uid,
            "patientName": patient_name,
            "type": "crisis",
            "title": f"Crisis Alert: {patient_name}",
            "detail": detail_msg,
            "severity": "high",
            "read": False,
            "ts": int(time.time() * 1000),
            "createdAt": firestore.SERVER_TIMESTAMP
        })
        notified_count += 1
        
    return {"status": "success", "notified_doctors": notified_count}

