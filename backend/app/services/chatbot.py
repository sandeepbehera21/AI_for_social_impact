"""
Local offline response engine for MindEase.

Turns a user message + NLP analysis + (optional) on-device facial emotion into a
MindEase-specific, emotion-aware reply — entirely locally, with no external LLM
(Gemini / OpenAI / any network call) involved.

Pipeline
--------
1. ``detect_intent`` (see :mod:`app.services.intents`) classifies the message
   into one of 16 supported intents with a confidence score.
2. ``fuse_emotion`` blends the transformer's NLP sentiment with the browser's
   FER+ facial-emotion vector into a single weighted emotion + confidence.
3. ``generate_reply`` selects a response from intent + fused emotion + safety,
   always grounding feature answers in real MindEase functionality (Meditation
   page, Portal/Agora video, on-device ONNX privacy, AES-256/RSA signed reports,
   Patient Dashboard).

Crisis routing lives upstream in ``app.main`` (a Critical-Distress safety index
short-circuits this engine before a normal reply is ever generated).
"""
from __future__ import annotations

import logging
import random
from dataclasses import dataclass, field

from app.ml.sentiment import AnalysisResult
from app.services.context import (
    AWAITING_CHECKIN,
    ConversationContext,
    ConversationState,
    answer_polarity,
    extract_topic,
    topic_clause,
    topic_noun,
)
from app.services.intents import (
    EMOTIONAL_INTENTS,
    INTENTS,
    IntentMatch,
    detect_intent,
)
from app.services.retrieval import (
    kb_size,
    kb_topics,
    pick_by_topic,
    retrieve,
)

logger = logging.getLogger("mindease.chatbot")

# The five emotion buckets the whole product speaks in.
_BUCKETS = ("joy", "sadness", "anger", "fear", "neutral")

# Map the FER+ facial labels (any case) onto our NLP buckets.
_FACIAL_TO_BUCKET = {
    "happy": "joy",
    "joy": "joy",
    "sad": "sadness",
    "sadness": "sadness",
    "angry": "anger",
    "anger": "anger",
    "fear": "fear",
    "fearful": "fear",
    "neutral": "neutral",
}

# Default fusion weighting: NLP is the primary signal, the face corroborates.
DEFAULT_NLP_WEIGHT = 0.6


# ---------------------------------------------------------------------------
# Emotion fusion
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class FusedEmotion:
    scores: dict[str, float]
    dominant: str
    confidence: float           # how strongly the dominant emotion leads [0,1]
    sources: tuple[str, ...]    # ("nlp",) or ("nlp", "face")


@dataclass(frozen=True)
class ReplyResult:
    text: str
    intent: str | None
    intent_confidence: float
    fused_emotion: str
    fused: FusedEmotion
    conversation_state: str = ConversationState.GREETING
    suggestions: list[str] = field(default_factory=list)


def _normalize_facial(facial: dict | None) -> dict[str, float] | None:
    """Collapse a raw FER+ vector onto the five NLP buckets (or None)."""
    if not facial:
        return None
    buckets = {k: 0.0 for k in _BUCKETS}
    any_signal = False
    for label, value in facial.items():
        bucket = _FACIAL_TO_BUCKET.get(str(label).strip().lower())
        if bucket is None:
            continue
        try:
            v = float(value)
        except (TypeError, ValueError):
            continue
        if v > 0:
            any_signal = True
        buckets[bucket] += max(0.0, v)
    if not any_signal:
        return None
    total = sum(buckets.values()) or 1.0
    return {k: v / total for k, v in buckets.items()}


def fuse_emotion(
    nlp_sentiment: dict[str, float],
    facial: dict | None = None,
    *,
    nlp_weight: float = DEFAULT_NLP_WEIGHT,
) -> FusedEmotion:
    """
    Blend NLP sentiment with an optional facial-emotion vector.

    With no facial input the result is the NLP distribution unchanged. When both
    are present they're mixed ``nlp_weight`` / ``1 - nlp_weight`` and the
    confidence is nudged up when the two modalities *agree* on the dominant
    emotion and down when they disagree.
    """
    nlp = {k: float(nlp_sentiment.get(k, 0.0)) for k in _BUCKETS}
    face = _normalize_facial(facial)

    if face is None:
        scores = nlp
        sources: tuple[str, ...] = ("nlp",)
        agreement_bonus = 0.0
    else:
        w = max(0.0, min(1.0, nlp_weight))
        scores = {k: w * nlp[k] + (1.0 - w) * face[k] for k in _BUCKETS}
        sources = ("nlp", "face")
        nlp_dom = max(nlp, key=nlp.get)
        face_dom = max(face, key=face.get)
        agreement_bonus = 0.15 if nlp_dom == face_dom else -0.10

    total = sum(scores.values()) or 1.0
    scores = {k: round(v / total, 4) for k, v in scores.items()}
    dominant = max(scores, key=scores.get)

    # Confidence = how far the leader sits above the runner-up, plus the
    # cross-modal agreement adjustment, clamped to [0, 1].
    ordered = sorted(scores.values(), reverse=True)
    margin = ordered[0] - (ordered[1] if len(ordered) > 1 else 0.0)
    confidence = max(0.0, min(1.0, round(ordered[0] * 0.6 + margin * 0.4 + agreement_bonus, 4)))

    return FusedEmotion(scores=scores, dominant=dominant, confidence=confidence, sources=sources)


# ---------------------------------------------------------------------------
# Facial distress & cross-modal mismatch (used for risk scoring + the chatbot)
# ---------------------------------------------------------------------------
# Buckets that count as "negative affect" for distress, with anger weighted
# lower (frustration is not the same as distress/risk).
_DISTRESS_BUCKET_WEIGHTS: dict[str, float] = {"sadness": 1.0, "fear": 1.0, "anger": 0.5}

# A face only counts as "saying otherwise" when it leads this strongly.
_MISMATCH_FACE_MIN = 0.6


def facial_distress_score(facial: dict | None) -> float:
    """
    Map a raw FER+ facial vector to a distress score in [0, 1] — the weighted
    mass of negative-affect buckets (sad + fear + ½·anger). Returns 0.0 when the
    camera is off / there's no usable signal. This is the *facial* half of the
    fused crisis-risk score computed in :mod:`app.main`.
    """
    face = _normalize_facial(facial)
    if face is None:
        return 0.0
    score = sum(face.get(b, 0.0) * w for b, w in _DISTRESS_BUCKET_WEIGHTS.items())
    return round(min(1.0, score), 4)


def detect_emotion_mismatch(
    nlp_sentiment: dict[str, float], facial: dict | None
) -> str | None:
    """
    Detect a text↔face contradiction: the words read neutral/positive while the
    face shows strong negative affect (e.g. "I'm okay." + Sad 75%).

    Returns the facial bucket ("sadness" | "fear" | "anger") when the face is
    clearly negative but the text is not, otherwise ``None``. This is what lets
    the bot gently name a feeling the user's words are hiding.
    """
    face = _normalize_facial(facial)
    if face is None:
        return None
    face_dom = max(face, key=face.get)
    if face_dom not in ("sadness", "fear", "anger") or face[face_dom] < _MISMATCH_FACE_MIN:
        return None
    nlp = {k: float(nlp_sentiment.get(k, 0.0)) for k in _BUCKETS}
    nlp_dom = max(nlp, key=nlp.get)
    # Only a mismatch when the *text* reads fine — otherwise it's just agreement
    # (sad words + sad face) and the normal emotional path already handles it.
    return face_dom if nlp_dom in ("neutral", "joy") else None


# ---------------------------------------------------------------------------
# Response templates — every answer references real MindEase functionality.
# ---------------------------------------------------------------------------
def _choose_non_repetitive(pool: list[str] | tuple[str, ...], context: ConversationContext | None) -> str:
    if not pool:
        return ""
    if not context or not getattr(context, "last_openings", None):
        return random.choice(pool)
    
    non_rep = []
    for p in pool:
        opening = p[:25].strip().lower()
        if opening not in context.last_openings:
            non_rep.append(p)
            
    if non_rep:
        return random.choice(non_rep)
    return random.choice(pool)


