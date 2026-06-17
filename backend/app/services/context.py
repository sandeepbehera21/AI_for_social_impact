"""
Conversation Context Manager for the MindEase chatbot.

The response engine (:mod:`app.services.chatbot`) historically scored every
message in complete isolation — a short answer like *"not good, lot of work"*
to the bot's own question *"How has your day been going so far?"* was treated as
a brand-new utterance, so the engine mis-read it as raw anger instead of
work-driven stress.

This module gives the engine a short conversational memory so it can:

* keep the **last 10 messages** (5 exchanges) per conversation,
* remember ``last_bot_message`` / ``last_user_message`` and a
  ``conversation_state``,
* notice when the user is **answering the bot's previous question** and read
  that answer *relative to the question* rather than as a new isolated intent,
* carry **topics** (exams, work, money, …) across turns, so a later
  *"I'm feeling nervous"* can be linked back to *"I have exams next week."*

It holds no PII beyond the raw message text already exchanged, lives purely in
process memory (nothing persisted), and is fully offline — no LLM, no network.
"""
from __future__ import annotations

import logging
import re
import threading
from collections import deque
from dataclasses import dataclass, field

logger = logging.getLogger("mindease.context")

# How many individual messages (user + bot, interleaved) to retain per chat.
MAX_HISTORY = 20


# ---------------------------------------------------------------------------
# Conversation states
# ---------------------------------------------------------------------------
class ConversationState:
    """The discrete states a MindEase conversation can be in."""

    GREETING = "greeting"
    DAILY_CHECKIN = "daily_checkin"
    STRESS_DISCUSSION = "stress_discussion"
    ANXIETY_DISCUSSION = "anxiety_discussion"
    DOCTOR_BOOKING = "doctor_booking"
    MEDITATION_GUIDANCE = "meditation_guidance"
    CRISIS_INTERVENTION = "crisis_intervention"


STATES: frozenset[str] = frozenset(
    {
        ConversationState.GREETING,
        ConversationState.DAILY_CHECKIN,
        ConversationState.STRESS_DISCUSSION,
        ConversationState.ANXIETY_DISCUSSION,
        ConversationState.DOCTOR_BOOKING,
        ConversationState.MEDITATION_GUIDANCE,
        ConversationState.CRISIS_INTERVENTION,
    }
)

# When the bot's last turn left this tag on the context, the *next* user message
# is read as the answer to an open-ended "how are you?" check-in question.
AWAITING_CHECKIN = "checkin"


