"""
Patient signal loader (Phase 2).

A single place that reads a patient's Phase 1 + Phase 2 data from Firestore (via
the Admin SDK) and assembles the aggregated "signals" the wellness engine, the
chatbot, the clinical report, and the doctor dashboard all consume. Centralising
the reads here keeps the query logic (and the in-memory sort that avoids
composite-index requirements) in one tested place instead of copy-pasted across
callers.

Everything is best-effort and degrades gracefully: if Firebase Admin isn't
configured, or a collection is empty, the corresponding signal is simply absent
so callers can fall back to their offline behaviour.
"""
from __future__ import annotations

import logging
import time

from google.cloud.firestore_v1.base_query import FieldFilter
from google.cloud.firestore_v1.query import Query

from app.services import firebase, habits, mood, wellness

logger = logging.getLogger("mindease.patient_data")

_MAX = 2000


def _recent(db, collection: str, patient_id: str, limit: int | None = None) -> list[dict]:
    q = (
        db.collection(collection)
        .where(filter=FieldFilter("patientId", "==", patient_id))
        .order_by("ts", direction=Query.DESCENDING)
    )
    if limit is not None:
        q = q.limit(limit)
    else:
        q = q.limit(_MAX)

    try:
        docs = q.stream()
        return [d.to_dict() or {} for d in docs]
    except Exception as exc:
        logger.warning(
            "Server-side sort failed on %s for patient %s, falling back to local sort: %s",
            collection,
            patient_id,
            exc,
        )
        docs = (
            db.collection(collection)
            .where(filter=FieldFilter("patientId", "==", patient_id))
            .limit(_MAX)
            .stream()
        )
        rows = [d.to_dict() or {} for d in docs]
        rows.sort(key=lambda x: x.get("ts", 0), reverse=True)
        return rows[:limit] if limit else rows


def load_signals(patient_id: str, *, now_ms: int | None = None) -> dict:
    """
    Load and aggregate every wellness signal for ``patient_id``.

    Returns a dict with (any subset, depending on what exists):
        {
          "mood_summary": {...} | None,
          "habit_summary": {...} | None,
          "journals": [...],
          "cbt": [...],
          "active_plan": {...} | None,
          "crisis_events": [...],
          "risk_score": float,
        }
    Never raises — returns ``{}``-ish empty signals on any failure.
    """
    if now_ms is None:
        now_ms = int(time.time() * 1000)

    empty = {
        "mood_summary": None,
        "habit_summary": None,
        "journals": [],
        "cbt": [],
        "active_plan": None,
        "crisis_events": [],
        "risk_score": 0.0,
        "profile": {},
        "recommendation_history": [],
        "prev_recommendation_ids": [],
        "plan_adherence": None,
    }
    if not patient_id or not firebase.is_configured():
        return empty

    try:
        db = firebase.firestore_client()

        user_snap = db.collection("users").document(patient_id).get()
        user_profile = user_snap.to_dict() if user_snap.exists else {}

        mood_rows = _recent(db, "mood_entries", patient_id)
        mood_summary = mood.summarize(mood_rows, now_ms=now_ms) if mood_rows else None

        habit_rows = _recent(db, "habit_entries", patient_id)
        habit_summary = habits.summarize(habit_rows, now_ms=now_ms) if habit_rows else None

        journals = _recent(db, "journals", patient_id)
        cbt = _recent(db, "cbt_exercises", patient_id)

        # Latest active wellness plan, if one has been generated.
        plan_rows = _recent(db, "wellness_plans", patient_id)
        active_plan = next((p for p in plan_rows if p.get("active", True)), None)
        if active_plan is None and plan_rows:
            active_plan = plan_rows[0]

        crisis_events = _recent(db, "crisis_events", patient_id, limit=50)

        risk_score = wellness._emotional_risk(mood_summary) if mood_summary else 0.0

        # Recent recommendation snapshots (newest first) feed the "previous
        # recommendations" memory so the engine doesn't repeat the same nudge.
        rec_history = _recent(db, "recommendations", patient_id, limit=14)
        prev_ids: list[str] = []
        seen: set[str] = set()
        for snap in rec_history:
            for item in snap.get("items", []) or []:
                rid = item.get("id") if isinstance(item, dict) else None
                if rid and rid not in seen:
                    seen.add(rid)
                    prev_ids.append(rid)

        adherence = plan_adherence(active_plan)

        return {
            "mood_summary": mood_summary,
            "habit_summary": habit_summary,
            "journals": journals,
            "cbt": cbt,
            "active_plan": active_plan,
            "crisis_events": crisis_events,
            "risk_score": risk_score,
            "profile": user_profile,
            "recommendation_history": rec_history,
            "prev_recommendation_ids": prev_ids,
            "plan_adherence": adherence,
        }
    except Exception as exc:  # noqa: BLE001
        logger.warning("Failed to load patient signals for %s: %s", patient_id, exc)
        return empty


def plan_adherence(active_plan: dict | None) -> dict | None:
    """
    Compute today's completion ratio for an active plan, reading the per-day
    ``progress`` map the client maintains: ``progress[YYYY-MM-DD] = [taskId, ...]``.
    Returns ``{ total, completed, ratio, date }`` for the most recent recorded
    day, or ``None`` when there's no plan.
    """
    if not active_plan:
        return None
    tasks = active_plan.get("tasks") or []
    total = len(tasks)
    if total == 0:
        return None
    progress = active_plan.get("progress") or {}
    # Most recent day that has any recorded completions.
    latest_date = max(progress.keys()) if progress else None
    completed_ids = set(progress.get(latest_date, [])) if latest_date else set()
    valid_ids = {t.get("id") for t in tasks}
    completed = len(completed_ids & valid_ids)
    return {
        "total": total,
        "completed": completed,
        "ratio": round(completed / total, 4) if total else 0.0,
        "date": latest_date,
    }
