"""
NLP Sentiment & Severity pipeline.

This module loads a RoBERTa-base emotion classifier (fine-tuned on GoEmotions),
optimises it for CPU inference with INT8 dynamic quantization, and exposes a
single ``SeverityAnalyzer`` that turns a chat message into:

  * Sentiment scores  -> {joy, sadness, anger, fear, neutral}  (sum ≈ 1.0)
  * Safety/Crisis index -> float in [0.0, 1.0]

The Safety/Crisis index fuses two independent signals:

  1. The transformer's distress-related emotion probabilities
     (grief, sadness, remorse, fear, nervousness, disappointment …).
  2. A curated crisis-phrase lexicon (explicit self-harm / suicidal ideation).

Fusing a learned signal with an explicit lexicon is deliberate: the lexicon
guarantees that unambiguous crisis language always trips the trigger, even on
short messages where a probabilistic model can be under-confident — which is
exactly the failure mode you cannot afford in a mental-health product.

The whole thing degrades gracefully: if torch / transformers / the weights are
unavailable (offline CI, low-resource box, ``DISABLE_ML_MODEL=1``), it falls
back to a deterministic lexicon-only analyzer. The crisis triggers behave
identically in both modes, so safety behaviour is never silently lost.
"""
from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field

from app.config import settings

logger = logging.getLogger("mindease.sentiment")

# ---------------------------------------------------------------------------
# Label taxonomy
# ---------------------------------------------------------------------------
# GoEmotions' 28 fine-grained labels collapsed into the 5 buckets the product
# cares about. Anything not listed (e.g. neutral) maps to "neutral".
_EMOTION_BUCKETS: dict[str, tuple[str, ...]] = {
    "joy": (
        "joy", "amusement", "excitement", "gratitude", "love", "optimism",
        "pride", "relief", "admiration", "approval", "caring", "desire",
    ),
    "sadness": ("sadness", "grief", "disappointment", "remorse", "embarrassment"),
    "anger": ("anger", "annoyance", "disapproval", "disgust"),
    "fear": ("fear", "nervousness"),
    "neutral": ("neutral", "confusion", "curiosity", "realization", "surprise"),
}
_LABEL_TO_BUCKET: dict[str, str] = {
    label: bucket for bucket, labels in _EMOTION_BUCKETS.items() for label in labels
}

# GoEmotions emotions that, weighted, feed the learned half of the crisis index.
_DISTRESS_WEIGHTS: dict[str, float] = {
    "grief": 1.0,
    "sadness": 0.7,
    "remorse": 0.7,
    "fear": 0.6,
    "nervousness": 0.55,
    "disappointment": 0.5,
    "embarrassment": 0.35,
    "disgust": 0.3,
}

# ---------------------------------------------------------------------------
# Crisis lexicon
# ---------------------------------------------------------------------------
# Phrases are intentionally tiered. A "critical" hit on its own is enough to
# cross the trigger threshold; "elevated" hits raise the score but need
# corroboration. Patterns are matched case-insensitively on word boundaries.
_CRITICAL_PATTERNS: tuple[str, ...] = (
    r"kill myself", r"killing myself", r"end my life", r"ending my life",
    r"want to die", r"wanna die", r"wish i (?:was|were) dead", r"better off dead",
    r"no reason to live", r"don'?t want to (?:live|be alive|be here)",
    r"take my (?:own )?life", r"suicidal", r"commit suicide", r"end it all",
    r"kill me", r"slit my wrists", r"hang myself", r"overdose",
)
_ELEVATED_PATTERNS: tuple[str, ...] = (
    r"hurt myself", r"harm myself", r"self[- ]?harm", r"cutting myself",
    r"can'?t go on", r"can'?t do this anymore", r"give up on life",
    r"hopeless", r"worthless", r"hate myself", r"nobody (?:would )?care",
    r"no way out", r"unbearable", r"can'?t take it anymore",
)
_CRITICAL_RE = re.compile(r"\b(?:" + "|".join(_CRITICAL_PATTERNS) + r")\b", re.I)
_ELEVATED_RE = re.compile(r"\b(?:" + "|".join(_ELEVATED_PATTERNS) + r")\b", re.I)

# Lightweight keyword fallback for the no-model path (rough sentiment only).
_FALLBACK_KEYWORDS: dict[str, tuple[str, ...]] = {
    "joy": ("happy", "great", "love", "glad", "grateful", "excited", "good", "better", "hopeful"),
    "sadness": ("sad", "down", "depressed", "lonely", "cry", "hopeless", "empty", "miserable", "grief"),
    "anger": ("angry", "mad", "furious", "hate", "annoyed", "frustrated", "rage"),
    "fear": ("scared", "afraid", "anxious", "panic", "worried", "nervous", "terrified"),
}


@dataclass
class AnalysisResult:
    sentiment: dict[str, float]
    safety_index: float
    dominant_emotion: str
    source: str  # "model" | "lexicon"
    raw: dict[str, float] = field(default_factory=dict)


def _lexicon_crisis_score(text: str) -> float:
    """Crisis score in [0, 1] from explicit phrase matches alone."""
    critical = len(_CRITICAL_RE.findall(text))
    elevated = len(_ELEVATED_RE.findall(text))
    if critical:
        # Any unambiguous critical phrase clears the 0.85 trigger on its own.
        return min(1.0, 0.9 + 0.05 * (critical - 1) + 0.02 * elevated)
    if elevated:
        # Elevated language is concerning but not on its own "critical".
        return min(0.84, 0.45 + 0.18 * elevated)
    return 0.0


