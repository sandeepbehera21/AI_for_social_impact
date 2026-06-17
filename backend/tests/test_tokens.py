"""Agora RTC token endpoint + builder tests.

Env (dummy Agora creds, lexicon mode) is set in conftest.py before import.
"""
import base64
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.api.deps import get_current_user, CurrentUser
from app.config import settings
from app.main import app
from app.schemas import AgoraRole
from app.services import agora

client = TestClient(app)


def _looks_base64ish(token: str) -> bool:
    # Agora RTC tokens are version-prefixed ("006") + 32-char app id + base64.
    assert token.startswith("006"), "expected Agora token version prefix 006"
    payload = token[3 + 32 :]
    base64.b64decode(payload)  # raises if not valid base64
    return True


def test_builder_returns_valid_token():
    out = agora.build_rtc_token("telehealth-room-1", uid=42, role=AgoraRole.publisher)
    assert out["channel_name"] == "telehealth-room-1"
    assert out["uid"] == 42
    assert out["expires_in"] == settings.AGORA_TOKEN_EXPIRY_SECONDS == 3600
    assert _looks_base64ish(out["token"])


@patch("app.services.firebase.firestore_client")
def test_endpoint_returns_token_in_window(mock_firestore):
    # Mock user who is the patient
    user_uid = "patient-123"

    def mock_get_current_user():
        return CurrentUser(
            uid=user_uid,
            claims={"uid": user_uid},
            profile={"role": "patient", "name": "Jane", "email": "jane@example.com"}
        )

    app.dependency_overrides[get_current_user] = mock_get_current_user

    mock_doc = MagicMock()
    mock_doc.exists = True

    # Scheduled 2 minutes from now (within [T-5, T+15])
    scheduled_time = datetime.now(timezone.utc) + timedelta(minutes=2)
    mock_doc.to_dict.return_value = {
        "patientId": user_uid,
        "doctorId": "doctor-456",
        "dateTime": scheduled_time.isoformat(),
        "status": "approved",
        "channelName": "mindease-test-channel"
    }

    mock_ref = MagicMock()
    mock_ref.get.return_value = mock_doc
    mock_firestore.return_value.collection.return_value.document.return_value = mock_ref

    try:
        res = client.get(
            "/api/tokens/rtc",
            params={"appointment_id": "appt-789", "role": "publisher", "uid": 7},
        )
        assert res.status_code == 200, res.text
        data = res.json()
        assert data["channel_name"] == "mindease-test-channel"
        assert data["role"] == "publisher"
        assert _looks_base64ish(data["token"])

        # Verify status update was triggered to mark session active
        mock_ref.update.assert_called_with({"status": "active"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@patch("app.services.firebase.firestore_client")
def test_endpoint_rejects_unauthorized_user(mock_firestore):
    # Mock user who is NOT in the appointment
    user_uid = "stranger-999"

    def mock_get_current_user():
        return CurrentUser(
            uid=user_uid,
            claims={"uid": user_uid},
            profile={"role": "patient", "name": "Stranger", "email": "stranger@example.com"}
        )

    app.dependency_overrides[get_current_user] = mock_get_current_user

    mock_doc = MagicMock()
    mock_doc.exists = True
    scheduled_time = datetime.now(timezone.utc)
    mock_doc.to_dict.return_value = {
        "patientId": "patient-123",
        "doctorId": "doctor-456",
        "dateTime": scheduled_time.isoformat(),
        "status": "approved",
        "channelName": "mindease-test-channel"
    }

    mock_ref = MagicMock()
    mock_ref.get.return_value = mock_doc
    mock_firestore.return_value.collection.return_value.document.return_value = mock_ref

    try:
        res = client.get(
            "/api/tokens/rtc",
            params={"appointment_id": "appt-789", "role": "publisher", "uid": 7},
        )
        assert res.status_code == 403
        assert "not a participant" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@patch("app.services.firebase.firestore_client")
def test_endpoint_rejects_too_early(mock_firestore):
    user_uid = "patient-123"

    def mock_get_current_user():
        return CurrentUser(
            uid=user_uid,
            claims={"uid": user_uid},
            profile={"role": "patient", "name": "Jane", "email": "jane@example.com"}
        )

    app.dependency_overrides[get_current_user] = mock_get_current_user

    mock_doc = MagicMock()
    mock_doc.exists = True

    # Scheduled 10 minutes from now (before T-5)
    scheduled_time = datetime.now(timezone.utc) + timedelta(minutes=10)
    mock_doc.to_dict.return_value = {
        "patientId": user_uid,
        "doctorId": "doctor-456",
        "dateTime": scheduled_time.isoformat(),
        "status": "approved",
        "channelName": "mindease-test-channel"
    }

    mock_ref = MagicMock()
    mock_ref.get.return_value = mock_doc
    mock_firestore.return_value.collection.return_value.document.return_value = mock_ref

    try:
        res = client.get(
            "/api/tokens/rtc",
            params={"appointment_id": "appt-789", "role": "publisher", "uid": 7},
        )
        assert res.status_code == 403
        assert "not open yet" in res.json()["detail"]
    finally:
        app.dependency_overrides.pop(get_current_user, None)


@patch("app.services.firebase.firestore_client")
def test_endpoint_rejects_too_late_and_expires(mock_firestore):
    user_uid = "patient-123"

    def mock_get_current_user():
        return CurrentUser(
            uid=user_uid,
            claims={"uid": user_uid},
            profile={"role": "patient", "name": "Jane", "email": "jane@example.com"}
        )

    app.dependency_overrides[get_current_user] = mock_get_current_user

    mock_doc = MagicMock()
    mock_doc.exists = True

    # Scheduled 20 minutes ago (after T+15)
    scheduled_time = datetime.now(timezone.utc) - timedelta(minutes=20)
    mock_doc.to_dict.return_value = {
        "patientId": user_uid,
        "doctorId": "doctor-456",
        "dateTime": scheduled_time.isoformat(),
        "status": "approved",
        "channelName": "mindease-test-channel"
    }

    mock_ref = MagicMock()
    mock_ref.get.return_value = mock_doc
    mock_firestore.return_value.collection.return_value.document.return_value = mock_ref

    try:
        res = client.get(
            "/api/tokens/rtc",
            params={"appointment_id": "appt-789", "role": "publisher", "uid": 7},
        )
        assert res.status_code == 403
        assert "expired" in res.json()["detail"].lower()
        mock_ref.update.assert_called_with({"status": "expired"})
    finally:
        app.dependency_overrides.pop(get_current_user, None)
