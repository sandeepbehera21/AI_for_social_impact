"""
NLP classifier + safety-trigger tests.

These assertions hold in BOTH modes (real INT8 RoBERTa or lexicon fallback),
because the crisis lexicon guarantees the trigger fires on explicit ideation
regardless of whether the transformer is loaded.
"""
import os

# Keep the test suite fast/offline-deterministic by default. Flip to "0" (or
# unset) to exercise the real quantized RoBERTa path.
os.environ.setdefault("DISABLE_ML_MODEL", "1")

from app.config import settings  # noqa: E402
from app.ml.sentiment import analyzer  # noqa: E402


def test_neutral_message_is_safe():
    r = analyzer.analyze("What's the weather like today?")
    assert 0.0 <= r.safety_index <= 1.0
    assert not analyzer.is_critical(r)


def test_positive_message_is_safe():
    r = analyzer.analyze("I had a wonderful day and I feel really grateful and happy!")
    assert not analyzer.is_critical(r)
    assert r.safety_index <= settings.SAFETY_THRESHOLD


def test_sad_but_not_critical():
    r = analyzer.analyze("I've been feeling a bit down and lonely this week.")
    # Sadness should register, but ordinary sadness must not trip the trigger.
    assert not analyzer.is_critical(r)


def test_critical_self_harm_triggers():
    for msg in (
        "I want to kill myself",
        "I don't want to live anymore",
        "I have been thinking about ending my life",
        "there is no reason to live and I want to die",
    ):
        r = analyzer.analyze(msg)
        assert r.safety_index > settings.SAFETY_THRESHOLD, f"missed crisis: {msg!r}"
        assert analyzer.is_critical(r)


def test_scores_are_well_formed():
    r = analyzer.analyze("I am scared and anxious about everything.")
    for key in ("joy", "sadness", "anger", "fear", "neutral"):
        assert key in r.sentiment
        assert 0.0 <= r.sentiment[key] <= 1.0
    assert r.dominant_emotion in r.sentiment


def test_empty_message_is_neutral_safe():
    r = analyzer.analyze("   ")
    assert r.safety_index == 0.0
    assert r.dominant_emotion == "neutral"