# Short empathetic lead-ins prepended to feature answers when the user's fused
# emotion is negative, so even a factual reply acknowledges how they feel.
_EMOTION_LEADIN: dict[str, tuple[str, ...]] = {
    "sadness": (
        "It sounds like you're carrying a heavy weight today. ",
        "I'm really sorry things are feeling so dark right now. ",
        "It makes complete sense that you're feeling down. ",
        "I can feel the sadness in what you're sharing. ",
        "Some days are just incredibly hard to get through. ",
        "It's completely okay to feel sad and let yourself feel this. ",
        "I want you to know I'm paying close attention to what you're going through. ",
        "Navigating these low moments takes a lot of quiet strength. ",
        "It is really painful when things feel this heavy. ",
        "I hear how much hurt you are carrying right now. ",
        "Please be gentle with yourself as you navigate this sadness. ",
        "It's okay to not be okay today, I'm here for you. ",
        "Some moments just drain all our energy, and that is valid. ",
        "I'm holding space for you and whatever sadness you feel. ",
        "It makes sense to feel low when there is so much pressure. ",
        "I'm here to listen, even if you just want to sit with this. ",
        "Grief or sadness has its own timeline, and that's okay. ",
        "Your feelings are valid, and you don't have to hide them. ",
        "I can hear the exhaustion and sadness in your thoughts. ",
        "You are dealing with a lot, and it's okay to take a pause. ",
    ),
    "fear": (
        "Anxiety has a way of making everything feel loud and urgent. ",
        "It's completely natural to feel uneasy or on edge right now. ",
        "That nervous feeling can be so overwhelming. ",
        "I can sense the tension and worry you're holding. ",
        "When fear steps in, it can make it hard to even catch your breath. ",
        "It's okay to feel anxious—you don't have to fight it. ",
        "A racing mind can make the smallest things feel huge. ",
        "We can take this slowly, one step at a time. ",
        "Anxiety is a physical alarm, and it takes time to cool down. ",
        "I hear how much worry is running through your head. ",
        "It is completely exhausting when your mind won't stop racing. ",
        "That sense of dread or unease can be so disorienting. ",
        "Let's take a slow breath together to help ground your body. ",
        "Anxious thoughts are just thoughts, not facts, though they feel so real. ",
        "I'm right here, and we can move at whatever pace you need. ",
        "When everything feels out of control, focus on where you are now. ",
        "You're safe here, and we can untangle these worries together. ",
        "Anxiety can make us catastrophize, but we can slow it down. ",
        "That physical tension in your chest is a sign of high alarm. ",
        "It's okay to let go of trying to solve everything right now. ",
    ),
    "anger": (
        "It sounds like you've reached a breaking point, and that is completely valid. ",
        "That level of frustration is incredibly exhausting. ",
        "It is entirely understandable that you're feeling angry about this. ",
        "When things feel unfair or blocked, anger is a very natural response. ",
        "I can hear the tension in what you're dealing with. ",
        "It's okay to feel frustrated—let's work through this pressure. ",
        "That sounds incredibly irritating and hard to tolerate. ",
        "Anger carries a lot of energy, and it's okay to let it out here. ",
        "It is so frustrating when things don't work out as they should. ",
        "I hear how much irritation is built up inside you. ",
        "You have a right to feel upset about how this went. ",
        "When our boundaries are crossed, anger is a normal alarm. ",
        "That sounds deeply exasperating, and I don't blame you at all. ",
        "Let's vent about this; you don't have to bottle it up. ",
        "It is draining to deal with constant blockages or unfairness. ",
        "I'm here to listen to the full weight of your frustration. ",
        "It's okay to be mad—let's make some space for that heat. ",
        "That situation sounds like it was handled very poorly. ",
        "When pressure builds, it's natural for our patience to wear thin. ",
        "Let's express this irritation safely and see how to ease it. ",
    ),
    "joy": (
        "It's wonderful to feel that lightness in your words! ",
        "That is such great news, thank you for sharing that spark! ",
        "I love hearing about these positive moments. ",
        "That sounds like a beautiful experience. ",
        "It's so important to hold onto these bright spots! ",
        "That's fantastic—I'm so glad to hear it! ",
        "What a wonderful feeling to carry. ",
        "That brings a smile to my face, honestly! ",
        "It's great to celebrate these wins, no matter how small. ",
        "That sounds like a real moment of connection or success. ",
        "I am so happy that things went well for you! ",
        "Hold onto this warm feeling; you worked hard for it. ",
        "It's refreshing to hear about these bright updates! ",
        "You deserve to enjoy this moment of peace and joy. ",
        "What a positive turn of events, I'm thrilled for you. ",
        "It sounds like you're in a really good flow today. ",
        "That is a lovely victory to look back on! ",
        "Sharing joy makes it grow, so thank you for telling me. ",
        "It's great to see you feeling lighter and more aligned. ",
        "That is wonderful—let's celebrate this positive step! ",
    ),
    "neutral": (
        "Let's explore what's going on. ",
        "I'm here to listen. ",
        "Tell me a bit more about what's on your mind. ",
        "I'm following you. ",
        "Let's walk through this together. ",
        "I'm paying attention. ",
        "Let's take a look at what you're facing. ",
        "I'm right here with you. ",
        "I want to understand your perspective better. ",
        "Feel free to share as much or as little as you'd like. ",
        "Let's take a moment to look at this situation. ",
        "I'm here to support you in whatever way helps. ",
        "Tell me how that makes you feel. ",
        "I'm listening carefully to what you're saying. ",
        "Let's check in on how you're holding up. ",
        "I'm following what you're sharing. ",
        "Let's break this down together. ",
        "I'm here to help you unpack those thoughts. ",
        "Tell me a bit about how this started. ",
        "I am listening, please take your time. ",
    ),
}

# Feature / action intents -> MindEase-grounded responses. Every variant for an
# intent contains a stable keyword (in parentheses) so behaviour is testable
# even though a variant is chosen at random.
_FEATURE_RESPONSES: dict[str, tuple[str, ...]] = {
    "meditation": (
        "The MindEase Meditation page has a 5-minute guided breathing timer and calming ambient sounds (ocean, rain, and birds) to help you slow down. Would you like to try it now?",
        "Our Meditation page offers guided breathing plus relaxing nature sounds — ocean, rain, and birds — to ease tension. Would you like to try a quick session to see if it helps?",
    ),
    "doctor_booking": (
        "You can book a certified doctor through the MindEase Portal. Consultations run over secure, real-time Agora video, and a doctor approves your request directly. Would you like to go to the Portal and book a slot?",
        "Head to the Portal to connect with a licensed doctor. MindEase uses private, end-to-end Agora video consultations — just request a slot and a doctor can confirm it. Should we get you set up with a booking?",
    ),
    "appointment_scheduling": (
        "To schedule, open the Portal: you can browse a doctor's available slots, request an appointment, and reschedule or cancel from your dashboard at any time. Would you like to view the available slots now?",
        "Appointments are managed in the Portal — pick an open slot on a doctor's calendar and send a request. You'll see the status update once it's approved. Do you want to browse available times?",
    ),
    "reports": (
        "After each consultation your doctor generates a clinical report as a signed PDF. Reports use AES-256 encryption at rest and RSA-2048 digital signatures, and you can download and verify them from your Patient Dashboard. Shall we head there to check your reports?",
        "Your clinical reports live in the Patient Dashboard. Each is digitally signed (RSA-2048) and encrypted with AES-256, so you can download the PDF and verify its authenticity right in the browser. Do you want to open your reports?",
    ),
    "privacy": (
        "Privacy is built in: facial emotion analysis runs entirely on-device via ONNX Runtime Web — your camera frames never leave your browser — and clinical data is encrypted with AES-256. Does that give you peace of mind about using our features?",
        "Your data stays private. The webcam emotion tracking is processed locally in your browser (nothing is uploaded), and clinical notes and reports are encrypted with AES-256 and access-controlled. Would you like to know more about our security controls?",
    ),
    "face_tracking": (
        "MindEase reads facial expressions on-device using a FER+ model in ONNX Runtime Web, with MediaPipe FaceMesh finding your face. It runs locally in your browser, so the video feed never leaves your device. Shall we turn on the camera tracker together?",
        "The emotion tracker uses your webcam with on-device ONNX inference (MediaPipe FaceMesh + FER+). Everything runs locally — you get live emotion readings while your camera frames stay fully private. Do you want to try enabling it now?",
    ),
    "dashboard": (
        "Your Patient Dashboard is the home for your care: mood history, past consultations, and your signed clinical reports, all in one place. Would you like to open your dashboard?",
        "The Patient Dashboard tracks your progress over time — emotion history, appointments, and downloadable clinical reports from your doctors. Should we go to your dashboard?",
    ),
    "greetings": (
        "Hi, I'm Rahat 🌱 your MindEase companion. How are you feeling today?",
        "Hello! I'm Rahat, here to support you. What's on your mind today?",
        "Hi there! I'm Rahat 🌱. How has your day been going so far?",
        "Welcome back to MindEase. I'm Rahat 🌱. What's on your mind today?",
    ),
    "gratitude": (
        "You're very welcome — I'm always here for you on MindEase. 🌱 Is there anything else you'd like to explore today?",
        "Anytime. I'm glad I could help. Remember, MindEase is here whenever you need it. Would you like to check out some wellness tools?",
    ),
    "help": (
        "I'm Rahat, your MindEase companion. I can guide you to guided meditation, help you book a doctor via the Portal, explain your clinical reports and privacy, or just talk through how you're feeling. What would you like to explore?",
        "Here's how I can help on MindEase: try a guided meditation, schedule a secure doctor consultation, review your signed reports in the Dashboard, or share what's on your mind. Where shall we start?",
    ),
}

