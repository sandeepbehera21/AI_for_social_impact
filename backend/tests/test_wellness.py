"""
Wellness engine tests (pure, offline): score, recommendations, plan generation.
"""
from app.services import habits, mood, wellness

DAY = 24 * 60 * 60 * 1000
NOW = 1_700_000_000_000


def _mood(emotion, conf, age_days):
    return {"dominantEmotion": emotion, "confidence": conf, "ts": NOW - age_days * DAY}


def _mood_summary(samples):
    return mood.summarize(samples, now_ms=NOW)


def _iso(ts_ms):
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _habit_summary(records):
    return habits.summarize(records, now_ms=NOW, today=_iso(NOW))


# ---- Wellness score ------------------------------------------------------
def test_score_no_data_is_neutralish():
    out = wellness.compute_wellness_score()
    assert 0 <= out["score"] <= 100
    assert out["has_data"] is False
    assert set(out["components"]) == {"emotional", "habit", "engagement"}


def test_score_high_when_positive_and_adherent():
    ms = _mood_summary([_mood("Happy", 0.9, 0), _mood("Happy", 0.8, 1)])
    hs = _habit_summary([
        {"patientId": "p", "date": _iso(NOW), "ts": NOW,
         "sleepHours": 8, "exerciseMinutes": 30, "waterGlasses": 8,
         "meditationMinutes": 10, "screenTimeHours": 4},
    ])
    out = wellness.compute_wellness_score(
        mood_summary=ms, habit_summary=hs, journals=[{}], cbt=[{}]
    )
    assert out["score"] >= 70
    assert out["level"] in ("steady", "thriving")
    assert out["has_data"] is True


def test_score_low_when_high_risk():
    ms = _mood_summary([_mood("Sad", 0.9, 0), _mood("Fear", 0.9, 0)])
    out = wellness.compute_wellness_score(mood_summary=ms, risk_score=0.9)
    assert out["score"] <= 45
    assert out["components"]["emotional"] <= 30


# ---- Recommendation engine ----------------------------------------------
def test_high_anxiety_recommends_anxiety_worksheet():
    ms = _mood_summary([_mood("Fear", 0.9, 0)])
    recs = wellness.generate_recommendations(mood_summary=ms)
    assert any(r["action"] == "cbt:anxiety" for r in recs)


def test_low_sleep_recommends_sleep_plan():
    hs = _habit_summary([
        {"patientId": "p", "date": _iso(NOW), "ts": NOW, "sleepHours": 4},
    ])
    recs = wellness.generate_recommendations(habit_summary=hs)
    assert any(r["action"] == "habit:sleep" for r in recs)


def test_low_exercise_recommends_activity():
    hs = _habit_summary([
        {"patientId": "p", "date": _iso(NOW), "ts": NOW, "exerciseMinutes": 0},
    ])
    recs = wellness.generate_recommendations(habit_summary=hs)
    assert any(r["action"] == "habit:exercise" for r in recs)


def test_high_risk_inserts_clinical_first():
    ms = _mood_summary([_mood("Sad", 0.95, 0)])
    recs = wellness.generate_recommendations(mood_summary=ms, risk_score=0.8)
    assert recs[0]["category"] == "clinical"


def test_recommendations_are_deduped_and_sorted():
    ms = _mood_summary([_mood("Fear", 0.9, 0)])
    recs = wellness.generate_recommendations(mood_summary=ms)
    ids = [r["id"] for r in recs]
    assert len(ids) == len(set(ids))
    prios = [r["priority"] for r in recs]
    assert prios == sorted(prios)


# ---- Plan generation -----------------------------------------------------
def test_plan_has_daily_tasks():
    plan = wellness.generate_plan()
    assert plan["focus"]
    assert plan["title"]
    assert len(plan["tasks"]) >= 3
    assert all("done" in t and t["done"] is False for t in plan["tasks"])
    # Spec example: a meditation + worksheet + journal + check-in mix.
    types = {t["type"] for t in plan["tasks"]}
    assert "checkin" in types


def test_placement_anxiety_focus():
    ms = _mood_summary([_mood("Fear", 0.9, 0)])
    journals = [{"topic": "placements", "ts": NOW}, {"topic": "career", "ts": NOW}]
    plan = wellness.generate_plan(mood_summary=ms, journals=journals)
    assert plan["focus"] == "placement_anxiety"
    assert plan["title"] == "Placement Anxiety"
    actions = {t["action"] for t in plan["tasks"]}
    assert "cbt:anxiety" in actions
    assert "meditation" in actions


def test_low_mood_focus():
    ms = _mood_summary([_mood("Sad", 0.9, 0)])
    plan = wellness.generate_plan(mood_summary=ms)
    assert plan["focus"] == "low_mood"


def test_sleep_focus_from_habits():
    hs = _habit_summary([
        {"patientId": "p", "date": _iso(NOW), "ts": NOW, "sleepHours": 4},
    ])
    plan = wellness.generate_plan(habit_summary=hs)
    assert plan["focus"] == "sleep"
