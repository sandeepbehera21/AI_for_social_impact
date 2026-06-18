"""
Admin-only endpoints.

  GET  /api/admin/stats
  GET  /api/admin/users
  POST /api/admin/action-user/{user_uid}
  POST /api/admin/broadcast
  GET  /api/admin/health
  GET  /api/admin/feedback
"""
from __future__ import annotations

import logging
import time
import os
from typing import List, Dict, Any, Optional
from pydantic import BaseModel, Field

from fastapi import APIRouter, Depends, HTTPException, status, Request
from google.cloud.firestore_v1.base_query import FieldFilter

from app.api.deps import CurrentUser, require_admin
from app.ratelimit import limiter
from app.services import firebase
from app.services.websocket_status import get_active_websockets
from app.config import settings

logger = logging.getLogger("mindease.admin")

router = APIRouter(prefix="/api/admin", tags=["admin"])

# --- Schemas ---

class AdminStatsResponse(BaseModel):
    total_patients: int
    total_doctors: int
    verified_doctors: int
    unverified_doctors: int
    total_appointments: int
    appointments_by_status: Dict[str, int]
    total_journals: int
    total_cbt_exercises: int

class AdminUserItem(BaseModel):
    uid: str
    email: Optional[str] = None
    name: Optional[str] = None
    role: str
    verified: Optional[bool] = None
    verifiedBy: Optional[str] = None
    verifiedAt: Optional[int] = None
    status: Optional[str] = None
    registrationDate: Optional[Any] = None
    specialization: Optional[str] = None
    licenseNumber: Optional[str] = None
    experience: Optional[int] = None
    clinicAffiliation: Optional[str] = None
    bio: Optional[str] = None

class AdminUserListResponse(BaseModel):
    users: List[AdminUserItem]

class AdminUserActionRequest(BaseModel):
    action: str = Field(description="approve, suspend, reject, or disable")

class AdminBroadcastRequest(BaseModel):
    message: str
    type: str = Field(default="info", description="info, warning, or maintenance")
    target: str = Field(default="all", description="all or doctors")

class ServiceHealthItem(BaseModel):
    status: str
    latency_ms: Optional[float] = None
    details: Optional[str] = None

class HealthStatusResponse(BaseModel):
    backend: str
    firestore: ServiceHealthItem
    video_service: ServiceHealthItem
    ai_service: ServiceHealthItem
    active_websockets: int

class FeedbackItem(BaseModel):
    id: str
    patientId: str
    doctorId: str
    rating: int
    comment: str
    appointmentId: str

class FeedbackListResponse(BaseModel):
    feedbacks: List[FeedbackItem]


# --- Endpoints ---

@router.get("/stats", response_model=AdminStatsResponse)
@limiter.limit("10/minute")
def get_stats(request: Request, admin: CurrentUser = Depends(require_admin)) -> AdminStatsResponse:
    """Gather overall high-level statistics across all Firestore collections."""
    db = firebase.firestore_client()
    
    # 1. Count users by role
    users = db.collection("users").get()
    patients_count = 0
    doctors_count = 0
    verified_doctors = 0
    unverified_doctors = 0
    
    for doc in users:
        u = doc.to_dict()
        role = u.get("role")
        if role == "patient":
            patients_count += 1
        elif role == "doctor":
            doctors_count += 1
            if u.get("verified", False):
                verified_doctors += 1
            else:
                unverified_doctors += 1

    # 2. Appointments stats
    appts = db.collection("appointments").get()
    total_appts = len(appts)
    appts_by_status = {}
    for doc in appts:
        status_val = doc.to_dict().get("status", "unknown")
        appts_by_status[status_val] = appts_by_status.get(status_val, 0) + 1

    # 3. Clinical records metrics
    journals = db.collection("journals").get()
    cbt = db.collection("cbt_exercises").get()

    return AdminStatsResponse(
        total_patients=patients_count,
        total_doctors=doctors_count,
        verified_doctors=verified_doctors,
        unverified_doctors=unverified_doctors,
        total_appointments=total_appts,
        appointments_by_status=appts_by_status,
        total_journals=len(journals),
        total_cbt_exercises=len(cbt)
    )


@router.get("/users", response_model=AdminUserListResponse)
@limiter.limit("10/minute")
def list_users(request: Request, admin: CurrentUser = Depends(require_admin)) -> AdminUserListResponse:
    """List all registered users along with their role, verification, and audit details."""
    db = firebase.firestore_client()
    docs = db.collection("users").get()
    
    user_items = []
    for doc in docs:
        d = doc.to_dict()
        user_items.append(AdminUserItem(
            uid=doc.id,
            email=d.get("email"),
            name=d.get("name"),
            role=d.get("role", "patient"),
            verified=d.get("verified"),
            verifiedBy=d.get("verifiedBy"),
            verifiedAt=d.get("verifiedAt"),
            status=d.get("status", "active"),
            registrationDate=d.get("registrationDate"),
            specialization=d.get("specialization"),
            licenseNumber=d.get("licenseNumber"),
            experience=d.get("experience"),
            clinicAffiliation=d.get("clinicAffiliation"),
            bio=d.get("bio")
        ))
        
    return AdminUserListResponse(users=user_items)