# Empathetic responses for the emotional-state intents. These acknowledge the
# feeling first, then gently point at a relevant MindEase feature.
_EMOTIONAL_RESPONSES: dict[str, tuple[str, ...]] = {
    "stress": (
        "It sounds like you're carrying a lot right now. Stress is exhausting — the MindEase Meditation page has a 5-minute breathing timer to help you decompress. Would a short breathing exercise help you relax?",
        "Feeling stretched thin is so draining. Let's ease the pressure a little: our guided breathing on the Meditation page can help your nervous system settle. Would you like to try it?",
    ),
    "anxiety": (
        "Anxiety can feel overwhelming, but you're safe here. Try grounding with one slow breath — the MindEase Meditation page has a guided breathing timer that can steady racing thoughts. Shall we try taking a quiet moment?",
        "I hear how anxious you're feeling. Let's focus on one breath at a time. Our Meditation page offers guided breathing and calming sounds that many people find soothing. Would you like to try that?",
    ),
    "sadness": (
        "I'm really sorry you're feeling this way. Sadness can feel heavy, and you don't have to carry it alone. A few quiet minutes with our guided meditation might help — or, if this has lasted a while, the Portal can connect you with a caring doctor. Would you like to connect with a doctor?",
        "It's okay to feel sad, and I'm here to listen. Be gentle with yourself today. If you'd like, we can try the breathing timer on the Meditation page together. Would that bring a bit of comfort?",
    ),
    "depression": (
        "Thank you for trusting me with this. What you're describing sounds really hard, and you deserve support. I'd gently encourage booking a doctor through the MindEase Portal — talking to a professional can make a real difference. Would you like to view our care team options?",
        "I'm so glad you reached out. These feelings are heavy, and you don't have to face them alone. The Portal lets you connect with a licensed doctor over a secure video consultation whenever you're ready. Shall we view the available consultation slots?",
    ),
    "fear": (
        "It sounds like you're feeling frightened, and that's completely understandable. You're safe right now. Slow, steady breaths can help — the MindEase Meditation page has a guided breathing timer to ground you. Would you like to try it?",
        "Fear can be so intense. Let's take it one breath at a time together. Our Meditation page has calming sounds and a breathing exercise that may help you feel more centered. Shall we start a calming timer?",
    ),
    "anger": (
        "I can hear how frustrated you are, and those feelings are valid. This is a safe space to vent. When you're ready, a slow breathing exercise on the Meditation page can help release some of that tension. Would it help to talk more about what triggered this?",
        "Anger is a natural response when things feel unfair. Take your time. If it helps, the guided breathing on our Meditation page is a good way to let off some pressure. Shall we try a 5-minute breathing session?",
    ),
}

# Pure-emotion fallback when no intent is detected at all.
_EMOTION_FALLBACK: dict[str, tuple[str, ...]] = {
    "joy": (
        "It's wonderful to hear that lightness in your words! Celebrating the good moments matters. What's bringing you joy today?",
        "I'm sharing in your happiness! Tell me more about what's going well for you.",
    ),
    "sadness": _EMOTIONAL_RESPONSES["sadness"],
    "anger": _EMOTIONAL_RESPONSES["anger"],
    "fear": _EMOTIONAL_RESPONSES["fear"],
    "neutral": (
        "I'm here and listening. How has your day been going so far?",
        "I'm here to support you, whatever you're feeling. What's on your mind today?",
        "I see. I'm right here with you — tell me more about how you're feeling today.",
    ),
}

# Responses for a text↔face mismatch — the words sound fine but the camera reads
# strong negative affect. We name the feeling gently and open the door to talk.
_MISMATCH_RESPONSES: dict[str, tuple[str, ...]] = {
    "sadness": (
        "I notice you may be feeling a bit down even though your message sounds neutral. Would you like to talk about what's been bothering you?",
        "Your words sound okay, but I'm sensing some heaviness behind them. Would you like to share what's really going on?",
    ),
    "fear": (
        "Your message sounds calm, but I'm picking up that you might be feeling anxious or on edge. Want to talk through what's worrying you?",
        "Even though your words seem steady, it looks like something might be making you uneasy. Would you like to explore what's making you feel nervous?",
    ),
    "anger": (
        "Your message reads as neutral, but it seems like something might be frustrating you underneath. Do you want to talk about what's going on?",
        "Your words sound fine, though I sense some tension. Would it help to vent about what is causing this stress?",
    ),
}


_OPENING_BANK: tuple[str, ...] = (
    "Hi there! I'm Rahat 🌱, your MindEase companion. I'm here to listen — how has your day been going?",
    "Hello! Rahat here 🌱. I hope you're doing okay. What's been on your mind lately?",
    "Hi! I'm Rahat 🌱. I'm here to help you decompress. How are you holding up today?",
    "Welcome to MindEase. I'm Rahat 🌱. I'm here whenever you need a safe space. How are you feeling?",
    "Hello there! Rahat here 🌱. How has your state of mind been today?",
    "Hi! I'm Rahat 🌱. If you're feeling stressed or just want to chat, I'm here. How's your day been?",
    "Hi, welcome back! I'm Rahat 🌱, your companion. How have things been going for you?",
    "Hello! Rahat here 🌱. What kind of support do you feel you need the most today?",
    "Hi! I'm Rahat 🌱. Let's take a moment to check in. How are you feeling right now?",
    "Hi there! I'm Rahat 🌱. I hope your week is going gently. What's on your mind?",
    "Hello! Rahat here 🌱. I'm ready to listen — how has your energy been today?",
    "Hi! I'm Rahat 🌱. Remember to take a slow breath. How are you feeling today?",
    "Welcome! Rahat here 🌱. I'm here to support your wellness journey. How's everything going?",
    "Hi there! I'm Rahat 🌱. How's your heart and mind feeling today?",
    "Hello! I'm Rahat 🌱, your companion here at MindEase. What's been going on in your world?",
    "Hi! Rahat here 🌱. I hope you're taking care of yourself. How are you feeling today?",
    "Hi there! I'm Rahat 🌱. Let's check in — how has your stress level been lately?",
    "Hello! I'm Rahat 🌱. I'm here to help you unpack whatever you're carrying. How are you?",
    "Hi! Rahat here 🌱. Let's take it one step at a time today. How are you feeling?",
    "Welcome back to MindEase. I'm Rahat 🌱. What's the biggest thing on your mind right now?",
    "Hi there! I'm Rahat 🌱. I hope you're finding some quiet moments today. How are you?",
    "Hello! Rahat here 🌱. I'm here to listen and help you find some balance. How's your day?",
    "Hi! I'm Rahat 🌱. I'm glad you checked in. How has your mood been today?",
    "Hi there! Rahat here 🌱. I'm always ready to chat or guide you to our tools. How are you?",
    "Hello! I'm Rahat 🌱. How has your sleep and focus been going recently?",
    "Hi! Rahat here 🌱. Let's take a moment for yourself. How are you feeling today?",
    "Hi there! I'm Rahat 🌱, your companion. What's been the highlights or challenges of your day?",
    "Hello! I'm Rahat 🌱. I'm here to support you through the ups and downs. How are you?",
    "Hi! Rahat here 🌱. How is your peace of mind today? I'm here to listen.",
    "Welcome! I'm Rahat 🌱. Let's take a pause together. How has your day been?",
    "Hi there! Rahat here 🌱. What would feel most supportive for you today?"
)


