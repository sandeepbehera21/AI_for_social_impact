"""
Mood-history aggregation tests (pure, offline) + report emotion section.
"""
from datetime import datetime, timezone

from app.services import mood, reports

DAY = 24 * 60 * 60 * 1000
NOW = 1_700_000_000_000  # fixed "now" for deterministic windowing


def _sample(emotion, conf, age_days):
    return {"dominantEmotion": emotion, "confidence": conf, "ts": NOW - age_days * DAY}


def test_summarize_empty_history():
    out = mood.summarize([], now_ms=NOW)
    assert out["total_samples"] == 0
    assert out["latest"] is None
    assert {p["period"] for p in out["periods"]} == {"daily", "weekly", "monthly"}
    assert all(p["samples"] == 0 for p in out["periods"])


def test_windows_partition_by_age():
    entries = [
        _sample("Happy", 0.9, 0),    # today
        _sample("Sad", 0.8, 0),      # today
        _sample("Sad", 0.7, 3),      # this week (not today)
        _sample("Fear", 0.6, 20),    # this month (not week)
        _sample("Happy", 0.5, 60),   # outside all windows
    ]
    out = mood.summarize(entries, now_ms=NOW)
    by = {p["period"]: p for p in out["periods"]}
    assert by["daily"]["samples"] == 2
    assert by["weekly"]["samples"] == 3
    assert by["monthly"]["samples"] == 4  # 60-day-old sample excluded
    assert out["total_samples"] == 5


def test_dominant_and_distribution():
    entries = [_sample("Sad", 0.8, 0) for _ in range(3)] + [_sample("Happy", 0.9, 0)]
    daily = next(p for p in mood.summarize(entries, now_ms=NOW)["periods"] if p["period"] == "daily")
    assert daily["dominant"] == "Sad"
    assert daily["distribution"]["Sad"] == 0.75
    assert daily["distribution"]["Happy"] == 0.25


def test_risk_level_rises_with_distress():
    sad = [_sample("Sad", 0.9, 0) for _ in range(5)]
    happy = [_sample("Happy", 0.9, 0) for _ in range(5)]
    sad_daily = next(p for p in mood.summarize(sad, now_ms=NOW)["periods"] if p["period"] == "daily")
    happy_daily = next(p for p in mood.summarize(happy, now_ms=NOW)["periods"] if p["period"] == "daily")
    assert sad_daily["risk_level"] == "high"
    assert happy_daily["risk_level"] == "low"
    assert sad_daily["risk_score"] > happy_daily["risk_score"]


def test_canonicalises_nlp_style_labels():
    out = mood.summarize([{"dominantEmotion": "sadness", "confidence": 0.7, "ts": NOW}], now_ms=NOW)
    assert out["latest"]["dominantEmotion"] == "Sad"


def test_latest_is_the_most_recent_sample():
    entries = [_sample("Happy", 0.9, 5), _sample("Fear", 0.6, 0), _sample("Sad", 0.8, 2)]
    assert mood.summarize(entries, now_ms=NOW)["latest"]["dominantEmotion"] == "Fear"


# ---------------------------------------------------------------------------
# Report emotion summary + PDF rendering
# ---------------------------------------------------------------------------
def test_report_emotion_summary_none_when_empty():
    assert mood.report_emotion_summary([], now_ms=NOW) is None


def test_report_emotion_summary_has_prose_blocks():
    entries = [_sample("Sad", 0.8, 1) for _ in range(4)] + [_sample("Fear", 0.7, 2)]
    summ = mood.report_emotion_summary(entries, now_ms=NOW)
    assert summ is not None
    assert "Sad" in summ["facial_summary"]
    assert summ["patterns"]  # non-empty distribution string
    assert "risk" in summ["risk_summary"].lower()


def test_clinical_pdf_builds_with_and_without_emotion_section():
    common = dict(
        appointment_id="appt-1",
        patient_name="Pat",
        doctor_name="Who",
        session_datetime="2026-06-10T09:00:00Z",
        completed_at=datetime(2026, 6, 10, 9, 30, tzinfo=timezone.utc),
        session_notes="notes",
        diagnosis="dx",
        prescriptions="rx",
        public_key_fingerprint="abc123",
    )
    plain = reports.build_clinical_pdf(**common)
    with_emotion = reports.build_clinical_pdf(
        **common,
        emotion_summary={
            "text_summary": "Mostly low mood in chat.",
            "facial_summary": "Dominant expression was Sad (avg confidence 78%).",
            "patterns": "Sad 60%, Fear 20%, Neutral 20%",
            "risk_summary": "Emotional-risk indicator: ELEVATED (score 0.50).",
        },
    )
    assert plain[:5] == b"%PDF-"
    assert with_emotion[:5] == b"%PDF-"
    # The extra section makes the document larger.
    assert len(with_emotion) > len(plain)