class SeverityAnalyzer:
    """Lazy-loading, thread-safe analyzer. Construct once; reuse everywhere."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._loaded = False
        self._tokenizer = None
        self._model = None
        self._id2label: dict[int, str] = {}
        self._torch = None

    # -- model lifecycle ----------------------------------------------------
    def _ensure_loaded(self) -> None:
        if self._loaded:
            return
        with self._lock:
            if self._loaded:
                return
            if settings.DISABLE_ML_MODEL:
                logger.info("DISABLE_ML_MODEL set — using lexicon analyzer only.")
                self._loaded = True
                return
            try:
                import torch
                from transformers import (
                    AutoModelForSequenceClassification,
                    AutoTokenizer,
                )

                logger.info("Loading emotion model %s …", settings.EMOTION_MODEL)
                tok = AutoTokenizer.from_pretrained(settings.EMOTION_MODEL)
                model = AutoModelForSequenceClassification.from_pretrained(
                    settings.EMOTION_MODEL
                )
                model.eval()

                # INT8 dynamic quantization — shrinks the Linear layers and
                # speeds up CPU inference with negligible accuracy loss.
                quantized_model = torch.quantization.quantize_dynamic(
                    model, {torch.nn.Linear}, dtype=torch.qint8
                )

                self._torch = torch
                self._tokenizer = tok
                self._model = quantized_model
                self._id2label = {
                    int(i): str(lbl).lower()
                    for i, lbl in model.config.id2label.items()
                }
                logger.info("Emotion model ready (INT8-quantized).")
            except Exception as exc:  # noqa: BLE001 — any failure -> safe fallback
                logger.warning(
                    "Falling back to lexicon analyzer (model load failed: %s)", exc
                )
                self._model = None
            self._loaded = True

    @property
    def using_model(self) -> bool:
        self._ensure_loaded()
        return self._model is not None

    # -- inference ----------------------------------------------------------
    def _model_probs(self, text: str) -> dict[str, float]:
        """Per-label sigmoid probabilities from the (multi-label) GoEmotions head."""
        torch = self._torch
        inputs = self._tokenizer(
            text, return_tensors="pt", truncation=True, max_length=256
        )
        with torch.no_grad():
            logits = self._model(**inputs).logits
        probs = torch.sigmoid(logits)[0]  # multi-label -> sigmoid, not softmax
        return {self._id2label[i]: float(p) for i, p in enumerate(probs)}

    def _analyze_with_model(self, text: str) -> AnalysisResult:
        probs = self._model_probs(text)

        buckets = {k: 0.0 for k in ("joy", "sadness", "anger", "fear", "neutral")}
        for label, p in probs.items():
            buckets[_LABEL_TO_BUCKET.get(label, "neutral")] += p

        total = sum(buckets.values()) or 1.0
        sentiment = {k: round(v / total, 4) for k, v in buckets.items()}

        # Learned distress signal (weighted sum of distress emotions, capped).
        learned = min(
            1.0, sum(probs.get(lbl, 0.0) * w for lbl, w in _DISTRESS_WEIGHTS.items())
        )
        lexical = _lexicon_crisis_score(text)
        # Lexicon dominates when it fires (explicit intent); otherwise the model
        # carries it, with a small lexical nudge.
        safety = max(lexical, round(0.75 * learned + 0.25 * lexical, 4))
        safety = min(1.0, round(safety, 4))

        dominant = max(sentiment, key=sentiment.get)
        return AnalysisResult(
            sentiment=sentiment,
            safety_index=safety,
            dominant_emotion=dominant,
            source="model",
            raw=probs,
        )

    def _analyze_with_lexicon(self, text: str) -> AnalysisResult:
        lowered = text.lower()
        counts = {
            bucket: sum(lowered.count(word) for word in words)
            for bucket, words in _FALLBACK_KEYWORDS.items()
        }
        counts["neutral"] = 1  # baseline so empty/neutral text -> neutral
        total = sum(counts.values()) or 1
        sentiment = {k: round(v / total, 4) for k, v in counts.items()}
        sentiment.setdefault("neutral", 0.0)

        lexical = _lexicon_crisis_score(text)
        # Strong negative affect without explicit phrases still raises concern.
        neg = sentiment.get("sadness", 0) + sentiment.get("fear", 0)
        safety = max(lexical, round(min(0.84, neg * 0.8), 4))

        dominant = max(sentiment, key=sentiment.get)
        return AnalysisResult(
            sentiment=sentiment,
            safety_index=min(1.0, safety),
            dominant_emotion=dominant,
            source="lexicon",
        )

    def analyze(self, text: str) -> AnalysisResult:
        """Public entry point: classify a single message."""
        text = (text or "").strip()
        if not text:
            return AnalysisResult(
                sentiment={"joy": 0, "sadness": 0, "anger": 0, "fear": 0, "neutral": 1.0},
                safety_index=0.0,
                dominant_emotion="neutral",
                source="lexicon",
            )
        self._ensure_loaded()
        if self._model is not None:
            try:
                return self._analyze_with_model(text)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Model inference failed, using lexicon: %s", exc)
        return self._analyze_with_lexicon(text)

    def is_critical(self, result: AnalysisResult) -> bool:
        return result.safety_index > settings.SAFETY_THRESHOLD


# Module-level singleton — import this everywhere.
analyzer = SeverityAnalyzer()
