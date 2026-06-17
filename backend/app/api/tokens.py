"""Agora token endpoints — secures telehealth video joins."""
from __future__ import annotations

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.api.deps import CurrentUser, get_current_user
from app.ratelimit import limiter
from app.schemas import AgoraRole, RtcTokenResponse
from app.services import agora, firebase

router = APIRouter(prefix="/api/tokens", tags=["tokens"])


@router.get("/rtc", response_model=RtcTokenResponse)
@limiter.limit("30/minute")
def get_rtc_token(
    request: Request,
    appointment_id: str = Query(
        ..., min_length=1, max_length=128, description="Appointment ID to fetch token for"
    ),
    role: AgoraRole = Query(
        AgoraRole.publisher, description="publisher (can send media) or subscriber"
    ),
    uid: int = Query(
        0, ge=0, le=2**32 - 1, description="Numeric user id (0 = let Agora assign)"
    ),
    user: CurrentUser = Depends(get_current_user),
) -> RtcTokenResponse:
    """Return a fresh RTC token (expires in 1 hour) for the given appointment after checks."""
    db = firebase.firestore_client()
    appt_ref = db.collection("appointments").document(appointment_id)
    appt_snap = appt_ref.get()
    if not appt_snap.exists:
        raise HTTPException(status_code=404, detail="Appointment not found.")

    appt = appt_snap.to_dict() or {}

    # 1. Authorisation: only the patient or doctor in this appointment can join
    if user.uid not in (appt.get("patientId"), appt.get("doctorId")):
        raise HTTPException(
            status_code=403,
            detail="You are not a participant in this appointment.",
        )

    status = appt.get("status")
    if status in ("completed", "rejected"):
        raise HTTPException(
            status_code=403,
            detail="This consultation has already ended or been rejected.",
        )
    if status == "expired":
        raise HTTPException(
            status_code=403,
            detail="This consultation session has expired.",
        )

    # Parse dateTime
    dt_str = appt.get("dateTime")
    if not dt_str:
        raise HTTPException(
            status_code=500,
            detail="Appointment has no scheduled date/time.",
        )
    try:
        scheduled_time = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
    except ValueError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Invalid scheduled time format in database: {dt_str}",
        ) from exc

    now = datetime.now(timezone.utc)

    # 2. Time-gating for non-active sessions
    if status == "approved" or status == "pending":
        time_to_start = (scheduled_time - now).total_seconds()
        # Early join gate (T-5)
        if time_to_start > 5 * 60:
            raise HTTPException(
                status_code=403,
                detail="Session window is not open yet. You can join starting 5 minutes before the scheduled time.",
            )
        # Expiry gate (T+15)
        time_since_start = (now - scheduled_time).total_seconds()
        if time_since_start > 15 * 60:
            appt_ref.update({"status": "expired"})
            raise HTTPException(
                status_code=403,
                detail="Session expired. You did not join within the 15-minute grace period.",
            )
        # Transition to active on first successful join
        appt_ref.update({"status": "active"})

    channel_name = appt.get("channelName")
    if not channel_name:
        raise HTTPException(
            status_code=404,
            detail="Appointment has no video channel assigned.",
        )

    try:
        payload = agora.build_rtc_token(channel_name=channel_name, uid=uid, role=role)
    except agora.AgoraConfigError as exc:
        # 503: server isn't configured for video yet — not the caller's fault.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return RtcTokenResponse(**payload)