# ---------------------------------------------------------------------------
# Topic memory — stressors the user mentions, carried across turns.
# ---------------------------------------------------------------------------
# Each topic: a matching regex plus two ready-to-use surface forms —
#   ``noun``   : sentence-leading, capitalise-able ("work" -> "Work can ...")
#   ``clause`` : drops mid-sentence ("with exams coming up")
_TOPICS: dict[str, dict[str, str]] = {
    "career": {
        "rx": r"\b(?:career|careers|path|direction|vocation)\b",
        "noun": "your career",
        "clause": "your career path on your mind",
    },
    "job": {
        "rx": r"\b(?:job|jobs|work|office|boss|workload|employment|deadline|deadlines|meeting|meetings|overtime)\b",
        "noun": "your job",
        "clause": "challenges at your job",
    },
    "internship": {
        "rx": r"\b(?:internship|internships|intern|interns)\b",
        "noun": "your internship",
        "clause": "your internship search on your mind",
    },
    "exams": {
        "rx": r"\b(?:exam|exams|test|tests|final|finals|midterm|midterms|paper|papers)\b",
        "noun": "exams",
        "clause": "exams coming up",
    },
    "placements": {
        "rx": r"\b(?:placement|placements|recruit|recruitment|interview|interviews)\b",
        "noun": "placements",
        "clause": "placement interviews on your mind",
    },
    "studies": {
        "rx": r"\b(?:study|studying|studies|assignment|assignments|homework|coursework|class|classes|college|university)\b",
        "noun": "your studies",
        "clause": "your studies piling up",
    },
    "family": {
        "rx": r"\b(?:family|parents?|mother|father|mom|mommy|dad|daddy|brother|sister|sibling|siblings)\b",
        "noun": "family issues",
        "clause": "things with your family",
    },
    "relationships": {
        "rx": r"\b(?:relationship|relationships|partner|boyfriend|girlfriend|spouse|breakup|divorce|marriage|wife|husband|dating|cheat\w*|trust|faithful|betray\w*)\b",
        "noun": "relationship strains",
        "clause": "strains in your relationship",
    },
    "health": {
        "rx": r"\b(?:health|sick|illness|ill|pain|diagnosis|hospital|medication|body|physical|disease)\b",
        "noun": "your health",
        "clause": "your health on your mind",
    },
    "finances": {
        "rx": r"\b(?:finance|finances|financial|money|rent|bills?|debt|loan|loans|expenses|salary|broke)\b",
        "noun": "finances",
        "clause": "financial stress on your mind",
    },
    "loneliness": {
        "rx": r"\b(?:lonely|loneliness|alone|isolated|no friends|isolation|solitary)\b",
        "noun": "loneliness",
        "clause": "feeling isolated and alone",
    },
    "addiction": {
        "rx": r"\b(?:addict|addiction|substance|alcohol|drinking|smoke|smoking|drug|drugs|gambl\w*)\b",
        "noun": "addiction challenges",
        "clause": "struggling with addiction",
    },
    # --- Expanded MindEase topics (appended last so the established topics above
    #     always win their keywords first — extract_topic returns the FIRST match,
    #     keeping existing multi-turn continuity intact). Each regex is scoped to
    #     vocabulary that does NOT overlap the topics above. ---------------------
    "sleep": {
        "rx": r"\b(?:sleep|sleeping|asleep|insomnia|insomniac|awake|nightmares?|"
              r"restless nights?|can'?t sleep|cant sleep|sleepless|tired all|"
              r"exhausted from|no rest|oversleep\w*)\b",
        "noun": "your sleep",
        "clause": "your sleep being disrupted",
    },
    "social": {
        "rx": r"\b(?:social anxiety|socially anxious|social situations?|crowds?|"
              r"parties|party|public speaking|judged|being judged|awkward around|"
              r"shy|small talk|meeting new people|fear of people)\b",
        "noun": "social situations",
        "clause": "social situations feeling overwhelming",
    },
    "panic": {
        "rx": r"\b(?:panic attacks?|panic attack|hyperventilat\w*|heart racing|"
              r"can'?t breathe|cant breathe|chest tightness|panic disorder)\b",
        "noun": "panic attacks",
        "clause": "panic attacks taking hold",
    },
    "grief": {
        "rx": r"\b(?:grief|grieving|bereave\w*|mourning|passed away|passing away|"
              r"lost my|losing someone|death of|funeral|loss of a)\b",
        "noun": "your grief",
        "clause": "grief weighing on you",
    },
    "self_esteem": {
        "rx": r"\b(?:self esteem|self-esteem|self worth|self-worth|worthless|"
              r"hate myself|not good enough|not enough|inadequate|insecure about myself|"
              r"low confidence|no confidence|hate the way i)\b",
        "noun": "your self-esteem",
        "clause": "your self-esteem taking a hit",
    },
    "motivation": {
        "rx": r"\b(?:motivation|motivated|unmotivated|demotivated|procrastinat\w*|"
              r"no energy to|can'?t get started|cant get started|no drive|"
              r"lost interest|don'?t feel like doing|pointless to)\b",
        "noun": "your motivation",
        "clause": "your motivation running low",
    },
    "burnout": {
        "rx": r"\b(?:burnout|burnt out|burned out|running on empty|completely drained|"
              r"emotionally drained|nothing left to give)\b",
        "noun": "burnout",
        "clause": "burnout catching up with you",
    },
}
_TOPIC_RE: dict[str, re.Pattern[str]] = {
    name: re.compile(spec["rx"], re.I) for name, spec in _TOPICS.items()
}
_CHANGE_TOPIC_RE = re.compile(
    r"\b(?:change (?:the )?topic|talk about something else|different subject|"
    r"another topic|enough about (?:this|that)|new topic|different topic|never mind|nevermind)\b",
    re.I
)

# Polarity of a short check-in answer. Negative is tested first so that
# "not good" / "not great" resolve to negative rather than matching "good".
_NEGATIVE_ANSWER_RE = re.compile(
    r"\b(?:not (?:good|great|well|fine|ok|okay|the best|so good|too good)|"
    r"bad|terrible|awful|horrible|rough|tough|hard|stressful|exhaust\w*|drained|"
    r"overwhelm\w*|sad|down|low|miserable|worst|crap|rubbish|not really|nope|"
    r"struggling|stressed|anxious|nervous|worried|scared|angry|upset)\b",
    re.I,
)
_POSITIVE_ANSWER_RE = re.compile(
    r"\b(?:good|great|fine|ok|okay|well|better|fantastic|amazing|wonderful|"
    r"happy|glad|relaxed|calm|alright|all right|pretty good|not bad|grand)\b",
    re.I,
)


def extract_topic(message: str) -> str | None:
    """Return the first stressor topic mentioned in *message*, or ``None``."""
    text = message or ""
    if _CHANGE_TOPIC_RE.search(text):
        return "clear_topic"
    for name, pattern in _TOPIC_RE.items():
        if pattern.search(text):
            return name
    return None