def _mismatch_reply(face_emotion: str, context: ConversationContext | None = None) -> str:
    pool = _MISMATCH_RESPONSES.get(face_emotion, _MISMATCH_RESPONSES["sadness"])
    return _choose_non_repetitive(pool, context)


def _leadin(emotion: str, context: ConversationContext | None = None) -> str:
    pool = _EMOTION_LEADIN.get(emotion, ("",))
    return _choose_non_repetitive(pool, context)


def _response_for_intent(intent: str, emotion: str, context: ConversationContext | None = None) -> str:
    """Pick an intent response, made emotion-aware where it adds value."""
    # Greetings intent uses the opening bank!
    if intent == "greetings":
        return _choose_non_repetitive(_OPENING_BANK, context)

    # Emotional-state intents get the empathetic family directly.
    if intent in EMOTIONAL_INTENTS:
        pool = _EMOTIONAL_RESPONSES[intent]
        return _choose_non_repetitive(pool, context)

    # Special case from the spec: asking about meditation while anxious/fearful
    # gets an explicitly anxiety-framed meditation answer.
    if intent == "meditation" and emotion in ("fear", "sadness"):
        return (
            "I notice signs of anxiety and fear. You may benefit from using the "
            "MindEase Meditation page. It includes a 5-minute guided breathing "
            "session and relaxing sounds such as rain, ocean, and birds."
        )

    pool = _FEATURE_RESPONSES[intent]
    base = _choose_non_repetitive(pool, context)
    # Acknowledge negative feelings before a factual feature answer — but not for
    # the inherently warm conversational intents.
    if emotion in ("sadness", "fear", "anger") and intent not in (
        "greetings",
        "gratitude",
    ):
        return _leadin(emotion, context) + base
    return base


def _emotion_fallback(emotion: str, context: ConversationContext | None = None) -> str:
    pool = _EMOTION_FALLBACK.get(emotion, _EMOTION_FALLBACK["neutral"])
    return _choose_non_repetitive(pool, context)


# ---------------------------------------------------------------------------
# Retrieval-based reply composition (TF-IDF + cosine over the MindEase KB)
# ---------------------------------------------------------------------------
# The KB tags every entry with one of three "negative-affect" emotion buckets.
# Map the fused emotion (5 buckets) / detected intent onto those so a retrieval
# can be *biased* toward emotionally-matching answers (see retrieval.EMOTION_BOOST).
_KB_EMOTIONS: frozenset[str] = frozenset({"fear", "sadness", "anger"})
_INTENT_TO_KB_EMOTION: dict[str, str] = {
    "anxiety": "fear",
    "fear": "fear",
    "stress": "fear",
    "sadness": "sadness",
    "depression": "sadness",
    "anger": "anger",
}

# Short topic+emotion lead-ins prepended to a retrieved answer so the reply names
# the active topic and the felt emotion before delivering KB guidance (Step 6:
# dynamic composition). ``{Noun}``/``{noun}`` are filled from the topic's surface
# form, guaranteeing the active topic is referenced in every composed reply.
_COMPOSE_LEADIN: dict[str, tuple[str, ...]] = {
    "fear": (
        "It sounds like {noun} is stirring up a lot of anxiety. ",
        "{Noun} can leave anyone feeling anxious and on edge. ",
        "When you think about {noun}, it makes total sense to feel nervous. ",
        "It seems like {noun} is causing a lot of worry right now. ",
        "Dealing with {noun} can feel really overwhelming and uncertain. ",
        "Anxiety around {noun} is something many people experience. ",
        "That feeling of uncertainty about {noun} can be very hard to sit with. ",
        "I can see how {noun} is keeping your mind racing today. ",
    ),
    "sadness": (
        "I can hear how heavily {noun} is weighing on you. ",
        "{Noun} can feel really heavy to carry. ",
        "It's understandable to feel down when dealing with {noun}. ",
        "Facing {noun} can leave us feeling drained and sad. ",
        "I'm really sorry that {noun} has been so painful lately. ",
        "It sounds like {noun} is a major source of sadness for you. ",
        "When {noun} feels like a struggle, it is natural to feel low. ",
        "The weight of {noun} can feel very lonely to carry. ",
    ),
    "anger": (
        "It's completely understandable to feel frustrated about {noun}. ",
        "{Noun} can be genuinely frustrating to deal with. ",
        "Dealing with {noun} would make anyone feel frustrated or angry. ",
        "It sounds like {noun} is causing a lot of built-up irritation. ",
        "When {noun} doesn't go smoothly, anger is a very natural response. ",
        "I can hear the frustration in your voice regarding {noun}. ",
        "It's hard to stay calm when dealing with the stress of {noun}. ",
        "That situation with {noun} sounds incredibly irritating. ",
    ),
}


def _get_recall_prefix(topic: str, context: ConversationContext | None) -> str:
    """If the user returns to a topic discussed earlier (>4 turns ago), explicitly acknowledge it."""
    if not context or not context.topics or len(context.history) < 6:
        return ""
    recent_in_history = False
    history_list = list(context.history)
    for turn in history_list[-4:]:
        if turn.role == "user" and extract_topic(turn.text) == topic:
            recent_in_history = True
            break
    if not recent_in_history and topic in context.topics[:-1]:
        clause = topic_clause(topic)
        if clause:
            return f"Returning to what you mentioned earlier about {clause}. "
    return ""


def _kb_emotion(emotion: str | None, intent: str | None) -> str | None:
    """Map a fused emotion / intent onto a KB emotion bucket for ranking bias."""
    if emotion in _KB_EMOTIONS:
        return emotion
    return _INTENT_TO_KB_EMOTION.get(intent or "")


def _compose(response: str, topic: str | None, kb_emotion: str | None, context: ConversationContext | None = None) -> str:
    """Compose a final reply from a retrieved KB answer + a topic/emotion lead-in."""
    noun = topic_noun(topic)
    variants = _COMPOSE_LEADIN.get(kb_emotion or "")
    if not noun or not variants:
        return response
    lead = _choose_non_repetitive(variants, context).format(noun=noun, Noun=noun[:1].upper() + noun[1:])
    recall_prefix = _get_recall_prefix(topic, context) if topic else ""
    return recall_prefix + lead + response


def _retrieve_reply(
    message: str,
    *,
    topic: str | None,
    emotion: str | None,
    intent: str | None,
    context: ConversationContext | None = None,
) -> str | None:
    """Topic-aware retrieval (Step 5)."""
    kb_emotion = _kb_emotion(emotion, intent)
    msg_topic = extract_topic(message)
    if msg_topic == "clear_topic":
        msg_topic = None

    result = retrieve(
        message, topic=topic, emotion=kb_emotion, message_topic=msg_topic
    )

    # 1. An active conversation topic anchors the reply.
    if topic:
        if result is not None and result.entry.topic == topic:
            return _compose(result.entry.response, topic, kb_emotion, context)
        entry = pick_by_topic(topic, kb_emotion)
        if entry is not None:
            return _compose(entry.response, topic, kb_emotion, context)

    # 2. No active topic
    if result is not None and msg_topic is not None:
        return _compose(result.entry.response, result.entry.topic, kb_emotion, context)

    return None


