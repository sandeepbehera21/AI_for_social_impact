"""
Emotion-integration tests: facial distress scoring, text↔face mismatch
detection in the chatbot, and the fused (text + face) crisis-risk escalation.

Runs offline in lexicon mode (conftest sets DISABLE_ML_MODEL=1).
"""
from fastapi.testclient import TestClient

from app.main import app
from app.ml.sentiment import analyzer
from app.services import chatbot

client = TestClient(app)


# ---------------------------------------------------------------------------
# Facial distress score
# ---------------------------------------------------------------------------
def test_facial_distress_is_zero_without_a_face():
    assert chatbot.facial_distress_score(None) == 0.0
    assert chatbot.facial_distress_score({}) == 0.0
    # All-zero vector (camera on, no signal) is treated as no signal.
    assert chatbot.facial_distress_score(
        {"happy": 0, "sad": 0, "angry": 0, "fear": 0, "neutral": 0}
    ) == 0.0


def test_facial_distress_high_for_sad_and_fearful_faces():
    assert chatbot.facial_distress_score({"sad": 0.8, "neutral": 0.2}) >= 0.7
    assert chatbot.facial_distress_score({"fear": 0.9, "neutral": 0.1}) >= 0.8
    # A happy face is not distress.
    assert chatbot.facial_distress_score({"happy": 0.9, "neutral": 0.1}) == 0.0
    # Anger is weighted lower than sadness/fear.
    assert chatbot.facial_distress_score({"angry": 1.0}) < chatbot.facial_distress_score(
        {"sad": 1.0}
    )


# ---------------------------------------------------------------------------
# Text <-> face mismatch detection
# ---------------------------------------------------------------------------
def test_mismatch_detected_when_text_neutral_but_face_sad():
    nlp = {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "neutral": 1.0}
    assert chatbot.detect_emotion_mismatch(nlp, {"sad": 0.75, "neutral": 0.25}) == "sadness"
    assert chatbot.detect_emotion_mismatch(nlp, {"fear": 0.7, "neutral": 0.3}) == "fear"


def test_no_mismatch_when_text_and_face_agree():
    nlp = {"joy": 0.0, "sadness": 0.9, "anger": 0.0, "fear": 0.0, "neutral": 0.1}
    # Sad words + sad face is agreement, not a mismatch.
    assert chatbot.detect_emotion_mismatch(nlp, {"sad": 0.8, "neutral": 0.2}) is None


def test_no_mismatch_without_a_face_or_for_weak_face():
    nlp = {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "neutral": 1.0}
    assert chatbot.detect_emotion_mismatch(nlp, None) is None
    # Below the 0.6 confidence floor -> not a confident mismatch.
    assert chatbot.detect_emotion_mismatch(nlp, {"sad": 0.4, "neutral": 0.6}) is None


# ---------------------------------------------------------------------------
# Mismatch surfaces in a real reply ("I'm okay." + Sad face)
# ---------------------------------------------------------------------------
def test_reply_acknowledges_hidden_sadness():
    result = analyzer.analyze("I'm okay.")
    reply = chatbot.generate_reply("I'm okay.", result, {"sad": 0.75, "neutral": 0.25})
    assert reply.intent == "emotion_mismatch"
    low = reply.text.lower()
    assert "down" in low or "heaviness" in low or "bothering" in low


def test_mismatch_does_not_hijack_a_clear_intent():
    # A direct feature question keeps its intent even with a sad face.
    result = analyzer.analyze("How do I book a doctor?")
    reply = chatbot.generate_reply(
        "How do I book a doctor?", result, {"sad": 0.8, "neutral": 0.2}
    )
    assert reply.intent == "doctor_booking"


# ---------------------------------------------------------------------------
# Fused crisis-risk escalation through the real /chat endpoint
# ---------------------------------------------------------------------------
def test_facial_distress_escalates_to_early_doctor_recommendation():
    # Moderate text distress ("hopeless" -> ~0.63) alone does NOT escalate...
    text_only = client.post("/chat", json={"message": "I feel hopeless"}).json()
    assert text_only["type"] == "message"
    assert text_only["show_doctor_booking"] is False
    assert text_only["analysis"]["facial_distress"] == 0.0

    # ...but the same text corroborated by a strongly sad face does.
    with_face = client.post(
        "/chat",
        json={"message": "I feel hopeless", "facial_emotion": {"sad": 0.7, "neutral": 0.3}},
    ).json()
    assert with_face["type"] == "message"  # not a full crisis lockdown
    assert with_face["show_doctor_booking"] is True
    assert with_face["doctor_consultation_required"] is True
    assert with_face["analysis"]["facial_distress"] >= 0.6
    assert with_face["analysis"]["fused_risk"] > text_only["analysis"]["fused_risk"]


def test_sad_face_alone_never_triggers_a_crisis_lockdown():
    # A neutral message with an extreme sad face must NOT be treated as a crisis.
    res = client.post(
        "/chat",
        json={"message": "hello", "facial_emotion": {"sad": 1.0}},
    ).json()
    assert res["type"] == "message"
    assert res["crisis_detected"] is False
    assert res["show_doctor_booking"] is False


def test_explicit_text_crisis_still_triggers_regardless_of_face():
    res = client.post(
        "/chat",
        json={"message": "I want to kill myself", "facial_emotion": {"happy": 1.0}},
    ).json()
    assert res["type"] == "safety_trigger"
    assert res["crisis_detected"] is True
