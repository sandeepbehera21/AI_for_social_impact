"""
Local chatbot engine tests — intent detection, NLP+vision emotion fusion,
crisis routing, and MindEase-grounded response content.

Runs fully offline (lexicon mode via conftest's DISABLE_ML_MODEL=1); no external
LLM is ever contacted. The crisis assertions hold in both NLP modes because the
safety trigger is driven by the crisis lexicon.
"""
from fastapi.testclient import TestClient

from app.main import app
from app.ml.sentiment import analyzer
from app.services import chatbot
from app.services.intents import INTENTS, detect_intent, MIN_CONFIDENCE

client = TestClient(app)


# ---------------------------------------------------------------------------
# Intent detection — one representative message per supported intent.
# ---------------------------------------------------------------------------
INTENT_SAMPLES = {
    "meditation": "I want to try some meditation and breathing exercises",
    "stress": "I feel so stressed and completely overwhelmed at work",
    "anxiety": "I'm feeling really anxious and panicky today",
    "sadness": "I feel so sad and lonely, I keep crying",
    "depression": "I feel hopeless and depressed, nothing matters",
    "fear": "I'm scared and full of fear about everything",
    "anger": "I'm so angry and furious right now",
    "doctor_booking": "I want to talk to a doctor about how I feel",
    "appointment_scheduling": "I need to schedule an appointment for next week",
    "reports": "Can I download my clinical report PDF?",
    "privacy": "Is my data private and kept confidential?",
    "face_tracking": "How does the camera emotion tracking work?",
    "dashboard": "Show me my patient dashboard and mood history",
    "greetings": "hello there",
    "gratitude": "thank you so much for the help",
    "help": "what can you do for me?",
}


def test_every_intent_is_covered_by_a_sample():
    # Guards against the taxonomy and the test drifting apart.
    assert set(INTENT_SAMPLES) == set(INTENTS)
    assert len(INTENTS) == 16


def test_intent_detection_per_category():
    for expected, message in INTENT_SAMPLES.items():
        match = detect_intent(message)
        assert match is not None, f"no intent for {message!r}"
        assert match.name == expected, f"{message!r} -> {match.name} (wanted {expected})"
        assert match.confidence >= MIN_CONFIDENCE


def test_unmatched_message_returns_no_intent():
    assert detect_intent("the quick brown fox jumps over the lazy dog") is None
    assert detect_intent("") is None


# ---------------------------------------------------------------------------
# Emotion fusion — NLP only, agreement vs disagreement, camera-off fallback.
# ---------------------------------------------------------------------------
def test_fusion_nlp_only_when_no_face():
    fused = chatbot.fuse_emotion(
        {"joy": 0.1, "sadness": 0.8, "anger": 0.0, "fear": 0.1, "neutral": 0.0}
    )
    assert fused.dominant == "sadness"
    assert fused.sources == ("nlp",)


def test_fusion_agreement_beats_disagreement():
    nlp = {"joy": 0.05, "sadness": 0.05, "anger": 0.8, "fear": 0.05, "neutral": 0.05}
    agree = chatbot.fuse_emotion(nlp, {"Angry": 0.9, "Neutral": 0.1})
    disagree = chatbot.fuse_emotion(nlp, {"Happy": 0.9, "Neutral": 0.1})

    assert agree.sources == ("nlp", "face")
    assert agree.dominant == "anger"
    # Both modalities pointing at anger should yield higher confidence than a
    # contradicting face.
    assert agree.confidence > disagree.confidence


def test_fusion_maps_facial_labels_to_buckets():
    # NLP neutral, but a strong "Sad" face should pull the blend toward sadness.
    fused = chatbot.fuse_emotion(
        {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "neutral": 1.0},
        {"Sad": 1.0},
        nlp_weight=0.5,
    )
    assert fused.scores["sadness"] > 0
    assert fused.sources == ("nlp", "face")


def test_empty_facial_vector_is_ignored():
    fused = chatbot.fuse_emotion(
        {"joy": 0.0, "sadness": 0.0, "anger": 0.0, "fear": 0.0, "neutral": 1.0},
        {"Happy": 0, "Sad": 0, "Angry": 0, "Fear": 0, "Neutral": 0},
    )
    assert fused.sources == ("nlp",)  # no signal -> NLP only


# ---------------------------------------------------------------------------
# Response generation — MindEase-grounded + emotion-aware.
# ---------------------------------------------------------------------------
def test_doctor_reply_references_portal_and_agora():
    r = analyzer.analyze("I want to book a doctor")
    reply = chatbot.generate_reply("I want to book a doctor", r)
    assert reply.intent == "doctor_booking"
    assert "Portal" in reply.text and "Agora" in reply.text


def test_report_reply_mentions_encryption_and_signature():
    msg = "Can I download my clinical report?"
    reply = chatbot.generate_reply(msg, analyzer.analyze(msg))
    assert reply.intent == "reports"
    assert "AES-256" in reply.text and "RSA-2048" in reply.text


def test_privacy_reply_mentions_local_processing():
    msg = "Is my data private?"
    reply = chatbot.generate_reply(msg, analyzer.analyze(msg))
    assert reply.intent == "privacy"
    text = reply.text
    # Both response variants ground privacy in local/on-device processing + AES.
    assert "AES-256" in text
    assert any(
        phrase in text for phrase in ("on-device", "locally in your browser", "ONNX")
    )


def test_meditation_while_fearful_is_anxiety_framed():
    # Fear in BOTH modalities (NLP text + facial) so the fused emotion is fear,
    # which routes meditation to the anxiety-framed response from the spec.
    msg = "I'm scared and anxious — can you tell me about meditation?"
    reply = chatbot.generate_reply(msg, analyzer.analyze(msg), {"Fear": 1.0})
    assert reply.intent == "meditation"
    assert reply.fused_emotion == "fear"
    assert "breathing" in reply.text.lower()


def test_reply_exposes_intent_and_fused_emotion():
    msg = "I feel anxious"
    reply = chatbot.generate_reply(msg, analyzer.analyze(msg))
    assert reply.intent == "anxiety"
    assert reply.fused_emotion in ("joy", "sadness", "anger", "fear", "neutral")


# ---------------------------------------------------------------------------
# Crisis routing — the structured safety contract via the real /chat endpoint.
# ---------------------------------------------------------------------------
def test_crisis_message_returns_structured_contract():
    res = client.post("/chat", json={"message": "I want to kill myself"})
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["type"] == "safety_trigger"
    assert data["crisis_detected"] is True
    assert data["doctor_consultation_required"] is True
    assert data["recommendation"] == "Book an appointment with a doctor immediately."
    assert data["book_consultation_route"]
    assert data["hotlines"]


def test_normal_message_is_not_a_crisis():
    res = client.post("/chat", json={"message": "How do I book a doctor?"})
    data = res.json()
    assert data["type"] == "message"
    assert data["crisis_detected"] is False
    assert data["analysis"]["dominant_intent"] == "doctor_booking"


def test_chat_accepts_facial_emotion_payload():
    res = client.post(
        "/chat",
        json={
            "message": "I feel angry",
            "facial_emotion": {"angry": 0.9, "neutral": 0.1},
        },
    )
    assert res.status_code == 200, res.text
    data = res.json()
    assert data["analysis"]["fusion_sources"] == ["nlp", "face"]


def test_health_reports_intent_count_and_no_llm():
    data = client.get("/health").json()
    assert data["chatbot_configured"] is True
    assert data["intents_supported"] == 16
