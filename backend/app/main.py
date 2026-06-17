"""
MindEase — FastAPI backend (Phase 2).

Surface:
  GET  /health              liveness + capability report
  POST /chat                one-shot REST chat (kept for compatibility)
  WS   /ws/chat             real-time bi-directional chat with safety gating
  GET  /api/tokens/rtc      Agora RTC token for telehealth video

The WebSocket endpoint is the primary path. Every inbound message is scored by
the NLP severity pipeline; a Critical-Distress score (> SAFETY_THRESHOLD)
short-circuits the response engine and returns a safety-trigger payload instead.
All replies are generated locally (intent + fused emotion) — no external LLM.
"""
from __future__ import annotations

import logging
import time
from collections import defaultdict

from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded

from app import __version__
from app.config import settings
from app.ratelimit import limiter
from app.ml.sentiment import AnalysisResult, analyzer
from app.api import tokens, clinical, mood, wellness as wellness_api, admin
from app.schemas import Analysis, ChatRequest, ChatResponse, Hotline, SentimentScores
from app.services import agora, crypto, firebase, chatbot
from app.services.context import (
    ConversationContext,
    ConversationState,
    manager as context_manager,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("mindease")

# Lightweight WebSocket rate limiter: tracks per-IP message counts in memory.
# Resets every 60 seconds; 60 messages/minute per IP is generous for a chat app.
_ws_counters: dict[str, list[float]] = defaultdict(list)
_WS_WINDOW = 60.0      # seconds
_WS_MAX_MSGS = 60      # per window


def _ws_allow(ip: str) -> bool:
    """Return True if the IP is within its WebSocket rate limit, False to reject."""
    now = time.monotonic()
    bucket = _ws_counters[ip]
    # Drop timestamps outside the rolling window
    while bucket and bucket[0] < now - _WS_WINDOW:
        bucket.pop(0)
    if len(bucket) >= _WS_MAX_MSGS:
        return False
    bucket.append(now)
    return True

# Crisis resources surfaced on a safety trigger.
HOTLINES = [
    Hotline(name="988 Suicide & Crisis Lifeline", phone="988", region="US"),
    Hotline(name="Crisis Text Line", phone="Text HOME to 741741", region="US"),
    Hotline(name="Vandrevala Foundation Helpline", phone="1860-2662-345", region="IN"),
    Hotline(name="International Association for Suicide Prevention", phone="https://www.iasp.info/resources/Crisis_Centres/", region="Global"),
]
BOOK_CONSULTATION_ROUTE = "/consult-doc"

app = FastAPI(title="MindEase API", version=__version__)

# Wire the slowapi limiter into the FastAPI app
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_kwargs = {
    "allow_origins": settings.FRONTEND_ORIGINS,
    "allow_credentials": True,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if settings.DEV_ALLOW_LOCALHOST:
    cors_kwargs["allow_origin_regex"] = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(CORSMiddleware, **cors_kwargs)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data: https:; "
        "connect-src 'self' ws: wss: https:; "
        "frame-ancestors 'none';"
    )
    return response
app.include_router(tokens.router)
app.include_router(clinical.router)
app.include_router(mood.router)
app.include_router(wellness_api.router)
app.include_router(admin.router)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _to_analysis(result: AnalysisResult) -> Analysis:
    return Analysis(
        sentiment=SentimentScores(**result.sentiment),
        safety_index=result.safety_index,
        dominant_emotion=result.dominant_emotion,
        source=result.source,
    )


def _build_response(
    message: str,
    facial: dict | None = None,
    context: ConversationContext | None = None,
    patient_id: str | None = None,
) -> ChatResponse:
    """Core chat logic shared by the REST and WebSocket paths."""
    result = analyzer.analyze(message)
    analysis = _to_analysis(result)

    # Cross-modal risk: fuse the text distress (safety_index) with the facial
    # distress so the camera can corroborate — never lower — the text signal.
    facial_distress = chatbot.facial_distress_score(facial)
    text_risk = result.safety_index
    fused_risk = round(min(1.0, text_risk + 0.4 * facial_distress), 4)
    analysis.facial_distress = facial_distress
    analysis.fused_risk = fused_risk

    if analyzer.is_critical(result):
        logger.info("Safety trigger (index=%.2f)", result.safety_index)
        # Record the crisis turn so the conversation state reflects it.
        if context is not None:
            context.record_user(message, "crisis", result.dominant_emotion)
            context.record_bot(
                "Crisis safety resources surfaced.",
                ConversationState.CRISIS_INTERVENTION,
            )
            analysis.conversation_state = context.state
            analysis.named_entities = dict(context.named_entities)
        return ChatResponse(
            type="safety_trigger",
            response=(
                "I'm really glad you reached out, and I'm concerned about what you're "
                "going through. You don't have to face this alone — please reach out to "
                "one of the resources below right now. If you're in immediate danger, "
                "call your local emergency number."
            ),
            analysis=analysis,
            trigger_safety=True,
            show_doctor_booking=True,
            crisis_detected=True,
            doctor_consultation_required=True,
            recommendation="Book an appointment with a doctor immediately.",
            hotlines=HOTLINES,
            book_consultation_route=BOOK_CONSULTATION_ROUTE,
        )

    reply = chatbot.generate_reply(message, result, facial, context, patient_id)
    # Surface the intent + fused emotion + conversation state that drove the reply.
    analysis.dominant_intent = reply.intent
    analysis.intent_confidence = reply.intent_confidence
    analysis.fused_emotion = reply.fused_emotion
    analysis.fusion_sources = list(reply.fused.sources)
    # State only carries meaning across turns, so expose it only with a session.
    if context is not None:
        analysis.conversation_state = reply.conversation_state
        analysis.named_entities = dict(context.named_entities)

    response = ChatResponse(type="message", response=reply.text, analysis=analysis, suggestions=reply.suggestions)

    # Early (sub-crisis) escalation: moderate text distress corroborated by a
    # strongly negative face — or a high fused score — recommends a doctor
    # consultation *before* a full crisis, surfacing a booking action in the UI.
    early_concern = (text_risk >= 0.45 and facial_distress >= 0.6) or fused_risk >= 0.8
    if early_concern:
        response.show_doctor_booking = True
        response.doctor_consultation_required = True
        response.recommendation = (
            "Your recent messages and emotional signals suggest it may help to "
            "speak with a professional soon."
        )
        if "Portal" not in reply.text:
            response.response = (
                reply.text
                + " I'm also noticing this has been weighing on you — it may help to "
                "talk with someone. You can book a consultation through the MindEase "
                "Portal whenever you're ready."
            )
    return response


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> dict:
    return {
        "status": "ok",
        "version": __version__,
        "chatbot_configured": chatbot.is_configured(),
        "intents_supported": len(chatbot.SUPPORTED_INTENTS),
        "retrieval": chatbot.retrieval_status(),
        "agora_configured": agora.is_configured(),
        "firebase_configured": firebase.is_configured(),
        "clinical_crypto": crypto.status(),
        "nlp_using_model": analyzer.using_model,
        "safety_threshold": settings.SAFETY_THRESHOLD,
    }


def _facial_dict(req: ChatRequest) -> dict | None:
    """Extract the optional facial-emotion vector as a plain dict (or None)."""
    return req.facial_emotion.model_dump() if req.facial_emotion else None


@app.post("/chat", response_model=ChatResponse)
@limiter.limit("30/minute")
def chat(request: Request, req: ChatRequest) -> ChatResponse:
    """One-shot REST chat — rate-limited to 30 requests/minute per IP.

    When ``session_id`` is supplied the reply is context-aware across calls;
    without it the reply is stateless (back-compatible behaviour).
    """
    # Optional authentication validation for patient profile reads
    auth_uid = None
    auth_header = request.headers.get("Authorization")
    if auth_header and auth_header.startswith("Bearer "):
        token = auth_header.split(" ", 1)[1]
        try:
            claims = firebase.verify_id_token(token)
            auth_uid = claims.get("uid") or claims.get("sub")
        except Exception as e:
            logger.warning("REST chat authentication failed: %s", e)

    if req.patient_id:
        if not auth_uid or auth_uid != req.patient_id:
            raise HTTPException(
                status_code=403,
                detail="Unauthorized: You cannot access clinical signals for another patient."
            )

    try:
        context = context_manager.get(req.session_id, owner_id=auth_uid) if req.session_id else None
    except PermissionError:
        raise HTTPException(
            status_code=403,
            detail="Unauthorized: You do not have permission to access this session context."
        )
    response = _build_response(req.message, _facial_dict(req), context, req.patient_id)
    
    if req.session_id and context:
        context_manager.save(context)
        
    return response


@app.websocket("/ws/chat")
async def ws_chat(websocket: WebSocket) -> None:
    """Real-time bi-directional chat with per-message safety gating + rate limiting.

    Context resolution: if a message carries a ``session_id`` we use the shared
    ContextManager (so a dropped/reconnected socket resumes the same
    conversation); otherwise the socket falls back to a context that lives for
    the lifetime of this connection.
    """
    # 1. Validate Origin header to prevent Cross-Site WebSocket Hijacking (CSWSH)
    origin = websocket.headers.get("origin")
    if origin:
        import re
        allowed_origins = settings.FRONTEND_ORIGINS
        is_allowed = origin in allowed_origins
        if not is_allowed and settings.DEV_ALLOW_LOCALHOST:
            allowed_regex = r"^http://(localhost|127\.0\.0\.1)(:\d+)?$"
            is_allowed = bool(re.match(allowed_regex, origin))
        if not is_allowed:
            logger.warning("Rejecting WebSocket connection from unauthorized origin: %s", origin)
            await websocket.accept()
            await websocket.close(code=4008)  # WS_1008_POLICY_VIOLATION
            return

    await websocket.accept()
    from app.services.websocket_status import increment_active_websockets, decrement_active_websockets
    increment_active_websockets()
    client_ip = websocket.client.host if websocket.client else "unknown"
    connection_context = ConversationContext()

    # 2. Extract Firebase ID token query parameter if present for authentication
    token = websocket.query_params.get("token")
    auth_uid = None
    if token:
        try:
            claims = firebase.verify_id_token(token)
            auth_uid = claims.get("uid") or claims.get("sub")
            logger.info("WebSocket connection authenticated for user: %s", auth_uid)
        except Exception as e:
            logger.warning("WebSocket token authentication failed: %s", e)

    try:
        try:
            while True:
                raw = await websocket.receive_json()

                # Per-IP rate limit for WebSocket messages
                if not _ws_allow(client_ip):
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Rate limit exceeded — please slow down.",
                    })
                    continue

                try:
                    req = ChatRequest(**raw) if isinstance(raw, dict) else ChatRequest(message=raw)
                except ValidationError as exc:
                    await websocket.send_json({"type": "error", "detail": exc.errors()})
                    continue

                # 3. Patient ID authorization gate
                if req.patient_id:
                    if not auth_uid or auth_uid != req.patient_id:
                        await websocket.send_json({
                            "type": "error",
                            "detail": "Unauthorized: You cannot access clinical signals for another patient."
                        })
                        continue

                try:
                    context = (
                        context_manager.get(req.session_id, owner_id=auth_uid)
                        if req.session_id
                        else connection_context
                    )
                except PermissionError:
                    await websocket.send_json({
                        "type": "error",
                        "detail": "Unauthorized: You do not have permission to access this session context."
                    })
                    continue
                response = _build_response(req.message, _facial_dict(req), context, req.patient_id)
                await websocket.send_json(response.model_dump())
                
                if req.session_id and context:
                    context_manager.save(context)
        except WebSocketDisconnect:
            logger.info("WebSocket client disconnected.")
        except Exception as exc:  # noqa: BLE001
            logger.exception("WebSocket error: %s", exc)
            try:
                await websocket.send_json({"type": "error", "detail": "Internal server error"})
            except Exception:  # noqa: BLE001
                pass
    finally:
        decrement_active_websockets()


@app.exception_handler(Exception)
async def unhandled_exception_handler(request, exc):  # pragma: no cover
    logger.exception("Unhandled error on %s: %s", request.url.path, exc)
    raise HTTPException(status_code=500, detail="Internal server error")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app.main:app", host=settings.HOST, port=settings.PORT, reload=True)