def topic_noun(topic: str | None) -> str | None:
    spec = _TOPICS.get(topic or "")
    return spec["noun"] if spec else None


def topic_clause(topic: str | None) -> str | None:
    spec = _TOPICS.get(topic or "")
    return spec["clause"] if spec else None


def answer_polarity(message: str) -> str:
    """Classify a short answer as ``"negative"`` / ``"positive"`` / ``"neutral"``."""
    text = message or ""
    if _NEGATIVE_ANSWER_RE.search(text):
        return "negative"
    if _POSITIVE_ANSWER_RE.search(text):
        return "positive"
    return "neutral"


# ---------------------------------------------------------------------------
# Per-conversation state
# ---------------------------------------------------------------------------
@dataclass
class Turn:
    """A single message in the conversation history."""

    role: str           # "user" | "bot"
    text: str
    intent: str | None = None
    emotion: str | None = None


@dataclass
class ConversationContext:
    """Short-term memory for one conversation (one socket / one session id)."""

    session_id: str = "default"
    owner_id: str | None = None
    history: deque[Turn] = field(default_factory=lambda: deque(maxlen=MAX_HISTORY))
    state: str = ConversationState.GREETING
    last_user_message: str | None = None
    last_bot_message: str | None = None
    # What kind of answer (if any) the bot's last turn is waiting for.
    awaiting: str | None = None
    # Stressor topics seen so far, oldest -> newest (deduped to most-recent).
    topics: list[str] = field(default_factory=list)

    # New fields for production upgrade
    named_entities: dict[str, str] = field(default_factory=dict)
    topic_first_seen: dict[str, float] = field(default_factory=dict)
    last_openings: list[str] = field(default_factory=list)

    # -- recording ----------------------------------------------------------
    def record_user(self, text: str, intent: str | None, emotion: str | None) -> None:
        self.history.append(Turn("user", text, intent=intent, emotion=emotion))
        self.last_user_message = text
        topic = extract_topic(text)
        if topic == "clear_topic":
            self.topics.clear()
            self.topic_first_seen.clear()
        elif topic:
            self.add_topic(topic)
            if topic not in self.topic_first_seen:
                import time
                self.topic_first_seen[topic] = time.time()
        self._extract_entities(text)

    def _extract_entities(self, text: str) -> None:
        """Rule-based extraction of entity names from user input."""
        import re
        exam_match = re.search(
            r"\b(\w+)\s+(?:exam|exams|test|tests|midterm|midterms|final|finals)\b",
            text,
            re.I,
        )
        if exam_match:
            self.named_entities["exam_subject"] = exam_match.group(1).lower()

        rel_match = re.search(
            r"\bmy\s+(boss|manager|partner|boyfriend|girlfriend|husband|wife|mom|dad|mother|father|brother|sister|friend)\b",
            text,
            re.I,
        )
        if rel_match:
            self.named_entities["relationship_entity"] = rel_match.group(1).lower()

    def record_bot(self, text: str, state: str, awaiting: str | None = None) -> None:
        self.history.append(Turn("bot", text))
        self.last_bot_message = text
        if state in STATES:
            self.state = state
        # The bot's new turn defines what (if anything) we now await.
        self.awaiting = awaiting

        # Track opening (first 25 characters) to prevent repetition
        opening = text[:25].strip().lower()
        self.last_openings.append(opening)
        if len(self.last_openings) > 3:
            self.last_openings.pop(0)

        # Generate summary after 10+ turns
        self.generate_summary()

    def generate_summary(self) -> None:
        """Generate a short 1-line summary of topics discussed in the last turns."""
        if len(self.history) < 10 or not self.topics:
            return
        unique_topics = []
        for t in self.topics:
            noun = topic_noun(t)
            if noun and noun not in unique_topics:
                unique_topics.append(noun)
        if unique_topics:
            topics_str = ", ".join(unique_topics)
            self.named_entities["conversation_summary"] = f"We have been discussing {topics_str}."

    # -- topics -------------------------------------------------------------
    def add_topic(self, topic: str) -> None:
        """Record a topic as the most-recent one (no duplicates)."""
        if topic in self.topics:
            self.topics.remove(topic)
        self.topics.append(topic)

    def recent_topic(self) -> str | None:
        return self.topics[-1] if self.topics else None

    # -- inspection ---------------------------------------------------------
    @property
    def conversation_history(self) -> list[dict]:
        """History as plain dicts (handy for logging / tests / serialization)."""
        return [
            {"role": t.role, "text": t.text, "intent": t.intent, "emotion": t.emotion}
            for t in self.history
        ]

    def to_dict(self) -> dict:
        """Serialize context for Firestore persistence."""
        return {
            "session_id": self.session_id,
            "owner_id": self.owner_id,
            "state": self.state,
            "last_user_message": self.last_user_message,
            "last_bot_message": self.last_bot_message,
            "awaiting": self.awaiting,
            "topics": list(self.topics),
            "named_entities": dict(self.named_entities),
            "topic_first_seen": dict(self.topic_first_seen),
            "last_openings": list(self.last_openings),
            "history": [
                {
                    "role": t.role,
                    "text": t.text,
                    "intent": t.intent,
                    "emotion": t.emotion,
                }
                for t in self.history
            ],
        }

    @classmethod
    def from_dict(cls, data: dict) -> ConversationContext:
        """Deserialize context from Firestore document dictionary."""
        ctx = cls(
            session_id=data.get("session_id", "default"),
            owner_id=data.get("owner_id"),
            state=data.get("state", ConversationState.GREETING),
            last_user_message=data.get("last_user_message"),
            last_bot_message=data.get("last_bot_message"),
            awaiting=data.get("awaiting"),
            topics=list(data.get("topics", [])),
            named_entities=dict(data.get("named_entities", {})),
            topic_first_seen=dict(data.get("topic_first_seen", {})),
            last_openings=list(data.get("last_openings", [])),
        )
        ctx.history.clear()
        for turn_data in data.get("history", []):
            ctx.history.append(
                Turn(
                    role=turn_data.get("role", "user"),
                    text=turn_data.get("text", ""),
                    intent=turn_data.get("intent"),
                    emotion=turn_data.get("emotion"),
                )
            )
        return ctx

    def reset(self) -> None:
        self.history.clear()
        self.state = ConversationState.GREETING
        self.last_user_message = None
        self.last_bot_message = None
        self.awaiting = None
        self.topics.clear()
        self.named_entities.clear()
        self.topic_first_seen.clear()
        self.last_openings.clear()


