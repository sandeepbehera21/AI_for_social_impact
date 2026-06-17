"""
Firebase Admin integration — backend identity & data plane.

Gives the FastAPI backend two things the client SDK can't be trusted to do:

  * **verify_id_token** — cryptographically validate the Firebase ID token a
    signed-in user sends in the ``Authorization: Bearer`` header, so protected
    endpoints (e.g. "complete a clinical session") know *who* is calling and
    can't be spoofed.
  * **firestore()** — a server-side Firestore handle that bypasses the security
    rules, used to read/write clinical documents the rules deliberately hide
    from clients (encrypted notes, doctor private keys).

Initialisation is lazy and fault-tolerant: a missing service-account file logs
a warning and leaves the service "unconfigured" rather than crashing import, in
keeping with the agora service.
"""
from __future__ import annotations

import logging
import os

from app.config import settings

logger = logging.getLogger("mindease.firebase")

_app = None
_db = None
_init_error: str | None = None


def _resolve_credentials_path() -> str:
    """Resolve FIREBASE_CREDENTIALS against the backend/ directory."""
    path = settings.FIREBASE_CREDENTIALS
    if os.path.isabs(path):
        return path
    # This file is backend/app/services/firebase.py → backend/ is three up.
    backend_dir = os.path.dirname(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    )
    return os.path.join(backend_dir, path)


def _init() -> None:
    """Initialise the Admin app + Firestore client exactly once."""
    global _app, _db, _init_error
    if _app is not None or _init_error is not None:
        return
    try:
        import json
        import firebase_admin
        from firebase_admin import credentials, firestore

        # Check if the credentials config is a raw JSON string or a file path
        config_val = settings.FIREBASE_CREDENTIALS.strip()
        if config_val.startswith("{"):
            try:
                cert_dict = json.loads(config_val)
                cred = credentials.Certificate(cert_dict)
                logger.info("Firebase Admin initialising from raw JSON string.")
            except Exception as json_err:
                _init_error = f"Failed to parse raw JSON credentials: {json_err}"
                logger.warning("Firebase Admin disabled: %s", _init_error)
                return
        else:
            cred_path = _resolve_credentials_path()
            if not os.path.exists(cred_path):
                _init_error = f"service-account file not found: {cred_path}"
                logger.warning("Firebase Admin disabled: %s", _init_error)
                return
            cred = credentials.Certificate(cred_path)
            logger.info("Firebase Admin initialising from file path: %s", cred_path)

        # Reuse an already-initialised default app if present (e.g. firebase_setup.py).
        if firebase_admin._apps:  # type: ignore[attr-defined]
            _app = firebase_admin.get_app()
        else:
            _app = firebase_admin.initialize_app(cred)
        _db = firestore.client(_app)
        logger.info("Firebase Admin ready.")
    except Exception as exc:  # noqa: BLE001

        _init_error = str(exc)
        logger.warning("Firebase Admin init failed: %s", exc)


def is_configured() -> bool:
    _init()
    return _db is not None


def firestore_client():
    """Return the server Firestore client, or raise if Admin isn't configured."""
    _init()
    if _db is None:
        raise RuntimeError(
            f"Firebase Admin is not configured ({_init_error}). "
            "Place a valid service-account JSON at the FIREBASE_CREDENTIALS path."
        )
    return _db


def verify_id_token(id_token: str) -> dict:
    """
    Verify a Firebase ID token and return its decoded claims (incl. ``uid``).
    Raises ValueError on any failure so the API layer can map it to a 401.
    """
    _init()
    if _app is None:
        raise RuntimeError(
            f"Firebase Admin is not configured ({_init_error}). "
            "Cannot verify identity tokens."
        )
    try:
        from firebase_admin import auth as admin_auth

        return admin_auth.verify_id_token(id_token, app=_app)
    except Exception as exc:  # noqa: BLE001 — many firebase exception types
        raise ValueError(f"Invalid or expired ID token: {exc}") from exc
