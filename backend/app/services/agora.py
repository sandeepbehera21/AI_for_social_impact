"""
Agora.io RTC token builder.

Issues short-lived RTC tokens so the frontend can join a secured telehealth
video channel without ever shipping the App Certificate to the client.
"""
from __future__ import annotations

import logging
import time

from app.config import settings
from app.schemas import AgoraRole

logger = logging.getLogger("mindease.agora")

# Role codes expected by agora-token-builder.
_ROLE_PUBLISHER = 1
_ROLE_SUBSCRIBER = 2
_ROLE_CODES: dict[AgoraRole, int] = {
    AgoraRole.publisher: _ROLE_PUBLISHER,
    AgoraRole.subscriber: _ROLE_SUBSCRIBER,
}


class AgoraConfigError(RuntimeError):
    """Raised when Agora credentials are missing/misconfigured."""


def is_configured() -> bool:
    return bool(settings.AGORA_APP_ID and settings.AGORA_APP_CERTIFICATE)


def build_rtc_token(channel_name: str, uid: int, role: AgoraRole) -> dict:
    """
    Build an RTC token for ``channel_name``/``uid`` that expires after
    AGORA_TOKEN_EXPIRY_SECONDS (default 3600s / 1 hour).

    Returns a dict ready to serialise via RtcTokenResponse.
    """
    if not is_configured():
        raise AgoraConfigError(
            "Agora is not configured. Set AGORA_APP_ID and AGORA_APP_CERTIFICATE."
        )

    try:
        from agora_token_builder import RtcTokenBuilder
    except ImportError as exc:  # pragma: no cover - dependency guard
        raise AgoraConfigError(
            "agora-token-builder is not installed (pip install agora-token-builder)."
        ) from exc

    expiry = settings.AGORA_TOKEN_EXPIRY_SECONDS
    privilege_expired_ts = int(time.time()) + expiry
    role_code = _ROLE_CODES[role]

    token = RtcTokenBuilder.buildTokenWithUid(
        settings.AGORA_APP_ID,
        settings.AGORA_APP_CERTIFICATE,
        channel_name,
        uid,
        role_code,
        privilege_expired_ts,
    )

    return {
        "token": token,
        "channel_name": channel_name,
        "uid": uid,
        "role": role,
        "app_id": settings.AGORA_APP_ID,
        "expires_in": expiry,
        "expires_at": privilege_expired_ts,
    }
