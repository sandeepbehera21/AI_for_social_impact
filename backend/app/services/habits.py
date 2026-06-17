"""
Habit-tracking aggregation (Phase 2).

Pure, dependency-free functions that turn a list of daily habit records into
adherence scores, streaks, and consistency metrics. Kept free of any
Firestore/IO so it is trivially unit-testable; the API layer reads the raw
records via the Admin SDK and hands them here, and the wellness engine reuses
the same summariser. Mirrors :mod:`app.services.mood` in spirit and is kept in
lock-step with the frontend ``lib/habits.js`` (same targets, same scoring).

A habit record is a plain dict, one per patient per day:
    {
      "patientId": "...",
      "date": "2026-06-11",          # local YYYY-MM-DD (the canonical key)
      "sleepHours": 7.5,
      "exerciseMinutes": 30,
      "waterGlasses": 8,
      "meditationMinutes": 10,
      "screenTimeHours": 5,
      "ts": 1718000000000,            # client epoch-ms (ordering/windowing)
    }
Any missing metric is treated as "not logged" (None), never as zero, so an
unlogged day doesn't drag an adherence score down to 0.
"""
from __future__ import annotations

from dataclasses import dataclass

_DAY_MS = 24 * 60 * 60 * 1000

# Canonical habit metrics, their daily target, and the direction that counts as
# "good". ``higher_is_better=False`` means we want to stay *at or below* target
# (screen time). Targets are evidence-informed defaults, not medical advice.
@dataclass(frozen=True)
class HabitSpec:
    key: str
    label: str
    unit: str
    target: float
    higher_is_better: bool


HABITS: tuple[HabitSpec, ...] = (
    HabitSpec("sleepHours", "Sleep", "hrs", 8.0, True),
    HabitSpec("exerciseMinutes", "Exercise", "min", 30.0, True),
    HabitSpec("waterGlasses", "Water", "glasses", 8.0, True),
    HabitSpec("meditationMinutes", "Meditation", "min", 10.0, True),
    HabitSpec("screenTimeHours", "Screen Time", "hrs", 6.0, False),
)
HABIT_KEYS: tuple[str, ...] = tuple(h.key for h in HABITS)
_SPEC_BY_KEY: dict[str, HabitSpec] = {h.key: h for h in HABITS}

# Default analysis window (days) for adherence + consistency.
DEFAULT_WINDOW_DAYS = 7


def _num(value) -> float | None:
    """Coerce a logged metric to a non-negative float, or None when absent."""
    if value is None or value == "":
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return max(0.0, v)


def metric_adherence(spec: HabitSpec, value: float | None) -> float | None:
    """
    Per-metric adherence in [0, 1] for a single day's logged value.

    For "higher is better" metrics the ratio value/target is capped at 1.0. For
    "lower is better" (screen time) full credit at/under target, decaying to 0
    at twice the target. Returns None when the metric wasn't logged that day.
    """
    if value is None:
        return None
    if spec.target <= 0:
        return 1.0
    if spec.higher_is_better:
        return round(min(1.0, value / spec.target), 4)
    # Lower-is-better: 1.0 at/below target, linear down to 0 at 2x target.
    if value <= spec.target:
        return 1.0
    over = (value - spec.target) / spec.target
    return round(max(0.0, 1.0 - over), 4)


def _day_records(entries: list[dict]) -> dict[str, dict]:
    """Collapse to the latest record per ``date`` key (last write wins)."""
    by_date: dict[str, dict] = {}
    for e in entries:
        date = e.get("date")
        if not date:
            continue
        prev = by_date.get(date)
        if prev is None or e.get("ts", 0) >= prev.get("ts", 0):
            by_date[date] = e
    return by_date


def _streak(dates: set[str], today: str | None) -> int:
    """
    Count consecutive days (ending today or yesterday) that have a record.

    ``today`` is the local YYYY-MM-DD anchor. A streak survives if the user has
    logged today *or* yesterday (so the streak doesn't visually "break" simply
    because they haven't logged yet today).
    """
    if not dates:
        return 0
    from datetime import date as _date, timedelta

    def parse(d: str):
        try:
            y, m, dd = (int(x) for x in d.split("-"))
            return _date(y, m, dd)
        except (ValueError, AttributeError):
            return None

    anchor = parse(today) if today else None
    if anchor is None:
        # Fall back to the most recent logged date.
        parsed = sorted(filter(None, (parse(d) for d in dates)))
        if not parsed:
            return 0
        anchor = parsed[-1]

    parsed_dates = set(filter(None, (parse(d) for d in dates)))
    # Allow the streak to anchor on today or yesterday.
    cursor = anchor
    if cursor not in parsed_dates:
        cursor = anchor - timedelta(days=1)
        if cursor not in parsed_dates:
            return 0
    streak = 0
    while cursor in parsed_dates:
        streak += 1
        cursor = cursor - timedelta(days=1)
    return streak


