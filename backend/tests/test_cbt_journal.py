"""
Unit tests for the new CBT, Journal Firestore rules context and SessionDetailResponse schemas.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from fastapi import Request
from app.schemas import SessionDetailResponse
from app.api.clinical import get_session


def test_session_detail_response_schema():
    # Verify that the schema is updated and accepts the emotion_summary field
    detail = SessionDetailResponse(
        appointment_id="appt-1",
        patient_name="Jane",
        doctor_name="Attending",
        status="completed",
        session_notes="Notes",
        diagnosis="Diagnosis",
        prescriptions="Prescriptions",
        completed_at=datetime.now(timezone.utc).isoformat(),
        has_report=True,
        emotion_summary={
            "text_summary": "Dominant text sentiment: SADNESS",
            "facial_summary": "Dominant facial emotion: Sad",
            "patterns": "Sad 100%",
            "risk_summary": "Risk indicator: HIGH",
        }
    )
    assert detail.emotion_summary is not None
    assert "text_summary" in detail.emotion_summary
    assert detail.emotion_summary["text_summary"] == "Dominant text sentiment: SADNESS"


@patch("app.api.clinical._load_appointment")
@patch("app.api.clinical._authorise_party")
@patch("app.api.clinical.crypto.decrypt_fields")
@patch("app.api.clinical._patient_emotion_summary")
@patch("app.services.firebase.firestore_client")
def test_get_session_endpoint(
    mock_firestore,
    mock_emotion_summary,
    mock_decrypt_fields,
    mock_authorise,
    mock_load_appt
):
    # Setup mocks
    mock_load_appt.return_value = (None, {
        "doctorId": "doc-1",
        "patientId": "patient-1",
        "patientName": "Jane",
        "doctorName": "Attending",
        "status": "completed",
        "pdfSha256": "hash",
        "completedAt": "2026-06-11T12:00:00",
        "reportPdfEnc": "sealed_data"
    })
    mock_decrypt_fields.return_value = {
        "sessionNotes": "Decrypted Notes",
        "diagnosis": "Decrypted Diagnosis",
        "prescriptions": "Decrypted Prescriptions",
    }
    mock_emotion_summary.return_value = {
        "text_summary": "Sample text summary",
        "facial_summary": "Sample facial summary",
    }
    
    # Mock doctor user profile lookup
    mock_doc_profile = MagicMock()
    mock_doc_profile.exists = True
    mock_doc_profile.to_dict.return_value = {"publicKey": "doc_pub_key"}
    mock_firestore.return_value.collection.return_value.document.return_value.get.return_value = mock_doc_profile

    # Execute endpoint code with mock dependencies
    mock_user = MagicMock()
    mock_user.uid = "doc-1"
    
    mock_request = MagicMock(spec=Request)
    mock_request.client = MagicMock()
    mock_request.client.host = "127.0.0.1"
    
    result = get_session(request=mock_request, appointment_id="appt-1", user=mock_user)
    
    assert result.appointment_id == "appt-1"
    assert result.session_notes == "Decrypted Notes"
    assert result.emotion_summary is not None
    assert result.emotion_summary["text_summary"] == "Sample text summary"
    assert result.public_key == "doc_pub_key"
