"""
Standalone offline verification harness for the MindEase local chatbot engine.

Run:  DISABLE_ML_MODEL=1 python verify_chatbot.py   (no network, no LLM)

Prints a PASS/FAIL table proving the chatbot:
  * detects each supported intent,
  * fuses NLP + facial emotion,
  * routes Critical-Distress to the structured crisis contract,
  * grounds answers in real MindEase functionality.

ASCII-only output (safe on the Windows cp1252 console). Exit 0 iff all checks
pass. This complements the pytest suite in tests/test_chatbot.py.
"""
from __future__ import annotations

import os
import sys

# Force the deterministic offline analyzer so this runs anywhere.
os.environ.setdefault("DISABLE_ML_MODEL", "1")

from app.ml.sentiment import analyzer  # noqa: E402
from app.services import chatbot  # noqa: E402
from app.services.intents import INTENTS  # noqa: E402

CRISIS_RECO = "Book an appointment with a doctor immediately."


def _line(label: str, ok: bool, detail: str = "") -> bool:
    mark = "PASS" if ok else "FAIL"
    print(f"  [{mark}] {label:<46}{detail}")
    return ok


def main() -> int:
    print("=" * 74)
    print("MindEase Local Chatbot - Offline Verification (no Gemini/OpenAI)")
    print("=" * 74)

    all_ok = True

    # 1) Intent coverage --------------------------------------------------
    print("\n1) Intent detection (16 categories)")
    samples = {
        "meditation": "I want to try meditation and breathing",
        "stress": "I feel so stressed and overwhelmed",
        "anxiety": "I'm feeling really anxious and panicky",
        "sadness": "I feel sad and lonely and keep crying",
        "depression": "I feel hopeless and depressed",
        "fear": "I'm scared and full of fear",
        "anger": "I'm so angry and furious",
        "doctor_booking": "I want to talk to a doctor",
        "appointment_scheduling": "I need to schedule an appointment",
        "reports": "Can I download my clinical report?",
        "privacy": "Is my data private and confidential?",
        "face_tracking": "How does the camera emotion tracking work?",
        "dashboard": "Show me my dashboard and mood history",
        "greetings": "hello there",
        "gratitude": "thank you so much",
        "help": "what can you do?",
    }
    assert set(samples) == set(INTENTS), "sample/intent drift"
    for expected, msg in samples.items():
        reply = chatbot.generate_reply(msg, analyzer.analyze(msg))
        ok = reply.intent == expected
        all_ok &= _line(expected, ok, f"-> {reply.intent} ({reply.intent_confidence:.2f})")

    # 2) Emotion fusion ---------------------------------------------------
    print("\n2) NLP + facial emotion fusion")
    nlp = {"joy": 0.05, "sadness": 0.05, "anger": 0.8, "fear": 0.05, "neutral": 0.05}
    agree = chatbot.fuse_emotion(nlp, {"Angry": 0.9})
    disagree = chatbot.fuse_emotion(nlp, {"Happy": 0.9})
    nlp_only = chatbot.fuse_emotion(nlp)
    all_ok &= _line("NLP-only path (camera off)", nlp_only.sources == ("nlp",))
    all_ok &= _line("NLP+face fused", agree.sources == ("nlp", "face"))
    all_ok &= _line(
        "agreement raises confidence",
        agree.confidence > disagree.confidence,
        f"agree={agree.confidence:.2f} vs disagree={disagree.confidence:.2f}",
    )

    # 3) Crisis routing ---------------------------------------------------
    print("\n3) Safety routing (index > 0.85 -> crisis contract)")
    from app.main import _build_response

    crisis = _build_response("I want to kill myself")
    safe = _build_response("How do I book a doctor?")
    all_ok &= _line("crisis_detected on ideation", crisis.crisis_detected is True)
    all_ok &= _line("doctor_consultation_required", crisis.doctor_consultation_required is True)
    all_ok &= _line("exact recommendation text", crisis.recommendation == CRISIS_RECO)
    all_ok &= _line("normal message NOT crisis", safe.crisis_detected is False)

    # 4) MindEase-grounded content ---------------------------------------
    print("\n4) Responses reference real MindEase functionality")
    checks = [
        ("doctor -> Portal + Agora", "I want to see a doctor", ("Portal", "Agora")),
        ("reports -> AES-256 + RSA-2048", "download my clinical report", ("AES-256", "RSA-2048")),
        ("meditation -> breathing/sounds", "tell me about meditation", ("breathing",)),
    ]
    for label, msg, needles in checks:
        reply = chatbot.generate_reply(msg, analyzer.analyze(msg))
        ok = all(n in reply.text for n in needles)
        all_ok &= _line(label, ok)

    print("\n" + "=" * 74)
    print("RESULT:", "ALL CHECKS PASSED" if all_ok else "SOME CHECKS FAILED")
    print("=" * 74)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