# ---------------------------------------------------------------------------
# Registry of conversations
# ---------------------------------------------------------------------------
class ContextManager:
    """Registry of :class:`ConversationContext` keyed by session id.
    RAM acts as a fast write-back cache; misses are loaded from Firestore.
    """

    def __init__(self) -> None:
        self._sessions: dict[str, ConversationContext] = {}
        self._lock = threading.Lock()

    def get(self, session_id: str, owner_id: str | None = None) -> ConversationContext:
        """Return context for *session_id*, checking Firestore if absent in RAM."""
        with self._lock:
            ctx = self._sessions.get(session_id)
            if ctx is not None:
                if ctx.owner_id is not None and ctx.owner_id != owner_id:
                    raise PermissionError("Unauthorized access to session context")
                if ctx.owner_id is None and owner_id is not None:
                    ctx.owner_id = owner_id
                return ctx

            # RAM miss: attempt to load from Firestore
            try:
                from app.services import firebase
                if firebase.is_configured():
                    db = firebase.firestore_client()
                    doc_ref = db.collection("chatbot_contexts").document(session_id).get()
                    if doc_ref.exists:
                        ctx = ConversationContext.from_dict(doc_ref.to_dict() or {})
                        if ctx.owner_id is not None and ctx.owner_id != owner_id:
                            raise PermissionError("Unauthorized access to session context")
                        if ctx.owner_id is None and owner_id is not None:
                            ctx.owner_id = owner_id
                        self._sessions[session_id] = ctx
                        logger.info("Chat context loaded from Firestore for session %s", session_id)
                        return ctx
            except PermissionError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to load chat context from Firestore for %s: %s", session_id, exc)

            # Creating fresh context if not found in db or db errors
            ctx = ConversationContext(session_id=session_id, owner_id=owner_id)
            self._sessions[session_id] = ctx
            return ctx

    def save(self, ctx: ConversationContext) -> None:
        """Save context back to Firestore asynchronously/best-effort."""
        session_id = ctx.session_id
        try:
            from app.services import firebase
            if firebase.is_configured():
                db = firebase.firestore_client()
                db.collection("chatbot_contexts").document(session_id).set(ctx.to_dict())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to save chat context to Firestore for %s: %s", session_id, exc)

    def reset(self, session_id: str) -> None:
        with self._lock:
            self._sessions.pop(session_id, None)
            try:
                from app.services import firebase
                if firebase.is_configured():
                    db = firebase.firestore_client()
                    db.collection("chatbot_contexts").document(session_id).delete()
            except Exception as exc:  # noqa: BLE001
                logger.warning("Failed to delete chat context in Firestore for %s: %s", session_id, exc)

    def __len__(self) -> int:  # pragma: no cover - trivial
        return len(self._sessions)


# Module-level singleton for the stateless REST path (keyed by client session id).
manager = ContextManager()