# ---------------------------------------------------------------------------
# Conversation-context layer
# ---------------------------------------------------------------------------
_INTENT_STATE: dict[str, str] = {
    "stress": ConversationState.STRESS_DISCUSSION,
    "anxiety": ConversationState.ANXIETY_DISCUSSION,
    "fear": ConversationState.ANXIETY_DISCUSSION,
    "depression": ConversationState.STRESS_DISCUSSION,
    "sadness": ConversationState.STRESS_DISCUSSION,
    "doctor_booking": ConversationState.DOCTOR_BOOKING,
    "appointment_scheduling": ConversationState.DOCTOR_BOOKING,
    "meditation": ConversationState.MEDITATION_GUIDANCE,
    "greetings": ConversationState.GREETING,
}

_WEAK_INTENTS: frozenset[str] = frozenset({"greetings", "gratitude"})

_ACTIVE_DISCUSSIONS: frozenset[str] = frozenset(
    {ConversationState.STRESS_DISCUSSION, ConversationState.ANXIETY_DISCUSSION}
)

_DISCUSSION_CONTINUATIONS: dict[str, tuple[str, ...]] = {
    ConversationState.ANXIETY_DISCUSSION: (
        "Those anxious thoughts can really take over{topic}. You're not alone in this — would a short guided breathing exercise on the Meditation page help you reset?",
        "It's completely understandable to feel this way{topic}. Let's slow things down together — even a minute of steady breathing can ease the spiral. Want to try?",
        "Worries like \"what if I fail\" are so common under pressure{topic}, and they're exhausting. What would feel most supportive right now — talking it through, or a calming exercise?",
        "Anxiety has a way of repeating the same fears over and over{topic}. Try to notice them without believing them. Would you like to use our CBT page to write down and challenge these worries?",
        "When your heart is racing or chest feels tight{topic}, your body is in fight-or-flight. Slowing down your breath is the fastest way to signal safety. Shall we do a quick breathing session on the Meditation page?",
        "It sounds like you're carrying a lot of tension{topic}. Remember that anxiety peaks and then fades. What is one small thing we can do right now to help you feel a bit safer?",
        "Uncertainty is very hard to sit with{topic}. Try focusing on what is real and solid in this room instead of what might happen. Would a grounding exercise help?",
        "Anxious minds love to catastrophize{topic}. It's okay to feel this way, but remember you are stronger than the worry. Would you like to check in with a verified doctor on our Consult Doctor page for deeper support?",
    ),
    ConversationState.STRESS_DISCUSSION: (
        "That sounds really draining{topic}. You're carrying a lot — what's weighing on you the most right now?",
        "It makes sense that it's hard to focus{topic}. When everything piles up, even small steps help. Would a short reset on the Meditation page help?",
        "I hear you{topic}. You don't have to push through this alone — would it help to talk it out, or try a calming break first?",
        "When stress piles up, even small decisions feel like a mountain{topic}. Try breaking your tasks down into tiny, low-pressure steps, and log them on our Habits page.",
        "You've been pushing yourself very hard{topic}, and your energy is running low. Please prioritize rest today. Would a 3-minute mindful pause on our Meditation page help?",
        "Carrying this much pressure is exhausting{topic}. It is completely valid that you feel overwhelmed. Writing about it in the MindEase Journal can help get these thoughts out of your head.",
        "When stress is this high, focus is the first thing we lose{topic}. Don't blame yourself for struggling. Let's take a quick step back — would a brief breathing exercise help clear your mind?",
        "You don't have to do all this alone{topic}. If the pressure is getting to be too much, please consider speaking to a professional on our Consult Doctor page.",
    ),
}


# A discussion state implies an emotion bucket for retrieval ranking.
_STATE_TO_EMOTION: dict[str, str] = {
    ConversationState.ANXIETY_DISCUSSION: "fear",
    ConversationState.STRESS_DISCUSSION: "sadness",
}


def _continue_discussion(state: str, topic: str | None, message: str = "", context: ConversationContext | None = None) -> str:
    """
    A natural continuation that keeps an active discussion on-topic.

    Retrieval-first: when a KB entry meaningfully matches the running thread it is
    composed into the reply (so the conversation deepens with real, varied
    content); otherwise we fall back to the hand-written continuation templates.
    """
    retrieved = _retrieve_reply(
        message, topic=topic, emotion=_STATE_TO_EMOTION.get(state), intent=None, context=context
    )
    if retrieved is not None:
        return retrieved

    clause = topic_clause(topic)
    suffix = f" with {clause}" if clause else ""
    variants = _DISCUSSION_CONTINUATIONS.get(
        state, _DISCUSSION_CONTINUATIONS[ConversationState.STRESS_DISCUSSION]
    )
    return _choose_non_repetitive(variants, context).format(topic=suffix)


@dataclass(frozen=True)
class _Decision:
    """The context-resolved reply: text + the state/await it leaves behind."""

    text: str
    intent: str | None
    state: str
    awaiting: str | None = None


def _is_question(text: str | None) -> bool:
    return bool(text and "?" in text)


def _is_weak_intent(intent: IntentMatch | None) -> bool:
    """True when *intent* is too thin to override an answer-to-a-question read."""
    return intent is None or intent.name in _WEAK_INTENTS


def _topic_stress_reply(topic: str | None, context: ConversationContext | None = None) -> str:
    noun = topic_noun(topic)
    if noun:
        return (
            f"It sounds like you've had a lot on your plate lately. "
            f"{noun[:1].upper() + noun[1:]} can become overwhelming when everything "
            f"piles up. What's been causing the most pressure for you recently?"
        )
    return _choose_non_repetitive(_EMOTIONAL_RESPONSES["stress"], context)


def _topic_anxiety_reply(topic: str | None, context: ConversationContext | None = None) -> str:
    clause = topic_clause(topic)
    if clause:
        return (
            f"Feeling nervous makes a lot of sense with {clause}. Let's take it one "
            f"breath at a time — the MindEase Meditation page has a guided breathing "
            f"exercise that can help steady racing thoughts."
        )
    return _choose_non_repetitive(_EMOTIONAL_RESPONSES["anxiety"], context)


def _interpret_checkin_answer(
    message: str, fused: FusedEmotion, context: ConversationContext
) -> _Decision:
    """
    Read a short reply *as the answer to the bot's previous check-in question*.

    "not good, lot of work" stops being isolated anger and becomes work-driven
    stress; "I'm good thanks" becomes a positive check-in.
    """
    polarity = answer_polarity(message)
    topic = extract_topic(message) or context.recent_topic()

    # Positive (and not contradicted by a clearly sad fused emotion) -> stay in a
    # light daily check-in and invite them to share more.
    if polarity == "positive" and fused.dominant in ("joy", "neutral"):
        return _Decision(
            text=(
                "I'm really glad to hear that! It's good to notice the bright spots. "
                "What's been going well for you?"
            ),
            intent="daily_checkin",
            state=ConversationState.DAILY_CHECKIN,
            awaiting=AWAITING_CHECKIN,
        )

    # Negative / heavy answer -> route by topic + fused emotion. The topic set is
    # the spec taxonomy of life-stressors that read as "stress" rather than fear.
    if topic in (
        "career", "job", "internship", "exams", "placements",
        "studies", "family", "finances", "health",
    ) or fused.dominant == "anger":
        return _Decision(
            text=_topic_stress_reply(topic, context),
            intent="stress",
            state=ConversationState.STRESS_DISCUSSION,
        )
    if fused.dominant == "fear":
        return _Decision(
            text=_topic_anxiety_reply(topic, context),
            intent="anxiety",
            state=ConversationState.ANXIETY_DISCUSSION,
        )
    if polarity == "negative" or fused.dominant == "sadness":
        return _Decision(
            text=(
                "I'm sorry it's been a rough one. You don't have to carry it alone — "
                "I'm here to listen. What's been weighing on you the most today?"
            ),
            intent="stress",
            state=ConversationState.STRESS_DISCUSSION,
        )

    # Genuinely neutral answer -> keep the check-in going.
    return _Decision(
        text=_emotion_fallback("neutral", context),
        intent=None,
        state=ConversationState.DAILY_CHECKIN,
        awaiting=AWAITING_CHECKIN,
    )


