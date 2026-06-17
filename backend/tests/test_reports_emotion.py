"""
Unit tests for clinical session PDF report emotion summaries.
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.api.clinical import _patient_emotion_summary
from app.services import reports


def test_patient_emotion_summary_with_mocked_firestore():
    # Mock firebase client, queries, and return values
    mock_db = MagicMock()
    import time
    now_ms = int(time.time() * 1000)
    mock_doc1 = MagicMock()
    mock_doc1.to_dict.return_value = {
        "patientId": "p-1",
        "dominantEmotion": "Sad",
        "confidence": 0.8,
        "ts": now_ms - 60000,
    }
    mock_doc2 = MagicMock()
    mock_doc2.to_dict.return_value = {
        "patientId": "p-1",
        "dominantEmotion": "Sad",
        "confidence": 0.9,
        "ts": now_ms - 30000,
    }
    mock_db.collection.return_value.where.return_value.limit.return_value.get.return_value = [
        mock_doc1,
        mock_doc2,
    ]

    mock_msg1 = MagicMock()
    mock_msg1.to_dict.return_value = {
        "text": "I feel really down and lonely today.",
        "senderId": "p-1",
    }
    mock_msg2 = MagicMock()
    mock_msg2.to_dict.return_value = {
        "text": "Yes, it is very hard to handle.",
        "senderId": "p-1",
    }
    
    # Customize mock chain for messages collection
    mock_db.collection.return_value.document.return_value.collection.return_value.get.return_value = [
        mock_msg1,
        mock_msg2,
    ]

    with patch("app.services.firebase.firestore_client", return_value=mock_db):
        summary = _patient_emotion_summary("appt-1", "p-1")
        
        assert summary is not None
        assert "facial_summary" in summary
        assert "patterns" in summary
        assert "risk_summary" in summary
        assert "text_summary" in summary
        assert "Sad" in summary["facial_summary"]
        assert "SADNESS" in summary["text_summary"]


def test_pdf_generation_with_emotion_summary():
    completed_at = datetime.now(timezone.utc)
    emotion_summary = {
        "text_summary": "Across 2 clinical chat messages, the patient's dominant text sentiment was SADNESS (average confidence 85%).",
        "facial_summary": "Across 10 on-device facial-emotion samples, the patient's dominant expression was Sad (average confidence 78%).",
        "patterns": "Sad 80%, Neutral 20%",
        "risk_summary": "Emotional-risk indicator: HIGH (score 0.80).",
    }
    
    pdf_bytes = reports.build_clinical_pdf(
        appointment_id="appt-1",
        patient_name="Jane Doe",
        doctor_name="Attending",
        session_datetime="2026-06-11T10:00:00",
        completed_at=completed_at,
        session_notes="Patient is feeling sad.",
        diagnosis="Anxiety",
        prescriptions="Mindfulness",
        public_key_fingerprint="abcdef",
        emotion_summary=emotion_summary,
    )
    
    assert pdf_bytes.startswith(b"%PDF-")
    assert len(pdf_bytes) > 1000
