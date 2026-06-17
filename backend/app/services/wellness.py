"""
Personalized wellness engine (Phase 2).

Pure, dependency-free logic that fuses every MindEase signal a patient produces —
mood/emotion history, journal patterns, CBT activity, habit adherence, and the
crisis/risk score — into three things:

  * a **wellness score** (0–100) with sub-component breakdown,
  * a ranked list of **AI recommendations** (the rule-based recommendation
    engine), and
  * a **personalized wellness plan** — a focus area plus a daily checklist.

Kept IO-free so it's unit-testable and reusable by the API layer, the chatbot
(awareness), the clinical report, and the doctor dashboard. The frontend
``lib/wellness.js`` mirrors this exactly so client-side generation and the
backend tell the same story.

Signal contract (all optional; degrade gracefully):
    mood_summary   -> output of app.services.mood.summarize(...)
    habit_summary  -> output of app.services.habits.summarize(...)
    journals       -> list[ {topic, emotion, ts, ...} ]
    cbt            -> list[ {type, ts, ...} ]
    risk_score     -> float in [0,1]  (fused crisis/distress, higher = worse)
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field

# Negative-affect emotion buckets (both NLP and facial spellings collapse here).
_NEGATIVE = {"Sad", "Fear", "Angry", "sadness", "fear", "anger"}


# ---------------------------------------------------------------------------
# Recommendation catalogue
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class Recommendation:
    id: str
    title: str
    detail: str
    category: str          # "cbt" | "habit" | "meditation" | "journal" | "clinical"
    action: str            # machine-routable hint (e.g. "cbt:anxiety", "habit:sleep")
    priority: int          # 1 = highest
    why: str = ""          # explainability tag: which signal drove this rec

    def as_dict(self) -> dict:
        return {
            "id": self.id,
            "title": self.title,
            "detail": self.detail,
            "category": self.category,
            "action": self.action,
            "priority": self.priority,
            "why": self.why,
        }


# Canonicalise an NLP/facial affect label to a lowercase bucket.
_AFFECT_CANON = {
    "fear": "fear", "Fear": "fear",
    "sadness": "sadness", "Sad": "sadness", "sad": "sadness",
    "anger": "anger", "Angry": "anger", "angry": "anger",
}


def _canon_affect(label: str | None) -> str | None:
    return _AFFECT_CANON.get(label) if label else None


def _persistent_sadness(mood_summary: dict | None) -> bool:
    """True when 'Sad' dominates two or more multi-day windows (weekly/monthly)."""
    if not mood_summary:
        return False
    windows = sum(
        1
        for p in mood_summary.get("periods", [])
        if p.get("dominant") == "Sad" and p.get("period") in ("weekly", "monthly")
    )
    return windows >= 2


def _dominant_recent_emotion(mood_summary: dict | None) -> str | None:
    if not mood_summary:
        return None
    latest = mood_summary.get("latest") or {}
    if latest.get("dominantEmotion"):
        return latest["dominantEmotion"]
    periods = {p["period"]: p for p in mood_summary.get("periods", [])}
    for name in ("weekly", "monthly", "daily"):
        dom = periods.get(name, {}).get("dominant")
        if dom:
            return dom
    return None


def _emotional_risk(mood_summary: dict | None) -> float:
    """Highest windowed mood risk score in [0,1] (0 when no data)."""
    if not mood_summary:
        return 0.0
    return max(
        (p.get("risk_score", 0.0) for p in mood_summary.get("periods", [])),
        default=0.0,
    )


def _journal_topic_counts(journals: list[dict] | None) -> Counter:
    counts: Counter = Counter()
    for j in journals or []:
        topic = j.get("topic")
        if topic and topic != "general":
            counts[topic] += 1
    return counts


def generate_recommendations(
    *,
    mood_summary: dict | None = None,
    habit_summary: dict | None = None,
    journals: list[dict] | None = None,
    cbt: list[dict] | None = None,
    risk_score: float = 0.0,
    facial_distress: float = 0.0,
    sentiment: str | None = None,
    plan_adherence: dict | None = None,
    prev_recommendations: list[str] | None = None,
) -> list[dict]:
    """
    Multi-signal AI recommendation engine. Returns a priority-sorted list of
    recommendation dicts derived from the live signals. Examples encoded:

        High Anxiety        -> Anxiety Worksheet
        Low Sleep           -> Sleep Wellness Plan
        High Stress         -> Meditation Recommendation
        Low Exercise        -> Activity Recommendation
        Repeated Sadness    -> Doctor consultation
        Low plan adherence  -> Simplified daily goal

    Beyond the mood/habit/journal/CBT/risk signals, the engine also fuses the
    live ``facial_distress`` (browser FER+) and NLP ``sentiment`` so anxiety /
    stress guidance can surface even before any mood history exists, factors in
    ``plan_adherence`` to simplify goals when a patient is struggling to keep up,
    and uses ``prev_recommendations`` (ids surfaced recently) to avoid repeating
    the same non-clinical nudge day after day. Every rec carries a ``why`` tag
    naming the signal that produced it, so the UI can explain itself.
    """
    recs: list[Recommendation] = []
    emotion = _dominant_recent_emotion(mood_summary)
    emo_risk = _emotional_risk(mood_summary)
    fused_risk = max(float(risk_score or 0.0), emo_risk)
    topics = _journal_topic_counts(journals)
    sent = _canon_affect(sentiment)
    facial = float(facial_distress or 0.0)

    # --- Emotional signals -------------------------------------------------
    if emotion in ("Fear",) or (emotion == "Angry" and emo_risk >= 0.4):
        recs.append(Recommendation(
            "anxiety-worksheet",
            "Work through an Anxiety Worksheet",
            "Your recent check-ins show anxious feelings. Mapping the trigger and a "
            "coping plan can steady racing thoughts.",
            "cbt", "cbt:anxiety", 1, why="mood:fear",
        ))
    if emotion == "Sad" or emo_risk >= 0.6:
        recs.append(Recommendation(
            "thought-reframing",
            "Try Thought Reframing",
            "Things have felt heavy lately. Identifying cognitive distortions can "
            "help reframe negative thoughts.",
            "cbt", "cbt:reframing", 1, why="mood:sadness",
        ))
    if emotion == "Angry":
        recs.append(Recommendation(
            "stress-worksheet",
            "Separate what you can control",
            "Frustration builds up fast. A stress worksheet helps you act on what's "
            "in your control and let go of what isn't.",
            "cbt", "cbt:stress", 2, why="mood:anger",
        ))

    # --- Facial + NLP sentiment fusion (fires without any mood history) ----
    if sent == "fear" or facial >= 0.6:
        recs.append(Recommendation(
            "anxiety-worksheet",
            "Work through an Anxiety Worksheet",
            "How you've been expressing yourself reads as anxious. Mapping the "
            "trigger and a coping plan can steady racing thoughts.",
            "cbt", "cbt:anxiety", 1, why="fusion:facial_sentiment",
        ))
    if sent == "sadness":
        recs.append(Recommendation(
            "thought-reframing",
            "Try Thought Reframing",
            "Your recent messages have felt low. Identifying cognitive distortions "
            "can help reframe heavy thoughts.",
            "cbt", "cbt:reframing", 1, why="sentiment:sadness",
        ))
    if sent == "anger":
        recs.append(Recommendation(
            "stress-worksheet",
            "Separate what you can control",
            "There's been some frustration in how you've been feeling. A stress "
            "worksheet helps you focus on what's in your control.",
            "cbt", "cbt:stress", 2, why="sentiment:anger",
        ))

    # --- Habit signals -----------------------------------------------------
    if habit_summary:
        for m in habit_summary.get("metrics", []):
            if m["logged_days"] == 0:
                continue
            if m["key"] == "sleepHours" and m["adherence"] < 0.7:
                recs.append(Recommendation(
                    "sleep-plan",
                    "Improve your sleep routine",
                    f"You're averaging {m['avg']} {m['unit']} of sleep (target {m['target']}). "
                    "A consistent wind-down routine can help.",
                    "habit", "habit:sleep", 1, why="habit:sleep",
                ))
            elif m["key"] == "exerciseMinutes" and m["adherence"] < 0.6:
                recs.append(Recommendation(
                    "activity-plan",
                    "Add some movement to your day",
                    f"Exercise is averaging {m['avg']} {m['unit']} (target {m['target']}). "
                    "Even a 10-minute walk lifts mood and reduces stress.",
                    "habit", "habit:exercise", 2, why="habit:exercise",
                ))
            elif m["key"] == "screenTimeHours" and m["adherence"] < 0.6:
                recs.append(Recommendation(
                    "screen-plan",
                    "Set a screen-time boundary",
                    f"Screen time is averaging {m['avg']} {m['unit']} (target ≤ {m['target']}). "
                    "A nightly cut-off protects your sleep and focus.",
                    "habit", "habit:screen", 3, why="habit:screen",
                ))
            elif m["key"] == "meditationMinutes" and m["adherence"] < 0.5:
                recs.append(Recommendation(
                    "meditation-habit",
                    "Build a short meditation habit",
                    "A few minutes of guided breathing daily compounds into real calm.",
                    "meditation", "meditation", 3, why="habit:meditation",
                ))

    # --- Stress / topic signals -------------------------------------------
    if topics:
        top_topic, _ = topics.most_common(1)[0]
        recs.append(Recommendation(
            "meditation-stress",
            "Take a guided breathing break",
            f"Your journal keeps returning to {top_topic}. A 5-minute breathing reset "
            "on the Meditation page can ease that pressure.",
            "meditation", "meditation", 2, why=f"journal:{top_topic}",
        ))

    # --- Plan / habit adherence: simplify goals when struggling to keep up --
    pa_ratio = (plan_adherence or {}).get("ratio")
    pa_total = (plan_adherence or {}).get("total", 0)
    habit_adh = (habit_summary or {}).get("adherence")
    habit_days = (habit_summary or {}).get("logged_days", 0)
    low_plan = pa_ratio is not None and pa_total > 0 and pa_ratio < 0.4
    low_habit = habit_adh is not None and habit_days > 0 and habit_adh < 0.4
    if low_plan or low_habit:
        recs.append(Recommendation(
            "simplify-goals",
            "Simplify today to one small win",
            "Your plan has felt hard to keep up with lately. Let's shrink it to a "
            "single, doable goal — steady momentum beats an overloaded checklist.",
            "habit", "simplify", 2, why="adherence:low",
        ))

    # --- CBT completion -> reinforcing follow-up (shapes future guidance) --
    if cbt:
        latest = cbt[0] if isinstance(cbt, (list, tuple)) and cbt else {}
        ctype = (latest or {}).get("type")
        recs.append(Recommendation(
            "cbt-followup",
            "Build on your last exercise",
            "You recently completed a CBT exercise — revisiting it helps the skill "
            "stick. Want to take the next step today?",
            "cbt", f"cbt:{ctype}" if ctype else "cbt:reframing", 3, why="cbt:completion",
        ))

    # --- Engagement nudges -------------------------------------------------
    if not cbt:
        recs.append(Recommendation(
            "start-cbt",
            "Try your first CBT exercise",
            "CBT worksheets give you practical tools to handle tough thoughts. Pick "
            "one that fits how you feel today.",
            "cbt", "cbt:reframing", 4, why="engagement:no_cbt",
        ))
    if not journals:
        recs.append(Recommendation(
            "start-journal",
            "Write a journal reflection",
            "Putting feelings into words helps you spot patterns over time.",
            "journal", "journal", 4, why="engagement:no_journal",
        ))

    # --- Clinical escalation ----------------------------------------------
    if _persistent_sadness(mood_summary):
        recs.append(Recommendation(
            "talk-to-doctor-sadness",
            "Repeated low mood — consider a check-in with a doctor",
            "Sadness has shown up across several weeks. Talking with a professional "
            "can help you understand what's underneath it and find a way forward.",
            "clinical", "doctor", 1, why="mood:persistent_sadness",
        ))
    if fused_risk >= 0.6:
        recs.insert(0, Recommendation(
            "book-doctor",
            "Consider talking to a professional",
            "Your recent signals suggest it may help to speak with a doctor. You can "
            "book a secure consultation through the Portal whenever you're ready.",
            "clinical", "doctor", 1, why="risk:high",
        ))

    # Deduplicate by id (keep highest priority), then sort.
    best: dict[str, Recommendation] = {}
    for r in recs:
        if r.id not in best or r.priority < best[r.id].priority:
            best[r.id] = r
    ordered = sorted(best.values(), key=lambda r: (r.priority, r.id))

    # Memory: drop non-clinical recs the patient has already seen recently, so the
    # list refreshes instead of repeating — but never suppress a clinical
    # escalation, and never return an empty list just because everything was seen.
    prev = set(prev_recommendations or [])
    if prev:
        fresh = [r for r in ordered if r.category == "clinical" or r.id not in prev]
        if fresh:
            ordered = fresh

    return [r.as_dict() for r in ordered]


# ---------------------------------------------------------------------------
# Wellness score
# ---------------------------------------------------------------------------
def compute_wellness_score(
    *,
    mood_summary: dict | None = None,
    habit_summary: dict | None = None,
    journals: list[dict] | None = None,
    cbt: list[dict] | None = None,
    risk_score: float = 0.0,
) -> dict:
    """
    Blend the signals into a 0–100 wellness score with a component breakdown:

      * emotional (40%) — inverse of the fused emotional/crisis risk
      * habit      (40%) — habit adherence (neutral 50 when nothing logged)
      * engagement (20%) — journals + CBT activity, capped

    Returns { score, level, components: {emotional, habit, engagement}, has_data }.
    """
    emo_risk = max(float(risk_score or 0.0), _emotional_risk(mood_summary))
    has_mood = bool(mood_summary and mood_summary.get("total_samples"))
    emotional = round((1.0 - emo_risk) * 100) if has_mood else 60

    has_habits = bool(habit_summary and habit_summary.get("logged_days"))
    habit = round(habit_summary["adherence"] * 100) if has_habits else 50

    n_journal = len(journals or [])
    n_cbt = len(cbt or [])
    engagement = min(100, n_journal * 8 + n_cbt * 12)

    score = round(0.4 * emotional + 0.4 * habit + 0.2 * engagement)
    score = max(0, min(100, score))

    return {
        "score": score,
        "level": score_level(score),
        "components": {
            "emotional": emotional,
            "habit": habit,
            "engagement": engagement,
        },
        "has_data": has_mood or has_habits or bool(n_journal or n_cbt),
    }


def score_level(score: float) -> str:
    if score >= 75:
        return "thriving"
    if score >= 55:
        return "steady"
    if score >= 35:
        return "struggling"
    return "needs_support"


# ---------------------------------------------------------------------------
# Personalized wellness plan
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class PlanTask:
    id: str
    label: str
    type: str          # "meditation" | "cbt" | "journal" | "habit" | "checkin"
    action: str        # routable hint

    def as_dict(self) -> dict:
        return {"id": self.id, "label": self.label, "type": self.type, "action": self.action}


@dataclass(frozen=True)
class FocusSpec:
    key: str
    title: str
    tasks: tuple[PlanTask, ...]


# A small library of focus areas. The engine picks the best-matching focus from
# the live signals; the daily tasks blend meditation, CBT, journaling and a
# check-in (matching the spec's "Placement Anxiety" example).
def _focus_library() -> dict[str, FocusSpec]:
    checkin = PlanTask("evening-checkin", "Evening Check-In with Rahat", "checkin", "chat")
    journal = PlanTask("journal-reflection", "Journal Reflection", "journal", "journal")
    meditate = PlanTask("meditation-5min", "5-Minute Meditation", "meditation", "meditation")
    return {
        "anxiety": FocusSpec(
            "anxiety", "Managing Anxiety",
            (meditate, PlanTask("anxiety-worksheet", "Anxiety Worksheet", "cbt", "cbt:anxiety"),
             journal, checkin),
        ),
        "placement_anxiety": FocusSpec(
            "placement_anxiety", "Placement Anxiety",
            (meditate, PlanTask("anxiety-worksheet", "Anxiety Worksheet", "cbt", "cbt:anxiety"),
             journal, checkin),
        ),
        "low_mood": FocusSpec(
            "low_mood", "Lifting Low Mood",
            (PlanTask("reframing-worksheet", "Thought Reframing Worksheet", "cbt", "cbt:reframing"),
             PlanTask("gratitude-exercise", "Gratitude Exercise", "cbt", "cbt:gratitude"),
             journal, checkin),
        ),
        "stress": FocusSpec(
            "stress", "Reducing Stress",
            (meditate, PlanTask("stress-worksheet", "Stress Worksheet", "cbt", "cbt:stress"),
             journal, checkin),
        ),
        "sleep": FocusSpec(
            "sleep", "Better Sleep",
            (PlanTask("sleep-habit", "Log your sleep", "habit", "habit:sleep"),
             meditate,
             PlanTask("screen-habit", "Wind down — limit screen time", "habit", "habit:screen"),
             checkin),
        ),
        "balance": FocusSpec(
            "balance", "Building Daily Balance",
            (meditate, journal,
             PlanTask("exercise-habit", "Move your body for 30 min", "habit", "habit:exercise"),
             checkin),
        ),
    }


# Journal topics that read as placement/career anxiety in the product taxonomy.
_PLACEMENT_TOPICS = {"placements", "career", "job", "internship", "exams", "studies"}


def _pick_focus(
    *,
    mood_summary: dict | None,
    habit_summary: dict | None,
    journals: list[dict] | None,
    risk_score: float,
) -> str:
    emotion = _dominant_recent_emotion(mood_summary)
    emo_risk = max(float(risk_score or 0.0), _emotional_risk(mood_summary))
    topics = _journal_topic_counts(journals)

    # Anxiety driven by placement/career topics gets the named focus from the spec.
    placement_weight = sum(topics.get(t, 0) for t in _PLACEMENT_TOPICS)
    if emotion == "Fear" and placement_weight > 0:
        return "placement_anxiety"
    if emotion == "Fear":
        return "anxiety"
    if emotion == "Sad" or emo_risk >= 0.6:
        return "low_mood"

    # Habit-driven: poor sleep adherence steers the plan toward sleep.
    if habit_summary:
        for m in habit_summary.get("metrics", []):
            if m["key"] == "sleepHours" and m["logged_days"] > 0 and m["adherence"] < 0.6:
                return "sleep"
    if emotion == "Angry" or placement_weight > 0:
        return "stress"
    return "balance"


def generate_plan(
    *,
    mood_summary: dict | None = None,
    habit_summary: dict | None = None,
    journals: list[dict] | None = None,
    cbt: list[dict] | None = None,
    risk_score: float = 0.0,
) -> dict:
    """
    Generate a personalized wellness plan: a focus area + a daily task checklist,
    chosen from the live signals. The returned ``tasks`` carry ``done: False`` so
    the client can track per-day completion.

    Returns:
        { focus, title, tasks: [ {id,label,type,action,done} ], signals: {...} }
    """
    focus_key = _pick_focus(
        mood_summary=mood_summary,
        habit_summary=habit_summary,
        journals=journals,
        risk_score=risk_score,
    )
    spec = _focus_library()[focus_key]
    emotion = _dominant_recent_emotion(mood_summary)
    emo_risk = max(float(risk_score or 0.0), _emotional_risk(mood_summary))

    return {
        "focus": focus_key,
        "title": spec.title,
        "tasks": [{**t.as_dict(), "done": False} for t in spec.tasks],
        "signals": {
            "dominant_emotion": emotion,
            "risk_score": round(emo_risk, 4),
            "journal_count": len(journals or []),
            "cbt_count": len(cbt or []),
            "habit_adherence": (habit_summary or {}).get("adherence", 0.0),
        },
    }
