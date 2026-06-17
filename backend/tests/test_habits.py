"""
Habit-tracking aggregation tests (pure, offline).
"""
from app.services import habits

DAY = 24 * 60 * 60 * 1000
NOW = 1_700_000_000_000  # fixed "now"


def _iso(ts_ms: int) -> str:
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def _entry(age_days, **metrics):
    ts = NOW - age_days * DAY
    return {"patientId": "p1", "date": _iso(ts), "ts": ts, **metrics}


TODAY = _iso(NOW)


def test_empty_history():
    out = habits.summarize([], now_ms=NOW, today=TODAY)
    assert out["logged_days"] == 0
    assert out["adherence"] == 0.0
    assert out["streak"] == 0
    assert out["consistency"] == 0.0
    assert {m["key"] for m in out["metrics"]} == set(habits.HABIT_KEYS)


def test_metric_adherence_higher_is_better():
    spec = habits._SPEC_BY_KEY["sleepHours"]  # target 8, higher better
    assert habits.metric_adherence(spec, 8) == 1.0
    assert habits.metric_adherence(spec, 4) == 0.5
    assert habits.metric_adherence(spec, 10) == 1.0  # capped
    assert habits.metric_adherence(spec, None) is None


def test_metric_adherence_lower_is_better():
    spec = habits._SPEC_BY_KEY["screenTimeHours"]  # target 6, lower better
    assert habits.metric_adherence(spec, 6) == 1.0
    assert habits.metric_adherence(spec, 3) == 1.0
    assert habits.metric_adherence(spec, 9) == 0.5     # 50% over -> 0.5
    assert habits.metric_adherence(spec, 12) == 0.0    # 100% over -> 0


def test_adherence_and_consistency():
    entries = [
        _entry(0, sleepHours=8, exerciseMinutes=30, waterGlasses=8, meditationMinutes=10, screenTimeHours=5),
        _entry(1, sleepHours=8, exerciseMinutes=30, waterGlasses=8, meditationMinutes=10, screenTimeHours=5),
    ]
    out = habits.summarize(entries, now_ms=NOW, window_days=7, today=TODAY)
    assert out["logged_days"] == 2
    assert out["adherence"] == 1.0          # all metrics at/above target
    assert out["consistency"] == round(2 / 7, 4)
    assert out["streak"] == 2               # today + yesterday


def test_streak_breaks_on_gap():
    entries = [
        _entry(0, sleepHours=7),
        _entry(1, sleepHours=7),
        _entry(3, sleepHours=7),  # gap at day 2 -> streak stops at 2
    ]
    out = habits.summarize(entries, now_ms=NOW, today=TODAY)
    assert out["streak"] == 2


def test_streak_survives_unlogged_today():
    # Logged yesterday + 2 days ago, nothing today -> streak still counts (2).
    entries = [_entry(1, sleepHours=7), _entry(2, sleepHours=7)]
    out = habits.summarize(entries, now_ms=NOW, today=TODAY)
    assert out["streak"] == 2


def test_last_write_wins_per_day():
    same_day = _iso(NOW)
    entries = [
        {"patientId": "p1", "date": same_day, "ts": NOW - 1000, "sleepHours": 4},
        {"patientId": "p1", "date": same_day, "ts": NOW, "sleepHours": 8},
    ]
    out = habits.summarize(entries, now_ms=NOW, today=TODAY)
    assert out["logged_days"] == 1
    sleep = next(m for m in out["metrics"] if m["key"] == "sleepHours")
    assert sleep["avg"] == 8.0  # later write wins


def test_unlogged_metric_does_not_zero_adherence():
    # Only sleep logged, at target. Adherence should reflect sleep (1.0), not be
    # dragged down by the other four unlogged metrics.
    out = habits.summarize([_entry(0, sleepHours=8)], now_ms=NOW, today=TODAY)
    assert out["adherence"] == 1.0


def test_report_summary_prose():
    entries = [_entry(0, sleepHours=5, exerciseMinutes=10)]
    rep = habits.habit_report_summary(entries, now_ms=NOW)
    assert rep is not None
    assert "adherence" in rep["habit_summary"]
    assert "Sleep" in rep["habit_breakdown"]
    assert 0 <= rep["habit_score"] <= 100


def test_report_summary_empty():
    assert habits.habit_report_summary([], now_ms=NOW) is None
