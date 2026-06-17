"""
Phase 2 integration tests: chatbot wellness awareness, plan adherence, and the
doctor-facing wellness-summary route wiring.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.services import chatbot, patient_data

client = TestClient(app)


# ---- Chatbot wellness awareness -----------------------------------------
def test_awareness_none_without_signals():
    assert chatbot.build_wellness_awareness(None) is None
    assert chatbot.build_wellness_awareness({}) is None


def test_awareness_surfaces_low_sleep_and_trend():
    signals = {
        "habit_summary": {
            "logged_days": 5,
            "metrics": [
                {"key": "sleepHours", "label": "Sleep", "unit": "hrs", "avg": 5,
                 "adherence": 0.4, "logged_days": 5, "on_track": False},
            ],
        },
        "mood_summary": {
            "total_samples": 10,
            "periods": [
                {"period": "weekly", "dominant": "Fear", "risk_score": 0.5},
            ],
        },
        "active_plan": {"tasks": [{"id": "a"}]},
    }
    line = chatbot.build_wellness_awareness(signals)
    assert line is not None
    assert "slept" in line or "sleep" in line
    assert "anxiety" in line
    assert "review your wellness plan" in line


def test_awareness_offers_to_create_plan_when_none():
    signals = {
        "habit_summary": {
            "logged_days": 3,
            "metrics": [
                {"key": "sleepHours", "label": "Sleep", "unit": "hrs", "avg": 5,
                 "adherence": 0.4, "logged_days": 3, "on_track": False},
            ],
        },
        "mood_summary": None,
        "active_plan": None,
    }
    line = chatbot.build_wellness_awareness(signals)
    assert line is not None
    assert "put together a wellness plan" in line


def test_inject_patient_context_greeting_uses_awareness():
    signals = {
        "habit_summary": {
            "logged_days": 5,
            "metrics": [
                {"key": "sleepHours", "label": "Sleep", "unit": "hrs", "avg": 5,
                 "adherence": 0.3, "logged_days": 5, "on_track": False},
            ],
        },
        "mood_summary": None,
        "active_plan": {"tasks": [{"id": "a"}]},
    }
    out = chatbot.inject_patient_context("Hello!", [], [], "greetings", signals)
    assert "Rahat" in out
    assert "noticed" in out


# ---- Plan adherence ------------------------------------------------------
def test_plan_adherence_none_without_plan():
    assert patient_data.plan_adherence(None) is None
    assert patient_data.plan_adherence({"tasks": []}) is None


def test_plan_adherence_counts_completed():
    plan = {
        "tasks": [{"id": "t1"}, {"id": "t2"}, {"id": "t3"}, {"id": "t4"}],
        "progress": {"2026-06-11": ["t1", "t2"], "2026-06-10": ["t1"]},
    }
    adh = patient_data.plan_adherence(plan)
    assert adh["total"] == 4
    assert adh["completed"] == 2          # latest day (2026-06-11)
    assert adh["ratio"] == 0.5
    assert adh["date"] == "2026-06-11"


def test_plan_adherence_ignores_stale_task_ids():
    plan = {
        "tasks": [{"id": "t1"}, {"id": "t2"}],
        "progress": {"2026-06-11": ["t1", "ghost-task"]},
    }
    adh = patient_data.plan_adherence(plan)
    assert adh["completed"] == 1  # ghost-task isn't a real task


# ---- Route wiring --------------------------------------------------------
def test_wellness_summary_requires_auth():
    # No bearer token -> 401 (route is mounted and gated).
    res = client.get("/api/patients/some-patient/wellness-summary")
    assert res.status_code == 401


def test_health_still_ok():
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json()["status"] == "ok"
