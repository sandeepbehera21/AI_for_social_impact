"""
FastAPI auth dependencies.

These turn an inbound ``Authorization: Bearer <firebase-id-token>`` header into
a verified caller, and gate clinical endpoints to the right role. Every
protected route depends on one of these instead of trusting client-supplied ids.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.services import firebase

# auto_error=False: we raise our own 401s with friendlier messages.
_bearer = HTTPBearer(auto_error=False)


class CurrentUser:
    """The verified caller: their uid, token claims, and Firestore profile."""

    def __init__(self, uid: str, claims: dict, profile: dict):
        self.uid = uid
        self.claims = claims
        self.profile = profile
        self.role = profile.get("role")
        self.name = profile.get("name") or profile.get("email") or "User"
        self.email = profile.get("email")


def get_current_user(
    creds: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> CurrentUser:
    """
    Verify the bearer ID token and load the caller's ``users/{uid}`` profile.
    Raises 401 when the token is missing/invalid, 503 when Admin is unconfigured.
    """
    if creds is None or not creds.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing Authorization bearer token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not firebase.is_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Authentication backend (Firebase Admin) is not configured.",
        )

    try:
        claims = firebase.verify_id_token(creds.credentials)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=str(exc),
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    uid = claims.get("uid") or claims.get("sub")
    db = firebase.firestore_client()
    snap = db.collection("users").document(uid).get()
    profile = snap.to_dict() if snap.exists else {}
    return CurrentUser(uid=uid, claims=claims, profile=profile)


def require_doctor(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allow only callers whose profile role is ``doctor`` and is verified."""
    if user.role != "doctor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is restricted to doctors.",
        )
    if not user.profile.get("verified", False):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Clinician account verification is pending approval.",
        )
    return user


def require_admin(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
    """Allow only callers whose profile role is ``admin``."""
    if user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This action is restricted to administrators.",
        )
    return user
