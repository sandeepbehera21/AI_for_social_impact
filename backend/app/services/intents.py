"""
Local intent-detection engine for the MindEase chatbot.

Pure-Python, zero external dependencies, fully offline. Each supported intent
owns a small set of weighted regex patterns (covering both keywords and richer
phrasings). ``detect_intent`` scores every intent against a message, picks the
strongest, and returns it with a calibrated confidence in [0, 1] — or ``None``
when nothing clears the ``MIN_CONFIDENCE`` floor (the caller then falls back to
a purely emotion-driven reply).

Design notes
------------
* Patterns are compiled once at import. Each pattern is counted **at most once**
  per message, so a word repeated ten times can't dominate the score — what
  matters is how many *distinct* signals corroborate an intent.
* Confidence saturates: ``min(1, raw / SATURATION)``. A single strong keyword is
  suggestive; several corroborating ones approach certainty.
* "Conversational" intents (greetings / gratitude / help) are anchored or kept
  tight so they don't swallow longer emotional messages that merely contain a
  polite word.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

# A raw weighted score of this much (or more) maps to full confidence (1.0).
SATURATION = 1.5
# Intents scoring below this confidence are treated as "no clear intent".
MIN_CONFIDENCE = 0.30


@dataclass(frozen=True)
class IntentMatch:
    """The winning intent for a message."""
    name: str
    confidence: float
    matched: list[str] = field(default_factory=list)  # human-readable hit labels


# ---------------------------------------------------------------------------
# Intent taxonomy
# ---------------------------------------------------------------------------
# Each entry: intent name -> list of (regex, weight, label). Weights are rough
# evidence strengths: a precise multi-word phrase outweighs a single fuzzy stem.
# Patterns are matched case-insensitively against the lowercased message.
_INTENT_PATTERNS: dict[str, list[tuple[str, float, str]]] = {
    "meditation": [
        (r"meditat", 1.0, "meditation"),
        (r"breath|breathing", 0.9, "breathing"),
        (r"\b(?:relax|calm\s+down|calming|unwind)\b", 0.7, "relax"),
        (r"mindful", 0.8, "mindfulness"),
        (r"guided (?:session|breathing|meditation)", 1.0, "guided session"),
        (r"\b(?:ocean|rain|birds?)\b.*sound|sound.*\b(?:ocean|rain|birds?)\b", 0.8, "ambient sounds"),
        (r"breathing (?:timer|exercise)", 1.0, "breathing timer"),
    ],
    "stress": [
        (r"stress", 1.0, "stress"),
        (r"overwhelm", 0.9, "overwhelmed"),
        (r"burn(?:ed|t)? ?out|burnout", 0.9, "burnout"),
        (r"under pressure|so much pressure|too much (?:to do|going on)", 0.8, "pressure"),
        (r"\btense\b|tension", 0.6, "tension"),
        (r"can'?t cope|cannot cope", 0.8, "not coping"),
    ],
    "anxiety": [
        (r"anxi", 1.0, "anxiety"),
        (r"\bpanic", 0.9, "panic"),
        (r"nervous", 0.7, "nervous"),
        (r"worr(?:y|ied|ying)", 0.7, "worry"),
        (r"on edge|restless|can'?t relax", 0.7, "restless"),
        (r"racing thoughts|heart racing", 0.7, "racing"),
    ],
    "sadness": [
        (r"\bsad\b|sadness", 1.0, "sad"),
        (r"feeling (?:down|low|blue)", 0.9, "down"),
        (r"unhappy|miserable", 0.8, "unhappy"),
        (r"\blonely|alone\b", 0.7, "lonely"),
        (r"\bcry(?:ing)?|tearful|in tears\b", 0.7, "crying"),
        (r"heart ?broken|grief|grieving", 0.8, "grief"),
    ],
    "depression": [
        (r"depress", 1.0, "depression"),
        (r"hopeless", 0.9, "hopeless"),
        (r"\bempty\b|feel nothing|numb", 0.8, "empty/numb"),
        (r"worthless|no point|pointless", 0.8, "worthless"),
        (r"no (?:interest|motivation|energy)", 0.8, "anhedonia"),
        (r"can'?t get out of bed", 0.8, "can't get up"),
    ],
    "fear": [
        (r"\bfear(?:ful)?\b", 1.0, "fear"),
        (r"\bafraid\b|scared|frightened|terrified", 0.9, "scared"),
        (r"\bphobia\b", 0.8, "phobia"),
        (r"\bdread(?:ing)?\b", 0.7, "dread"),
        (r"something bad (?:will|is going to) happen", 0.7, "catastrophizing"),
    ],
    "anger": [
        (r"\banger\b|\bangry\b", 1.0, "anger"),
        (r"\bmad\b|furious|enraged|\brage\b", 0.9, "rage"),
        (r"irritat|annoyed|frustrat", 0.8, "frustration"),
        (r"\bpissed\b|fed up|had enough", 0.8, "fed up"),
        (r"hate (?:this|everything|my)", 0.6, "hate"),
    ],
    "doctor_booking": [
        (r"\bdoctor\b|physician|psychiatrist|therapist|counsel?lor", 1.0, "doctor"),
        (r"(?:see|talk to|speak (?:to|with)|find|book) (?:a |an |my )?(?:doctor|professional|specialist)", 1.1, "see a professional"),
        (r"consult", 0.8, "consultation"),
        (r"\bvideo (?:call|consult|session)\b|agora", 0.8, "video consult"),
        (r"professional (?:help|guidance|support)", 0.7, "professional help"),
        (r"\bportal\b", 0.6, "portal"),
    ],
    "appointment_scheduling": [
        (r"appointment", 1.1, "appointment"),
        (r"\bschedul", 1.0, "schedule"),
        (r"\bbook(?:ing)?\b", 0.8, "book"),
        (r"\bslot\b|time ?slot|available (?:time|slot)s?", 0.8, "slot"),
        (r"reschedul|cancel my (?:appointment|booking)", 0.9, "reschedule/cancel"),
        (r"\bcalendar\b|availability|when can i (?:see|meet|book)", 0.7, "availability"),
    ],
    "reports": [
        (r"\breport\b|reports", 1.0, "report"),
        (r"\bpdf\b|clinical (?:note|summary|report)", 0.9, "clinical pdf"),
        (r"prescription|diagnos", 0.8, "prescription/diagnosis"),
        (r"\bsummary\b|session notes?", 0.7, "summary"),
        (r"download (?:my )?(?:report|pdf|record)|verify (?:the |my )?(?:report|signature)", 0.9, "download/verify"),
        (r"signature|signed (?:report|document)", 0.7, "signature"),
    ],
    "privacy": [
        (r"privacy|private", 1.0, "privacy"),
        (r"confidential", 0.9, "confidential"),
        (r"\bencrypt|encryption\b", 0.8, "encryption"),
        (r"who can see|is (?:my|this) data|where is (?:my|the) data (?:stored|kept)", 0.9, "data access"),
        (r"\bsecure(?:ly)?\b|is it safe", 0.6, "secure"),
        (r"data (?:safe|protect|privacy)", 0.8, "data protection"),
        (r"keep (?:me |us )?safe|\bsafety\b", 0.9, "safety"),
    ],
    "face_tracking": [
        (r"\bcamera\b|webcam", 1.0, "camera"),
        (r"\bface\b|facial|expression", 0.9, "face"),
        (r"emotion (?:track|detect|recogn|analysis)", 1.0, "emotion tracking"),
        (r"\bonnx\b|on[- ]device|in (?:my|the) browser", 0.8, "on-device"),
        (r"track (?:my )?(?:mood|emotion|feeling)s?", 0.7, "mood tracking"),
    ],
    "dashboard": [
        (r"dashboard", 1.1, "dashboard"),
        (r"my (?:progress|history|overview|account)", 0.9, "my progress"),
        (r"mood (?:history|chart|graph|over time)", 0.9, "mood history"),
        (r"\bpatient (?:dashboard|portal)\b", 0.9, "patient dashboard"),
        (r"see (?:my )?(?:past|previous) (?:sessions|consultations)", 0.7, "past sessions"),
    ],
    "greetings": [
        (r"^\s*(?:hi|hii+|hey+|hello+|yo|hiya|heya|sup)\b", 1.0, "hello"),
        (r"^\s*good (?:morning|afternoon|evening|day)\b", 1.0, "good morning"),
        (r"^\s*(?:greetings|howdy|namaste)\b", 0.9, "greetings"),
        (r"how are you|how'?s it going|what'?s up", 0.6, "how are you"),
    ],
    "gratitude": [
        (r"\bthank(?:s| you| u)\b|thx|ty\b", 1.0, "thanks"),
        (r"appreciate (?:it|that|you|this)", 0.9, "appreciate"),
        (r"\bgrateful for (?:your|this|the)\b", 0.8, "grateful"),
        (r"that (?:really )?help(?:ed|s)|you'?re (?:the )?best", 0.7, "that helped"),
    ],
    "help": [
        (r"\bhelp\b(?!less)", 0.9, "help"),
        (r"what can you (?:do|help)|what do you do", 1.0, "what can you do"),
        (r"how (?:do|does) (?:you|this|it) work", 0.9, "how does it work"),
        (r"what (?:are your |)features|what'?s mindease", 0.8, "features"),
        (r"guide me|show me (?:the |)options|how to use", 0.8, "guide me"),
    ],
}

# Pre-compile every pattern once.
_COMPILED: dict[str, list[tuple[re.Pattern[str], float, str]]] = {
    intent: [(re.compile(rx, re.I), w, label) for rx, w, label in pats]
    for intent, pats in _INTENT_PATTERNS.items()
}

# Stable, public list of supported intents (order = declaration order).
INTENTS: tuple[str, ...] = tuple(_INTENT_PATTERNS.keys())

# Intents that describe an emotional *state* rather than a feature/action. The
# response engine uses this to decide whether to lead with empathy or with a
# concrete MindEase feature.
EMOTIONAL_INTENTS: frozenset[str] = frozenset(
    {"stress", "anxiety", "sadness", "depression", "fear", "anger"}
)


def _score_intent(
    text: str, patterns: list[tuple[re.Pattern[str], float, str]]
) -> tuple[float, list[str]]:
    """Weighted score for one intent: sum of distinct matched-pattern weights."""
    raw = 0.0
    labels: list[str] = []
    for rx, weight, label in patterns:
        if rx.search(text):
            raw += weight
            labels.append(label)
    return raw, labels


def detect_intent(message: str) -> IntentMatch | None:
    """
    Return the best-matching ``IntentMatch`` for *message*, or ``None`` if no
    intent clears ``MIN_CONFIDENCE``. Confidence saturates at ``SATURATION``.
    """
    text = (message or "").strip().lower()
    if not text:
        return None

    best: IntentMatch | None = None
    for intent, patterns in _COMPILED.items():
        raw, labels = _score_intent(text, patterns)
        if raw <= 0:
            continue
        confidence = min(1.0, round(raw / SATURATION, 4))
        if best is None or confidence > best.confidence or (
            confidence == best.confidence and len(labels) > len(best.matched)
        ):
            best = IntentMatch(name=intent, confidence=confidence, matched=labels)

    if best is None or best.confidence < MIN_CONFIDENCE:
        return None
    return best