def summarize(
    entries: list[dict],
    *,
    now_ms: int,
    window_days: int = DEFAULT_WINDOW_DAYS,
    today: str | None = None,
) -> dict:
    """
    Build the full habit summary from raw daily records.

    Returns:
        {
          "logged_days": int,                 # days with at least one metric
          "window_days": int,
          "adherence": float,                 # 0..1 overall, across the window
          "streak": int,                      # consecutive logged days
          "consistency": float,               # 0..1 = logged_days / window_days
          "today": { metric: value | None },  # today's logged values
          "metrics": [                         # per-metric breakdown
            { key, label, unit, target, higher_is_better,
              avg, adherence, logged_days, latest, on_track }
          ],
        }
    """
    window_days = max(1, int(window_days))
    cutoff = now_ms - window_days * _DAY_MS
    by_date = _day_records(entries)

    in_window = [r for r in by_date.values() if r.get("ts", 0) >= cutoff]
    logged_days = len(in_window)

    metrics = []
    metric_adh_values: list[float] = []
    for spec in HABITS:
        vals = [_num(r.get(spec.key)) for r in in_window]
        present = [v for v in vals if v is not None]
        adh = [metric_adherence(spec, v) for v in present]
        adh = [a for a in adh if a is not None]
        avg = round(sum(present) / len(present), 2) if present else 0.0
        m_adherence = round(sum(adh) / len(adh), 4) if adh else 0.0
        if adh:
            metric_adh_values.append(m_adherence)

        # Latest logged value for this metric (most recent date overall).
        latest = None
        for r in sorted(by_date.values(), key=lambda x: x.get("ts", 0), reverse=True):
            v = _num(r.get(spec.key))
            if v is not None:
                latest = v
                break

        metrics.append(
            {
                "key": spec.key,
                "label": spec.label,
                "unit": spec.unit,
                "target": spec.target,
                "higher_is_better": spec.higher_is_better,
                "avg": avg,
                "adherence": m_adherence,
                "logged_days": len(present),
                "latest": latest,
                "on_track": m_adherence >= 0.7,
            }
        )

    overall = round(sum(metric_adh_values) / len(metric_adh_values), 4) if metric_adh_values else 0.0
    consistency = round(min(1.0, logged_days / window_days), 4)
    streak = _streak(set(by_date.keys()), today)

    # Today's logged snapshot.
    today_rec = by_date.get(today) if today else None
    today_values = {
        spec.key: (_num(today_rec.get(spec.key)) if today_rec else None) for spec in HABITS
    }

    return {
        "logged_days": logged_days,
        "window_days": window_days,
        "adherence": overall,
        "streak": streak,
        "consistency": consistency,
        "today": today_values,
        "metrics": metrics,
    }


def habit_report_summary(entries: list[dict], *, now_ms: int) -> dict | None:
    """
    Condense habit history into short prose blocks for the clinical PDF / session
    report. Returns ``None`` when nothing has been logged.
    """
    summary = summarize(entries, now_ms=now_ms, window_days=DEFAULT_WINDOW_DAYS)
    if summary["logged_days"] == 0:
        return None

    parts = []
    for m in summary["metrics"]:
        if m["logged_days"] == 0:
            continue
        unit = m["unit"]
        parts.append(f"{m['label']} avg {m['avg']}{unit} (target {m['target']}{unit})")
    if not parts:
        return None

    return {
        "habit_summary": (
            f"Over the last {summary['window_days']} days the patient logged habits on "
            f"{summary['logged_days']} day(s) with an overall adherence of "
            f"{round(summary['adherence'] * 100)}% (current streak {summary['streak']} day(s))."
        ),
        "habit_breakdown": "; ".join(parts) + ".",
        "habit_score": round(summary["adherence"] * 100),
    }
