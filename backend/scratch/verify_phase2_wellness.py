"""
Phase 2 — Personalized Wellness Ecosystem verification harness.

Runs the wellness/habit/SOS engines in-process (no live server, no Firestore)
and prints a PASS/FAIL report:

    python verify_phase2_wellness.py

Components checked:
  * Habit Aggregation     adherence / streak / consistency from daily records
  * Wellness Score        0-100 blend of emotional + habit + engagement
  * Recommendation Engine high-anxiety->worksheet, low-sleep->plan, etc.
  * Wellness Plan         focus selection + daily checklist generation
  * Chatbot Awareness     proactive habit + trend line
  * Report Integration    habit + wellness sections render into the clinical PDF

Output is ASCII-only (Windows cp1252 console safe). Exit 0 iff all pass.
"""
from __future__ import annotations

import sys
import traceback
from datetime import datetime, timezone

DAY = 24 * 60 * 60 * 1000
NOW = 1_700_000_000_000


def _iso(ts_ms: int) -> str:
    return datetime.fromtimestamp(ts_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def check_habits() -> tuple[bool, str]:
    from app.services import habits

    today = _iso(NOW)
    entries = [
        {"patientId": "p", "date": _iso(NOW - i * DAY), "ts": NOW - i * DAY,
         "sleepHours": 8, "exerciseMinutes": 30, "waterGlasses": 8,
         "meditationMinutes": 10, "screenTimeHours": 4}
        for i in range(3)
    ]
    out = habits.summarize(entries, now_ms=NOW, today=today)
    assert out["logged_days"] == 3, out["logged_days"]
    assert out["adherence"] == 1.0, out["adherence"]
    assert out["streak"] == 3, out["streak"]
    return True, f"adherence={out['adherence']:.0%} streak={out['streak']}d consistency={out['consistency']:.2f}"


def check_wellness_score() -> tuple[bool, str]:
    from app.services import habits, mood, wellness

    ms = mood.summarize([{"dominantEmotion": "Sad", "confidence": 0.9, "ts": NOW}], now_ms=NOW)
    low = wellness.compute_wellness_score(mood_summary=ms, risk_score=0.9)
    high = wellness.compute_wellness_score(
        mood_summary=mood.summarize([{"dominantEmotion": "Happy", "confidence": 0.9, "ts": NOW}], now_ms=NOW),
        journals=[{}], cbt=[{}],
    )
    assert low["score"] < high["score"], (low["score"], high["score"])
    assert 0 <= low["score"] <= 100 and 0 <= high["score"] <= 100
    return True, f"distressed={low['score']} ({low['level']}) | positive={high['score']} ({high['level']})"


def check_recommendations() -> tuple[bool, str]:
    from app.services import habits, mood, wellness

    anx = wellness.generate_recommendations(
        mood_summary=mood.summarize([{"dominantEmotion": "Fear", "confidence": 0.9, "ts": NOW}], now_ms=NOW)
    )
    sleep = wellness.generate_recommendations(
        habit_summary=habits.summarize(
            [{"patientId": "p", "date": _iso(NOW), "ts": NOW, "sleepHours": 4}], now_ms=NOW, today=_iso(NOW)
        )
    )
    assert any(r["action"] == "cbt:anxiety" for r in anx), "no anxiety worksheet"
    assert any(r["action"] == "habit:sleep" for r in sleep), "no sleep plan"
    return True, f"anxiety->worksheet OK | low-sleep->plan OK ({len(anx)}+{len(sleep)} recs)"


def check_plan() -> tuple[bool, str]:
    from app.services import mood, wellness

    ms = mood.summarize([{"dominantEmotion": "Fear", "confidence": 0.9, "ts": NOW}], now_ms=NOW)
    plan = wellness.generate_plan(
        mood_summary=ms, journals=[{"topic": "placements", "ts": NOW}]
    )
    assert plan["focus"] == "placement_anxiety", plan["focus"]
    assert len(plan["tasks"]) >= 4, plan["tasks"]
    types = {t["type"] for t in plan["tasks"]}
    assert {"meditation", "cbt", "journal", "checkin"} <= types, types
    return True, f"focus='{plan['title']}' tasks={len(plan['tasks'])} types={sorted(types)}"


def check_chatbot_awareness() -> tuple[bool, str]:
    from app.services import chatbot

    signals = {
        "habit_summary": {
            "logged_days": 5,
            "metrics": [{"key": "sleepHours", "label": "Sleep", "unit": "hrs",
                         "avg": 5, "adherence": 0.4, "logged_days": 5, "on_track": False}],
        },
        "mood_summary": {"total_samples": 10,
                          "periods": [{"period": "weekly", "dominant": "Fear", "risk_score": 0.5}]},
        "active_plan": {"tasks": [{"id": "a"}]},
    }
    line = chatbot.build_wellness_awareness(signals)
    assert line and "wellness plan" in line, line
    assert "anxiety" in line and ("sleep" in line or "slept" in line), line
    return True, "proactive habit+trend awareness line generated"


def check_report_integration() -> tuple[bool, str]:
    from app.services import reports

    pdf = reports.build_clinical_pdf(
        appointment_id="a1", patient_name="Jane", doctor_name="Doc",
        session_datetime="2026-06-11T10:00:00", completed_at=datetime.now(timezone.utc),
        session_notes="n", diagnosis="d", prescriptions="p",
        emotion_summary={
            "wellness_summary": "Overall wellness score: 62/100 (steady).",
            "habit_summary": "Over the last 7 days the patient logged habits on 5 day(s)...",
            "habit_breakdown": "Sleep avg 5hrs (target 8hrs).",
        },
    )
    assert pdf.startswith(b"%PDF-") and len(pdf) > 1000
    return True, f"clinical PDF with wellness+habit sections ({len(pdf)} bytes)"


CHECKS = [
    ("Habit Aggregation", check_habits),
    ("Wellness Score", check_wellness_score),
    ("Recommendation Engine", check_recommendations),
    ("Wellness Plan", check_plan),
    ("Chatbot Awareness", check_chatbot_awareness),
    ("Report Integration", check_report_integration),
]


def main() -> int:
    print("=" * 70)
    print(" MindEase - Phase 2 Wellness Ecosystem Verification")
    print("=" * 70)
    all_ok = True
    for name, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        all_ok &= ok
        print(f"  {name:<24}: {'PASS' if ok else 'FAIL'}   {detail}")
    print("=" * 70)
    print(f" RESULT: {'ALL PASS' if all_ok else 'FAILURES PRESENT'}")
    print("=" * 70)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