def _decide(
    message: str,
    intent: IntentMatch | None,
    fused: FusedEmotion,
    context: ConversationContext | None,
    mismatch: str | None = None,
) -> _Decision:
    """Resolve the reply, using conversation context when one is supplied."""
    emotion = fused.dominant

    # 0. Cross-modal mismatch: the words sound fine but the face shows strong
    #    negative affect ("I'm okay." + Sad 75%). This takes precedence whenever
    #    the text is low-signal, but never hijacks a clear actionable intent
    #    (e.g. "how do I book a doctor?").
    if mismatch and _is_weak_intent(intent):
        state = (
            ConversationState.ANXIETY_DISCUSSION
            if mismatch == "fear"
            else ConversationState.STRESS_DISCUSSION
        )
        return _Decision(_mismatch_reply(mismatch, context), "emotion_mismatch", state)

    import re

    # --- Stateless path (no context): retrieval for emotional/topical turns,
    #     templates for the factual feature intents. ----------------------------
    if context is None:
        msg_topic = extract_topic(message)
        msg_topic = None if msg_topic == "clear_topic" else msg_topic
        if intent is not None:
            if intent.name in EMOTIONAL_INTENTS:
                text = _retrieve_reply(
                    message, topic=msg_topic, emotion=emotion, intent=intent.name
                ) or _response_for_intent(intent.name, emotion)
            else:
                text = _response_for_intent(intent.name, emotion)
            state = _INTENT_STATE.get(intent.name, ConversationState.DAILY_CHECKIN)
            return _Decision(text, intent.name, state)
        text = _retrieve_reply(
            message, topic=msg_topic, emotion=emotion, intent=None
        ) or _emotion_fallback(emotion)
        return _Decision(text, None, ConversationState.DAILY_CHECKIN)

    # Resolve follow-ups referring to earlier entities (like "it", "that", "them") to the recent topic
    topic = extract_topic(message)
    if not topic and re.search(r"\b(?:it|that|this|them|those|there|then)\b", message, re.I):
        topic = context.recent_topic()

    # 1. The user is answering the bot's previous check-in question.
    if context.awaiting == AWAITING_CHECKIN and _is_weak_intent(intent):
        return _interpret_checkin_answer(message, fused, context)

    # 2. A clear intent. For emotional intents we run topic-aware retrieval first
    #    (carrying the remembered topic so a later "I'm feeling nervous" links back
    #    to the earlier "exams next week"); feature intents keep their grounded,
    #    factual templates. Retrieval falls back to the topic templates on a miss.
    if intent is not None:
        resolved_topic = None if topic == "clear_topic" else (topic or context.recent_topic())
        if intent.name in EMOTIONAL_INTENTS:
            text = _retrieve_reply(
                message, topic=resolved_topic, emotion=emotion, intent=intent.name, context=context
            )
            if text is None:
                if intent.name == "stress":
                    text = _topic_stress_reply(resolved_topic, context)
                elif intent.name in ("anxiety", "fear"):
                    text = (
                        _topic_anxiety_reply(resolved_topic, context)
                        if resolved_topic
                        else _response_for_intent(intent.name, emotion, context)
                    )
                else:
                    text = _response_for_intent(intent.name, emotion, context)
        else:
            text = _response_for_intent(intent.name, emotion, context)
        state = _INTENT_STATE.get(intent.name, context.state)
        awaiting = AWAITING_CHECKIN if intent.name == "greetings" else None
        return _Decision(text, intent.name, state, awaiting)

    # 3. No intent, but the user named a stressor topic (e.g. "I have exams
    #    next week") — acknowledge it and open the door to talk about it.
    if topic and topic != "clear_topic" and emotion in ("neutral", "joy") and context.state not in _ACTIVE_DISCUSSIONS:
        noun = topic_noun(topic)
        recall_prefix = _get_recall_prefix(topic, context)
        return _Decision(
            text=(
                f"{recall_prefix}Thanks for sharing that. {noun[:1].upper() + noun[1:]} can bring a "
                f"lot of pressure. How have you been feeling about it?"
            ),
            intent=None,
            state=ConversationState.DAILY_CHECKIN,
            awaiting=AWAITING_CHECKIN,
        )

    # 3b. Already in an active emotional discussion and the user keeps talking
    #     without a new clear intent ("I can't focus", "I think I might fail").
    #     Continue the thread on-topic instead of resetting to a neutral
    #     check-in — this is what keeps multi-turn conversations coherent.
    if context.state in _ACTIVE_DISCUSSIONS and intent is None:
        remembered = topic or context.recent_topic()
        return _Decision(
            text=_continue_discussion(context.state, remembered, message, context),
            intent=None,
            state=context.state,
        )

    # 4. Pure-emotion fallback, topic-aware when a stressor is named in this
    #    message or on record — retrieval-first so the topic pulls a real KB
    #    answer. We consider the *current* message's topic too (not just earlier
    #    turns), so a first-turn negative-emotion message that names a stressor
    #    ("I can't sleep, my mind keeps racing") retrieves on-topic guidance
    #    instead of dropping to a generic empathetic template.
    remembered = None if topic == "clear_topic" else (topic or context.recent_topic())
    if emotion in ("sadness", "fear", "anger") and remembered:
        retrieved = _retrieve_reply(
            message, topic=remembered, emotion=emotion, intent=None, context=context
        )
        if emotion == "fear":
            return _Decision(
                retrieved or _topic_anxiety_reply(remembered, context), None,
                ConversationState.ANXIETY_DISCUSSION,
            )
        return _Decision(
            retrieved or _topic_stress_reply(remembered, context), None,
            ConversationState.STRESS_DISCUSSION,
        )

    fallback_state = (
        ConversationState.DAILY_CHECKIN if emotion == "neutral" else context.state
    )
    awaiting = AWAITING_CHECKIN if emotion == "neutral" else None
    return _Decision(_emotion_fallback(emotion, context), None, fallback_state, awaiting)


# ---------------------------------------------------------------------------
# Patient context injection (greetings / fallback check-ins)
# ---------------------------------------------------------------------------
def _habit_awareness(habit_summary: dict | None) -> str | None:
    """A short, specific observation about a lagging habit (or None)."""
    if not habit_summary or not habit_summary.get("logged_days"):
        return None
    for m in habit_summary.get("metrics", []):
        if m["logged_days"] == 0:
            continue
        if m["key"] == "sleepHours" and m["adherence"] < 0.7:
            return f"you've averaged about {round(m['avg'])} hours of sleep recently"
        if m["key"] == "exerciseMinutes" and m["adherence"] < 0.5:
            return "you haven't logged much movement this week"
        if m["key"] == "screenTimeHours" and m["adherence"] < 0.5:
            return f"your screen time has been around {round(m['avg'])} hours a day"
    return None


def _trend_awareness(mood_summary: dict | None) -> str | None:
    """A short note about a rising distress trend (or None)."""
    if not mood_summary:
        return None
    periods = {p["period"]: p for p in mood_summary.get("periods", [])}
    weekly = periods.get("weekly", {})
    risk = weekly.get("risk_score", 0.0)
    dom = weekly.get("dominant")
    if risk >= 0.4 and dom in ("Fear", "Sad", "Angry"):
        label = {"Fear": "anxiety", "Sad": "low mood", "Angry": "frustration"}.get(dom, "stress")
        return f"your {label} trend has been a bit higher this week"
    return None


