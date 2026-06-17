"""Pydantic models — the validated contract for every request/response payload."""
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ---- Chat ----
class FacialEmotion(BaseModel):
    """On-device FER+ probability vector from the browser (camera optional)."""
    happy: float = Field(0.0, ge=0.0, le=1.0)
    sad: float = Field(0.0, ge=0.0, le=1.0)
    angry: float = Field(0.0, ge=0.0, le=1.0)
    fear: float = Field(0.0, ge=0.0, le=1.0)
    neutral: float = Field(0.0, ge=0.0, le=1.0)


class ChatRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=4000, description="User message")
    # Optional live facial-emotion snapshot for NLP+vision emotion fusion. Absent
    # when the user's camera is off — the engine then runs on NLP alone.
    facial_emotion: FacialEmotion | None = None
    # Optional conversation id. When supplied, the backend keeps a short
    # context (last 10 messages, state, topics) so replies are context-aware
    # across turns. Omit it for one-shot, stateless replies.
    session_id: str | None = Field(None, max_length=128)
    # Optional patient ID to load their recent journals/CBT history for context injection.
    patient_id: str | None = Field(None, max_length=128)


class SentimentScores(BaseModel):
    joy: float = 0.0
    sadness: float = 0.0
    anger: float = 0.0
    fear: float = 0.0
    neutral: float = 0.0


class Analysis(BaseModel):
    sentiment: SentimentScores
    safety_index: float = Field(..., ge=0.0, le=1.0)
    dominant_emotion: str
    source: Literal["model", "lexicon"]
    # Intent detection + emotion fusion outputs (populated for normal replies).
    dominant_intent: str | None = None
    intent_confidence: float = 0.0
    fused_emotion: str | None = None
    fusion_sources: list[str] = Field(default_factory=list)
    # Cross-modal risk: the facial half of the distress signal and the fused
    # text+face risk score. ``facial_distress`` is 0.0 when the camera is off.
    facial_distress: float = Field(0.0, ge=0.0, le=1.0)
    fused_risk: float = Field(0.0, ge=0.0, le=1.0)
    # Conversation-context state that produced this reply (greeting,
    # daily_checkin, stress_discussion, …). Populated when a session is used.
    conversation_state: str | None = None
    named_entities: dict[str, str] = Field(default_factory=dict)



class ChatResponse(BaseModel):
    type: Literal["message", "safety_trigger"] = "message"
    response: str
    analysis: Analysis | None = None
    # Explicit boolean flags for clients that key off the safety contract
    # rather than the `type` discriminator.
    trigger_safety: bool = False
    show_doctor_booking: bool = False
    # Structured crisis contract (set only on a safety_trigger).
    crisis_detected: bool = False
    doctor_consultation_required: bool = False
    recommendation: str | None = None
    # Populated only on a safety_trigger so the frontend can react.
    hotlines: list["Hotline"] | None = None
    book_consultation_route: str | None = None
    suggestions: list[str] = Field(default_factory=list)


class Hotline(BaseModel):
    name: str
    phone: str
    region: str = "Global"


# ---- Mood history (facial-emotion trends) ----
class MoodPeriodSummary(BaseModel):
    period: str  # "daily" | "weekly" | "monthly"
    samples: int = 0
    dominant: str | None = None
    distribution: dict[str, float] = Field(default_factory=dict)
    avg_confidence: float = 0.0
    risk_score: float = 0.0
    risk_level: str = "low"


class MoodLatest(BaseModel):
    dominantEmotion: str | None = None
    confidence: float = 0.0
    ts: int = 0


class MoodSummaryResponse(BaseModel):
    patient_id: str
    total_samples: int = 0
    latest: MoodLatest | None = None
    periods: list[MoodPeriodSummary] = Field(default_factory=list)


# ---- Agora tokens ----
class AgoraRole(str, Enum):
    publisher = "publisher"  # host / doctor / patient who can send media
    subscriber = "subscriber"  # audience / view-only


class RtcTokenResponse(BaseModel):
    token: str
    channel_name: str
    uid: int
    role: AgoraRole
    app_id: str
    expires_in: int
    expires_at: int


# ---- Clinical sessions & doctor keys (Phase 4) ----
class DoctorKeyResponse(BaseModel):
    """Result of ensuring a doctor has an RSA-2048 key-pair."""
    public_key: str = Field(..., description="PEM-encoded SPKI public key")
    public_key_fingerprint: str = Field(..., description="SHA-256 hex of the public PEM")
    # Present ONLY the first time the pair is generated, so the doctor can save
    # their private key. Never returned again on subsequent calls.
    private_key: str | None = Field(
        None, description="PEM private key — returned once, on first generation"
    )
    created: bool = Field(..., description="True if a new pair was generated this call")


class SessionCompleteRequest(BaseModel):
    """Payload a doctor submits to finalise + sign a clinical session."""
    appointment_id: str = Field(..., min_length=1, max_length=128)
    session_notes: str = Field("", max_length=20000)
    diagnosis: str = Field("", max_length=8000)
    prescriptions: str = Field("", max_length=8000)


class SessionCompleteResponse(BaseModel):
    appointment_id: str
    status: str
    signature: str = Field(..., description="base64 RSASSA-PKCS1-v1_5/SHA-256 signature")
    pdf_sha256: str = Field(..., description="hex SHA-256 of the signed PDF")
    report_url: str = Field(..., description="Authenticated endpoint to fetch the PDF")


class SessionDetailResponse(BaseModel):
    """Decrypted clinical detail for an authorised party (doctor or patient)."""
    appointment_id: str
    patient_name: str
    doctor_name: str
    status: str
    session_notes: str = ""
    diagnosis: str = ""
    prescriptions: str = ""
    signature: str | None = None
    public_key: str | None = None
    pdf_sha256: str | None = None
    completed_at: str | None = None
    has_report: bool = False
    emotion_summary: dict | None = None


class PatientClinicalSummaryResponse(BaseModel):
    journals: list[dict] = []
    cbt_exercises: list[dict] = []
    mood_entries: list[dict] = []
    past_sessions: list[dict] = []
    sharing: dict | None = None


# ---- Wellness ecosystem (Phase 2) ----
class WellnessSummaryResponse(BaseModel):
    """Doctor-facing aggregate of a patient's wellness ecosystem."""
    patient_id: str
    wellness_score: dict = Field(default_factory=dict)
    recommendations: list[dict] = Field(default_factory=list)
    habit_summary: dict | None = None
    plan: dict | None = None
    plan_adherence: dict | None = None
    crisis_events: list[dict] = Field(default_factory=list)
    mood_summary: dict | None = None
    sharing: dict | None = None
    recommendation_history: list[dict] = Field(default_factory=list)
    recent_alerts: list[dict] = Field(default_factory=list)


ChatResponse.model_rebuild()
