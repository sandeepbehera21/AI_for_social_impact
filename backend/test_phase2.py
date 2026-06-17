"""
Phase 2 automated validation harness.

Runs each backend component in-process (no live server needed) and prints a
PASS/FAIL report:

    python test_phase2.py

Components checked:
  * FastAPI            /health responds and reports capabilities
  * NLP Classifier     emotion dict + safety index, crisis triggers > 0.85
  * Safety Routing     crisis -> safety_trigger payload; normal -> message
  * Agora Tokens       /api/tokens/rtc returns a valid 1-hour RTC token

Exit code is 0 only when every component passes.
"""
from __future__ import annotations

import base64
import os
import sys
import traceback

# --- deterministic, offline test environment (set before importing app) ------
# Dummy 32-char Agora creds so the token builder works without contacting Agora.
os.environ.setdefault("AGORA_APP_ID", "0123456789abcdef0123456789abcdef")
os.environ.setdefault("AGORA_APP_CERTIFICATE", "fedcba9876543210fedcba9876543210")
# Force Gemini offline (empty key) so /chat uses the safe fallback — keeps this
# harness network-free and deterministic. The routing logic is unaffected.
os.environ["GEMINI_API_KEY"] = ""
# Use the real INT8 RoBERTa if available; it auto-falls back to the lexicon
# analyzer offline. Set DISABLE_ML_MODEL=1 to force lexicon mode.

from fastapi.testclient import TestClient  # noqa: E402

from app.config import settings  # noqa: E402
from app.main import app  # noqa: E402
from app.ml.sentiment import analyzer  # noqa: E402

client = TestClient(app)

CRISIS_MSG = "I want to kill myself and there is no reason to live"
NORMAL_MSG = "I had a pretty good day and feel grateful"
EMOTION_KEYS = {"joy", "sadness", "anger", "fear", "neutral"}


# ---------------------------------------------------------------------------
# Component checks — each returns (ok: bool, detail: str), raising is caught.
# ---------------------------------------------------------------------------
def check_fastapi() -> tuple[bool, str]:
    res = client.get("/health")
    assert res.status_code == 200, f"status {res.status_code}"
    body = res.json()
    assert body.get("status") == "ok", body
    mode = "model" if body.get("nlp_using_model") else "lexicon"
    return True, f"/health ok | nlp={mode} | threshold={body.get('safety_threshold')}"


def check_nlp_classifier() -> tuple[bool, str]:
    r = analyzer.analyze(NORMAL_MSG)
    # 1) emotion dictionary with all five buckets in [0, 1]
    assert EMOTION_KEYS.issubset(r.sentiment), f"missing keys: {r.sentiment}"
    for k, v in r.sentiment.items():
        assert 0.0 <= v <= 1.0, f"{k}={v} out of range"
    # 2) safety index in [0, 1]
    assert 0.0 <= r.safety_index <= 1.0, r.safety_index
    # crisis text must score high
    c = analyzer.analyze(CRISIS_MSG)
    assert c.safety_index > settings.SAFETY_THRESHOLD, f"crisis safety={c.safety_index}"
    return True, (
        f"source={r.source} | normal_safety={r.safety_index:.2f} "
        f"| crisis_safety={c.safety_index:.2f} | dom={r.dominant_emotion}"
    )


def check_safety_routing() -> tuple[bool, str]:
    # Crisis -> safety_trigger, blocks LLM, flags doctor booking.
    crisis = client.post("/chat", json={"message": CRISIS_MSG})
    assert crisis.status_code == 200, crisis.text
    cb = crisis.json()
    assert cb["type"] == "safety_trigger", cb["type"]
    assert cb["trigger_safety"] is True
    assert cb["show_doctor_booking"] is True
    assert cb.get("hotlines"), "no hotlines in safety payload"
    assert cb.get("book_consultation_route"), "no consultation route"
    # Normal -> message (LLM path; offline fallback still returns type=message).
    normal = client.post("/chat", json={"message": NORMAL_MSG})
    assert normal.status_code == 200, normal.text
    nb = normal.json()
    assert nb["type"] == "message", nb["type"]
    assert nb["trigger_safety"] is False
    return True, (
        f"crisis->safety_trigger ({len(cb['hotlines'])} hotlines, "
        f"route={cb['book_consultation_route']}) | normal->message"
    )


def check_agora_tokens() -> tuple[bool, str]:
    # Missing channel_name must be rejected (validation).
    bad = client.get("/api/tokens/rtc", params={"role": "publisher"})
    assert bad.status_code == 422, f"expected 422, got {bad.status_code}"
    # Happy path.
    res = client.get(
        "/api/tokens/rtc",
        params={"channel_name": "telehealth-room", "role": "publisher", "uid": 7},
    )
    assert res.status_code == 200, res.text
    data = res.json()
    token = data["token"]
    assert token.startswith("006"), "missing Agora version prefix 006"
    base64.b64decode(token[3 + 32 :])  # trailing segment must be valid base64
    assert data["expires_in"] == 3600, data["expires_in"]
    return True, f"token len={len(token)} | expires_in={data['expires_in']}s | role={data['role']}"


CHECKS = [
    ("FastAPI", check_fastapi),
    ("NLP Classifier", check_nlp_classifier),
    ("Safety Routing", check_safety_routing),
    ("Agora Tokens", check_agora_tokens),
]


def main() -> int:
    print("=" * 64)
    print(" MindEase - Phase 2 Validation Report")
    print("=" * 64)
    all_ok = True
    for name, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as exc:  # noqa: BLE001
            ok, detail = False, f"{type(exc).__name__}: {exc}"
            traceback.print_exc()
        all_ok &= ok
        status = "PASS" if ok else "FAIL"
        print(f"  {name:<16}: {status}   {detail}")
    print("=" * 64)
    print(f" RESULT: {'ALL PASS' if all_ok else 'FAILURES PRESENT'}")
    print("=" * 64)
    return 0 if all_ok else 1


if __name__ == "__main__":
    sys.exit(main())