def build_wellness_awareness(signals: dict | None) -> str | None:
    """
    Compose the proactive wellness-aware line the bot can offer on a greeting /
    check-in, e.g. "I noticed you've only slept 5 hours on average this week and
    your anxiety trend has increased. Would you like to review your wellness plan?"

    Returns None when there's nothing specific worth surfacing.
    """
    if not signals:
        return None
    habit = _habit_awareness(signals.get("habit_summary"))
    trend = _trend_awareness(signals.get("mood_summary"))
    observations = [o for o in (habit, trend) if o]
    if not observations:
        return None

    joined = observations[0] if len(observations) == 1 else f"{observations[0]} and {observations[1]}"
    has_plan = bool(signals.get("active_plan"))
    tail = (
        "Would you like to review your wellness plan?"
        if has_plan
        else "Would you like me to put together a wellness plan for you?"
    )
    return f"Hello! I'm Rahat 🌱. I noticed {joined}. {tail}"


def build_onboarding_awareness(signals: dict | None) -> str | None:
    """Compose a personalized onboarding-aware greeting based on GAD-7/PHQ-9 scores and subsequent progress."""
    if not signals or not signals.get("profile"):
        return None
    profile = signals.get("profile", {})
    gad7 = profile.get("onboarding_gad7")
    phq9 = profile.get("onboarding_phq9")
    if gad7 is not None or phq9 is not None:
        parts = []
        if gad7 is not None:
            parts.append(f"GAD-7 score of {gad7}")
        if phq9 is not None:
            parts.append(f"PHQ-9 score of {phq9}")
        scores_str = " and ".join(parts)
        
        # Check if they have done any CBT exercises or wellness plans since onboarding
        cbt_count = len(signals.get("cbt") or [])
        plan = signals.get("active_plan")
        if cbt_count > 0:
            return (
                f"Hello! I'm Rahat 🌱, your MindEase companion. I remember your initial baseline scores ({scores_str}). "
                f"You've already completed {cbt_count} CBT exercise{'s' if cbt_count > 1 else ''} to build your skills! "
                f"How has your state of mind been since you started?"
            )
        elif plan:
            return (
                f"Hello! I'm Rahat 🌱, your MindEase companion. I remember your initial baseline scores ({scores_str}). "
                f"You're currently working on your personalized wellness plan. "
                f"How are you feeling as you follow your new habits?"
            )
        else:
            return (
                f"Hello! I'm Rahat 🌱, your MindEase companion. I have noted your baseline scores ({scores_str}). "
                f"I'm here to help you build coping habits and track your journey. "
                f"What would you like to focus on first today?"
            )
    return None


def inject_patient_context(
    text: str,
    recent_journals: list[dict],
    recent_cbt: list[dict],
    intent: str | None,
    signals: dict | None = None,
    active_topic: str | None = None,
    context: ConversationContext | None = None,
) -> str:
    """Inject context from recent journals/CBT/habits/trends into greetings or fallback replies."""
    if intent != "greetings" and text not in _EMOTION_FALLBACK["neutral"]:
        return text

    # 1. Check for critical doctor recommendations in user profile
    profile = (signals or {}).get("profile") or {}
    doc_rec = profile.get("doctorRecommendation") or profile.get("recommendations") or profile.get("doctorNotes")

    # 2. Check for active wellness plan and tasks
    active_plan = (signals or {}).get("active_plan")

    # 3. Check for habit trends & streaks
    habit_summary = (signals or {}).get("habit_summary")
    streak = habit_summary.get("streak", 0) if habit_summary else 0
    adherence = habit_summary.get("adherence", 0.0) if habit_summary else 0.0

    # Check if a specific habit is particularly strong
    strong_habits = []
    lagging_habits = []
    if habit_summary:
        for m in habit_summary.get("metrics", []):
            if m.get("logged_days", 0) >= 3:
                if m.get("adherence", 0.0) >= 0.8:
                    strong_habits.append(m["label"].lower())
                elif m.get("adherence", 0.0) < 0.5:
                    lagging_habits.append(m["label"].lower())

    # 4. Check for mood trends
    mood_summary = (signals or {}).get("mood_summary")
    trend = _trend_awareness(mood_summary)

    if intent == "greetings":
        wellness_awareness = build_wellness_awareness(signals)
        if wellness_awareness:
            return wellness_awareness

        greetings_pool = []

        # Scenario A: Doctor Recommendation
        if doc_rec:
            greetings_pool.append(
                f"Hello! I'm Rahat 🌱, your MindEase companion. I wanted to check in on how you're doing. "
                f"Your doctor recently suggested: '{doc_rec}'. Have you been able to work on that recommendation?"
            )

        # Scenario B: High Habit Adherence & Streaks
        if streak >= 3 and adherence >= 0.7:
            habits_str = f"your {' and '.join(strong_habits[:2])}" if strong_habits else "your daily habits"
            greetings_pool.append(
                f"Hello! Rahat here 🌱. I'm so pleased to see you've kept a {streak}-day habit logging streak going! "
                f"Great job staying consistent with {habits_str}. How is your day going?"
            )

        # Scenario C: Active Plan Tasks
        if isinstance(active_plan, dict):
            tasks = active_plan.get("tasks") or []
            if tasks:
                greetings_pool.append(
                    f"Hello! I'm Rahat 🌱. I noticed you're working through your personalized wellness plan. "
                    f"How are you feeling as you follow your plan today?"
                )

        # Scenario D: Specific Mood Trend
        if trend:
            greetings_pool.append(
                f"Hi there! I'm Rahat 🌱. Checking in since I noticed {trend}. "
                f"I'm here to support you — what would you like to focus on today?"
            )

        # Scenario E: Recent CBT worksheet completed
        if recent_cbt:
            latest_cbt = recent_cbt[0]
            cbt_type = latest_cbt.get("type", "")
            cbt_topic = latest_cbt.get("topic", "")
            cbt_titles = {
                "reframing": "Thought Reframing",
                "anxiety": "Anxiety Worksheet",
                "stress": "Stress Worksheet",
                "gratitude": "Gratitude Exercise",
                "reflection": "Self-Reflection",
            }
            title = cbt_titles.get(cbt_type, "CBT Worksheet")
            topic_str = f" focusing on {cbt_topic}" if cbt_topic else ""
            greetings_pool.append(
                f"Hello! I'm Rahat 🌱, your companion. I saw that you recently completed a {title}{topic_str}. "
                f"Did that exercise help you find some balance, or how are you feeling today?"
            )

        # Scenario F: Recent Journal entry logged
        if recent_journals:
            latest_j = recent_journals[0]
            topic = latest_j.get("topic", "general")
            title = latest_j.get("title", "")
            subject = title if title else (f"your thoughts on {topic}" if topic != "general" else "your thoughts")
            if active_topic:
                greetings_pool.append(
                    f"Hi there! I'm Rahat 🌱. I read your recent journal entry about '{subject}'. "
                    f"Since you mentioned feeling stress related to {active_topic}, we can explore those feelings together today."
                )
            else:
                greetings_pool.append(
                    f"Hi there! I'm Rahat 🌱. I read your recent journal entry about '{subject}'. "
                    f"I'm here to listen — how has your mind been since you wrote that?"
                )

        # If we have some interesting proactive greetings, pick one!
        if greetings_pool:
            return _choose_non_repetitive(greetings_pool, context)

        # Onboarding-aware greeting referencing PHQ-9/GAD-7 scores
        onboarding_awareness = build_onboarding_awareness(signals)
        if onboarding_awareness:
            return onboarding_awareness

        # Standard fallback greeting from opening bank
        return _choose_non_repetitive(_OPENING_BANK, context)

    # For fallbacks/check-ins (intent is None and text is in fallback)
    checkin_pool = []

    # Scenario A: Lagging Habits
    if lagging_habits:
        lag_str = " and ".join(lagging_habits[:2])
        checkin_pool.append(
            f"I noticed that keeping up with your {lag_str} has been a bit challenging recently. "
            f"Would it help to look at small, low-pressure steps to build consistency?"
        )

    # Scenario B: Mood Trend
    if trend:
        checkin_pool.append(
            f"I've noticed {trend}. Remember, we can take things one step at a time. "
            f"Would you like to try a short breathing exercise on the Meditation page to help ground you?"
        )

    # Scenario C: Wellness Plan Tasks
    if active_plan:
        checkin_pool.append(
            "I noticed you have an active wellness plan. "
            "How has it been going trying to fit those exercises and habits into your week?"
        )

    # Scenario D: CBT worksheet reflection
    if recent_cbt:
        latest_cbt = recent_cbt[0]
        cbt_type = latest_cbt.get("type", "")
        cbt_titles = {
            "reframing": "Thought Reframing",
            "anxiety": "Anxiety Worksheet",
            "stress": "Stress Worksheet",
            "gratitude": "Gratitude Exercise",
            "reflection": "Self-Reflection",
        }
        title = cbt_titles.get(cbt_type, "CBT Worksheet")
        checkin_pool.append(
            f"I noticed you completed a {title} recently. "
            f"Did that exercise help you structure your thoughts, or would you like to talk about it today?"
        )

    if checkin_pool:
        return _choose_non_repetitive(checkin_pool, context)

    return text

    return text