@router.post("/action-user/{user_uid}", response_model=Dict[str, Any])
@limiter.limit("20/minute")
def action_user(
    request: Request,
    user_uid: str,
    payload: AdminUserActionRequest,
    admin: CurrentUser = Depends(require_admin)
) -> Dict[str, Any]:
    """Execute administrative actions on user accounts: approve, suspend, reject, disable."""
    db = firebase.firestore_client()
    user_ref = db.collection("users").document(user_uid)
    snap = user_ref.get()
    
    if not snap.exists:
        raise HTTPException(status_code=404, detail="User not found.")
        
    user_data = snap.to_dict()
    action = payload.action.lower()
    
    update_data = {
        "verifiedBy": admin.uid,
        "verifiedAt": int(time.time() * 1000)
    }
    
    if action == "approve":
        update_data["verified"] = True
        update_data["status"] = "active"
    elif action == "suspend":
        update_data["verified"] = False
        update_data["status"] = "suspended"
    elif action == "reject":
        update_data["verified"] = False
        update_data["status"] = "rejected"
    elif action == "disable":
        update_data["verified"] = False
        update_data["status"] = "disabled"
    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid action. Must be one of: approve, suspend, reject, disable"
        )
        
    user_ref.update(update_data)
    
    logger.info(
        "Admin %s completed action '%s' on user %s",
        admin.uid, action, user_uid
    )
    
    return {"uid": user_uid, "action": action, "status": "success", **update_data}


@router.post("/broadcast", response_model=Dict[str, Any])
@limiter.limit("10/minute")
def create_broadcast(
    request: Request,
    payload: AdminBroadcastRequest,
    admin: CurrentUser = Depends(require_admin)
) -> Dict[str, Any]:
    """Broadcast an announcement or alert to targeted users."""
    db = firebase.firestore_client()
    
    broadcast_data = {
        "message": payload.message,
        "type": payload.type,
        "target": payload.target,
        "createdBy": admin.uid,
        "createdAt": int(time.time() * 1000),
        "active": True
    }
    
    doc_ref = db.collection("broadcasts").add(broadcast_data)
    # doc_ref is a tuple: (time, reference)
    ref = doc_ref[1]
    
    logger.info(
        "Admin %s broadcasted global announcement: '%s' to target '%s'",
        admin.uid, payload.message, payload.target
    )
    
    return {"id": ref.id, "status": "created", **broadcast_data}


@router.post("/broadcast/{broadcast_id}/stop", response_model=Dict[str, Any])
@limiter.limit("10/minute")
def stop_broadcast(
    request: Request,
    broadcast_id: str,
    admin: CurrentUser = Depends(require_admin)
) -> Dict[str, Any]:
    """Stop/deactivate a broadcast announcement by setting active=False."""
    db = firebase.firestore_client()
    broadcast_ref = db.collection("broadcasts").document(broadcast_id)
    snap = broadcast_ref.get()
    
    if not snap.exists:
        raise HTTPException(status_code=404, detail="Broadcast not found.")
        
    broadcast_ref.update({"active": False})
    
    logger.info(
        "Admin %s stopped broadcast: %s",
        admin.uid, broadcast_id
    )
    
    return {"id": broadcast_id, "status": "stopped", "active": False}


@router.get("/health", response_model=HealthStatusResponse)
@limiter.limit("10/minute")
def get_health(request: Request, admin: CurrentUser = Depends(require_admin)) -> HealthStatusResponse:
    """Monitor platform services: Firestore connectivity, Video API keys, NLP chatbot readiness, active WS connections."""
    db = firebase.firestore_client()
    
    # 1. Firestore Latency
    latency = None
    fs_status = "healthy"
    fs_details = None
    try:
        t0 = time.perf_counter()
        # Read a single user document or collection limit 1
        db.collection("users").limit(1).get()
        t1 = time.perf_counter()
        latency = round((t1 - t0) * 1000, 2)
    except Exception as e:
        fs_status = "unhealthy"
        fs_details = str(e)
        
    # 2. Agora Video Service
    video_status = "healthy"
    video_details = "Agora RTC app configured"
    if not settings.AGORA_APP_ID or settings.AGORA_APP_ID == "YOUR_AGORA_APP_ID_HERE":
        video_status = "degraded"
        video_details = "Agora APP ID is missing or using default placeholder"
        
    # 3. AI NLP Chatbot health
    ai_status = "healthy"
    ai_details = "Knowledge base found and operational"
    # Resolve the path to the knowledge base JSON (backend/app/data/mindease_kb.json)
    kb_path = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "data",
        "mindease_kb.json"
    )
    if not os.path.exists(kb_path):
        ai_status = "unhealthy"
        ai_details = f"Chatbot knowledge base file is missing at {kb_path}"

    return HealthStatusResponse(
        backend="healthy",
        firestore=ServiceHealthItem(status=fs_status, latency_ms=latency, details=fs_details),
        video_service=ServiceHealthItem(status=video_status, details=video_details),
        ai_service=ServiceHealthItem(status=ai_status, details=ai_details),
        active_websockets=get_active_websockets()
    )


@router.get("/feedback", response_model=FeedbackListResponse)
@limiter.limit("10/minute")
def list_feedback(request: Request, admin: CurrentUser = Depends(require_admin)) -> FeedbackListResponse:
    """Fetch and list patient reviews and comments for doctor appointments."""
    db = firebase.firestore_client()
    docs = db.collection("ratings").get()
    
    feedbacks = []
    for doc in docs:
        d = doc.to_dict()
        feedbacks.append(FeedbackItem(
            id=doc.id,
            patientId=d.get("patientId", ""),
            doctorId=d.get("doctorId", ""),
            rating=d.get("rating", 5),
            comment=d.get("comment", ""),
            appointmentId=d.get("appointmentId", "")
        ))
        
    return FeedbackListResponse(feedbacks=feedbacks)
