---
title: MindEase Backend
emoji: 🛡️
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# MindEase Backend (FastAPI)


High-performance FastAPI backend: real-time chat with an NLP severity pipeline
(PyTorch / INT8-quantized RoBERTa), Gemini-powered empathetic replies, and an
Agora.io RTC token server for secured telehealth video.

## Layout

```
backend/
├── app/
│   ├── main.py            FastAPI app: /health, /chat, WS /ws/chat
│   ├── config.py          env-driven settings
│   ├── schemas.py         Pydantic request/response models
│   ├── ml/sentiment.py    severity pipeline (emotions + crisis index)
│   ├── services/
│   │   ├── gemini.py       empathetic LLM replies (sentiment-conditioned)
│   │   └── agora.py        RTC token builder
│   └── api/tokens.py      GET /api/tokens/rtc
├── tests/                 pytest (classifier triggers + token endpoint)
├── requirements.txt
└── .env.example           copy to .env
```

## Setup

```bash
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# torch is large — for a CPU-only build use the CPU wheel index:
#   pip install torch --index-url https://download.pytorch.org/whl/cpu
cp .env.example .env               # fill in GEMINI_API_KEY + AGORA_* creds
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
# or: python -m app.main
```

## API

| Method | Path                | Purpose                                              |
|--------|---------------------|------------------------------------------------------|
| GET    | `/health`           | liveness + capability report                         |
| POST   | `/chat`             | one-shot chat (REST fallback)                        |
| WS     | `/ws/chat`          | real-time bi-directional chat with safety gating     |
| GET    | `/api/tokens/rtc`   | Agora RTC token (`channel_name`, `role`, `uid`)      |

**Chat response shape** (`message` or `safety_trigger`):
```jsonc
{
  "type": "message",
  "response": "…",
  "analysis": {
    "sentiment": {"joy":0.0,"sadness":0.85,"anger":0.0,"fear":0.0,"neutral":0.04},
    "safety_index": 0.52,
    "dominant_emotion": "sadness",
    "source": "model"          // or "lexicon"
  }
}
```
When `safety_index > SAFETY_THRESHOLD` (default **0.85**), the server returns
`type: "safety_trigger"` with `hotlines` and `book_consultation_route` instead of
calling the LLM — the frontend uses this to block chat and surface crisis help.

## NLP severity pipeline

`app/ml/sentiment.py` loads `SamLowe/roberta-base-go_emotions` (RoBERTa-base,
GoEmotions) and applies INT8 dynamic quantization for fast CPU inference:

```python
quantized_model = torch.quantization.quantize_dynamic(
    model, {torch.nn.Linear}, dtype=torch.qint8
)
```

The 28 GoEmotions labels are collapsed into **{joy, sadness, anger, fear,
neutral}**. The **Safety/Crisis Index** fuses the model's distress-emotion
probabilities with a curated crisis-phrase lexicon, so explicit self-harm/
suicidal ideation reliably trips the trigger even on short messages.

If torch/transformers/the weights are unavailable (or `DISABLE_ML_MODEL=1`), the
analyzer degrades gracefully to a deterministic lexicon-only mode — the safety
triggers behave identically.

## Tests

```bash
pytest                       # lexicon mode (fast, offline)
DISABLE_ML_MODEL=0 pytest    # exercise the real INT8 RoBERTa
```

## Config (`.env`)

| Var                          | Default                              |
|------------------------------|--------------------------------------|
| `PORT`                       | `8000`                               |
| `FRONTEND_ORIGINS`           | `http://localhost:5173,http://127.0.0.1:5173` |
| `GEMINI_API_KEY` / `GEMINI_MODEL` | — / `gemini-1.5-flash`          |
| `EMOTION_MODEL`              | `SamLowe/roberta-base-go_emotions`   |
| `DISABLE_ML_MODEL`           | `0`                                  |
| `SAFETY_THRESHOLD`           | `0.85`                               |
| `AGORA_APP_ID` / `AGORA_APP_CERTIFICATE` | — / —                    |
| `AGORA_TOKEN_EXPIRY_SECONDS` | `3600`                               |

> ⚠️ The previously committed `GEMINI_API_KEY`, Firebase service-account key, and
> SSH key were exposed in git history — rotate all three.