# ---------------------------------------------------------------------------
def generate_suggestions(
    intent: str | None,
    emotion: str | None,
    topic: str | None,
) -> list[str]:
    """Generate up to 4 context-aware follow-up suggestion strings based on intent, emotion, and active topic."""
    suggestions = []

    # Map suggestions based on active topic first (highest contextual relevance)
    if topic == "career" or topic == "job" or topic == "placements" or topic == "internship":
        suggestions.extend([
            "Decompress from work stress",
            "Set work-life boundaries",
            "Explore career anxiety",
        ])
    elif topic == "exams" or topic == "studies":
        suggestions.extend([
            "Try a study focus reset",
            "Manage exam anxiety",
            "Start a 5-minute breathing break",
        ])
    elif topic == "relationships" or topic == "family":
        suggestions.extend([
            "Cope with relationship stress",
            "Write a reflection journal",
            "Talk to a verified doctor",
        ])
    elif topic == "finances":
        suggestions.extend([
            "Calm my financial panic",
            "Break down my stress list",
            "Explore coping exercises",
        ])
    elif topic == "loneliness":
        suggestions.extend([
            "Cope with feeling isolated",
            "Connect with a supportive doctor",
            "Try a self-reflection log",
        ])
    elif topic == "sleep":
        suggestions.extend([
            "Quiet my racing mind for sleep",
            "Try box-breathing before bed",
            "Set a healthy sleep habit",
        ])
    elif topic == "panic":
        suggestions.extend([
            "Help me calm a panic attack",
            "Try a quick 4-7-8 grounding",
            "Open the Meditation page",
        ])
    elif topic == "grief":
        suggestions.extend([
            "Cope with losing someone",
            "Write a letter in my journal",
            "Connect with a grief doctor",
        ])

    # Overlay or append intent-based suggestions
    if intent == "meditation":
        suggestions.extend([
            "Try 5-min guided breathing",
            "Listen to nature sounds",
            "Log a meditation habit",
        ])
    elif intent == "doctor_booking" or intent == "appointment_scheduling":
        suggestions.extend([
            "Browse doctor schedules",
            "Learn about secure video consults",
            "How do I join the video room?",
        ])
    elif intent == "reports":
        suggestions.extend([
            "How do I verify report signatures?",
            "Download clinical report PDF",
            "Open my Patient Dashboard",
        ])
    elif intent == "privacy" or intent == "face_tracking":
        suggestions.extend([
            "How does local ONNX tracking work?",
            "Is my webcam video uploaded?",
            "Enable live emotion tracking",
        ])
    elif intent == "dashboard":
        suggestions.extend([
            "Check my mood history trends",
            "View my wellness plan",
            "See clinician access logs",
        ])

    # Fallback to emotion-based suggestions if list is sparse
    if len(suggestions) < 3:
        if emotion == "fear":
            suggestions.extend([
                "Calm my racing thoughts",
                "Try a slow breathing exercise",
                "Open the Meditation page",
            ])
        elif emotion == "sadness" or emotion == "depression":
            suggestions.extend([
                "Write in my private Journal",
                "Book a doctor session",
                "Explore a wellness plan",
            ])
        elif emotion == "anger":
            suggestions.extend([
                "Vent about my frustration",
                "Try a box-breathing reset",
                "Open my daily habits log",
            ])
        else:
            suggestions.extend([
                "Try a 5-minute breathing session",
                "Write in my Journal",
                "How does MindEase keep me safe?",
            ])

    # Deduplicate while preserving order and limit to 4 suggestions
    seen = set()
    unique_suggestions = []
    for s in suggestions:
        if s not in seen:
            seen.add(s)
            unique_suggestions.append(s)
    return unique_suggestions[:4]


# Public entry point
# ---------------------------------------------------------------------------
def generate_reply(
    message: str,
    analysis: AnalysisResult,
    facial: dict | None = None,
    context: ConversationContext | None = None,
    patient_id: str | None = None,
) -> ReplyResult:
    """
    Produce a MindEase-specific reply from the message, NLP analysis, optional
    facial-emotion vector, optional :class:`ConversationContext`, and patient_id.

    With a context, the engine reads each message *relative to the conversation*:
    a short answer to the bot's own question is interpreted against that question,
    and a remembered stressor (exams, work, …) is carried into later replies. The
    context is updated in place with this turn before returning.

    Returns the text plus the intent, fused emotion, and resulting conversation
    state that drove the reply (so the API can surface them).
    """
    fused = fuse_emotion(getattr(analysis, "sentiment", {}), facial)
    intent: IntentMatch | None = detect_intent(message)
    mismatch = detect_emotion_mismatch(getattr(analysis, "sentiment", {}), facial)

    decision = _decide(message, intent, fused, context, mismatch)

    # Load the patient's full wellness signals (journals, CBT, habits, mood
    # trend, active plan, risk) if a patient_id is present, so the bot is aware
    # of their wellness plan, habit performance, emotional trends and risk.
    recent_journals: list[dict] = []
    recent_cbt: list[dict] = []
    signals: dict | None = None
    if patient_id:
        try:
            from app.services import patient_data

            signals = patient_data.load_signals(patient_id)
            recent_journals = (signals.get("journals") or [])[:3]
            recent_cbt = (signals.get("cbt") or [])[:3]
        except Exception as e:  # noqa: BLE001
            logger.warning("Failed to load patient signals for chatbot: %s", e)

    active_topic = context.recent_topic() if context else None
    reply_text = inject_patient_context(
        decision.text, recent_journals, recent_cbt,
        intent.name if intent else None, signals, active_topic,
        context=context,
    )

    if context is not None:
        context.record_user(message, intent.name if intent else None, fused.dominant)
        context.record_bot(reply_text, decision.state, decision.awaiting)

    logger.info(
        "intent=%s effective=%s emotion=%s state=%s sources=%s",
        intent.name if intent else None,
        decision.intent,
        fused.dominant,
        decision.state,
        "+".join(fused.sources),
    )

    suggs = generate_suggestions(decision.intent, fused.dominant, active_topic)

    return ReplyResult(
        text=reply_text,
        intent=decision.intent,
        intent_confidence=intent.confidence if intent else 0.0,
        fused_emotion=fused.dominant,
        fused=fused,
        conversation_state=decision.state,
        suggestions=suggs,
    )


def is_configured() -> bool:
    """The local offline engine is always ready — no keys, no network."""
    return True


# Exposed for /health and the verification report.
SUPPORTED_INTENTS: tuple[str, ...] = INTENTS


def retrieval_status() -> dict:
    """KB/retrieval stats for /health and the verification report."""
    return {"kb_entries": kb_size(), "kb_topics": list(kb_topics())}
