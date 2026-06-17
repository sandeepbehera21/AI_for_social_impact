# MindEase Chatbot — Local Engine Verification Report

**Date:** 2026-06-10
**Objective:** Operate the MindEase chatbot **100% locally** — no Gemini, OpenAI, or any external LLM — powered by NLP sentiment (RoBERTa/GoEmotions), on-device vision emotion (FER+/ONNX/MediaPipe), and a MindEase knowledge base with intent matching, emotion fusion, and crisis routing.

**Outcome:** ✅ Achieved. The chatbot makes **zero external AI calls**. All replies are generated on-device from intent + fused emotion + safety index.

---

## 1. Files Modified / Added

| File | Change |
|---|---|
| `backend/app/services/intents.py` | **NEW** — 16-intent engine (keyword + regex + confidence scoring). |
| `backend/app/services/chatbot.py` | **Rebuilt** — emotion fusion (`fuse_emotion`) + intent/emotion/safety-driven response engine (`generate_reply` → `ReplyResult`). |
| `backend/app/schemas.py` | Added `FacialEmotion`; `ChatRequest.facial_emotion`; `Analysis` intent/fusion fields; `ChatResponse` crisis contract. |
| `backend/app/main.py` | `_build_response` now fuses facial emotion + emits the crisis contract; REST + WS pass `facial_emotion`; `/health` reports intent count. |
| `backend/requirements.txt` | **Removed** `google-generativeai`. |
| `backend/app/services/__init__.py` | Docstring de-Gemini-fied. |
| `backend/tests/conftest.py` | Clears `GEMINI_API_KEY`/`OPENAI_API_KEY` defensively (local-only). |
| `backend/app/services/{crypto,firebase}.py` | Cosmetic comment cleanup. |
| `frontend/src/components/EmotionPanel.jsx` | Added `onEmotions` callback to lift the live facial vector. |
| `frontend/src/pages/ChatPage.jsx` | Captures the facial snapshot and sends it with each message. |
| `frontend/src/lib/api.js` | `sendChatMessage`/socket `send` attach `facial_emotion` (camera-off ⇒ omitted). |
| `backend/tests/test_chatbot.py` | **NEW** — 16 tests (intents, fusion, crisis, content). |
| `backend/verify_chatbot.py` | **NEW** — standalone offline PASS/FAIL harness. |

---

## 2. Removed Gemini Components

- **Dependency:** `google-generativeai>=0.5` deleted from `requirements.txt`.
- **Source/keys/env:** No Gemini service module, API key, env var, or fallback path remains (the `gemini.py` service and `GEMINI_API_KEY` config were already gone; a stale `gemini.cpython-310.pyc` and orphaned `app/routers/` cache were deleted).
- **Verification:** `grep -rniE "gemini|openai|generativeai"` over source returns only **comments/docstrings documenting the absence** of LLMs — no functional code, imports, keys, or network calls.

---

## 3. Intent Categories (16)

`meditation`, `stress`, `anxiety`, `sadness`, `depression`, `fear`, `anger`, `doctor_booking`, `appointment_scheduling`, `reports`, `privacy`, `face_tracking`, `dashboard`, `greetings`, `gratitude`, `help`

Each intent owns weighted regex patterns (keywords + phrasings). `detect_intent()` scores all intents, returns the strongest with a calibrated confidence in `[0,1]`; below `MIN_CONFIDENCE=0.30` it returns `None` and the engine falls back to a pure-emotion reply.

---

## 4. Emotion Categories + Fusion

- **NLP (RoBERTa/GoEmotions):** joy · sadness · anger · fear · neutral
- **Facial (FER+/ONNX):** Happy · Sad · Angry · Fearful · Neutral → mapped to the NLP buckets.
- **Fusion (`fuse_emotion`):** weighted blend (**NLP 0.6 / face 0.4**). Camera off ⇒ NLP-only. Cross-modal **agreement raises** confidence, **disagreement lowers** it (verified: agree `1.00` vs disagree `0.21`).
- Example honored — meditation intent + fear emotion → *"I notice signs of anxiety and fear. You may benefit from using the MindEase Meditation page. It includes a 5-minute guided breathing session and relaxing sounds such as rain, ocean, and birds."*

---

## 5. Safety Routing Results

Safety index `> 0.85` (`SAFETY_THRESHOLD`) short-circuits the engine and **blocks** the normal reply, returning the structured contract:

```json
{ "crisis_detected": true,
  "doctor_consultation_required": true,
  "recommendation": "Book an appointment with a doctor immediately." }
```

plus `type:"safety_trigger"`, crisis hotlines, and `book_consultation_route` (the existing frontend crisis panel is preserved). Normal messages return `crisis_detected:false`. ✅ Verified.

---

## 6. Test Results

**Pytest** (offline, `DISABLE_ML_MODEL=1`): `python -m pytest tests/`
- `test_chatbot.py` — **16/16 passed** (intents, fusion, crisis contract, MindEase content, facial payload, /health).
- `test_sentiment.py` — **6/6 passed**.
- `test_phase4.py` — **passed** (clinical crypto).
- `test_tokens.py` — **3/3 passed** (see note below).
- **Total: 38 passed, 0 failed.**

> **`test_tokens.py` fix (root cause):** `app/config.py` calls `load_dotenv(override=True)`, so the committed `backend/.env` placeholder `AGORA_APP_ID="your-agora-app-id"` (17 chars) overwrote the deterministic 32-char hex credential `conftest.py` sets. The test extracts the base64 payload with a hardcoded `token[3+32:]` slice; with a 17-char app_id the slice was misaligned (`124 − 35 = 89` chars, `89 mod 4 = 1`) → `binascii.Error`. The token builder itself was correct. **Fix:** `conftest.py` now re-pins the 32-char test creds on the `settings` singleton after `app.config` import (test-only; production `override=True` semantics unchanged).

**Standalone harness:** `python verify_chatbot.py` → **ALL CHECKS PASSED** (16 intents, fusion agreement/disagreement, crisis contract, MindEase-grounded content).

---

## 7. How to Verify

```bash
cd backend
DISABLE_ML_MODEL=1 python verify_chatbot.py          # PASS/FAIL table
DISABLE_ML_MODEL=1 python -m pytest tests/test_chatbot.py tests/test_sentiment.py -q
# Live (offline): uvicorn app.main:app  → POST /chat with doctor/meditation/privacy/report/emotional/crisis messages
```

**Frontend:** open Chat → Start Camera → send a message; the request now includes `facial_emotion`, and the reply reflects the fused NLP+vision emotion.
