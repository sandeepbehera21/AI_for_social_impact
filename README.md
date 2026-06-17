# MindEase — Secure Multimodal Mental Health Portal

MindEase pairs an AI chat companion ("Rahat") with **on-device** facial emotion
recognition. Webcam frames never leave the browser — emotion inference runs at
the edge via ONNX Runtime Web.

## Structure

```
.
├── backend/        FastAPI: chat + NLP severity pipeline + Agora tokens
│   ├── app/
│   │   ├── main.py          /health, /chat, WS /ws/chat
│   │   ├── ml/sentiment.py  INT8 RoBERTa emotions + crisis index
│   │   ├── services/        gemini.py (LLM), agora.py (RTC tokens)
│   │   └── api/tokens.py    GET /api/tokens/rtc
│   ├── requirements.txt
│   └── .env.example      copy to .env, add GEMINI_API_KEY + AGORA_*
└── frontend/       Vite + React 19 + Tailwind v4
    ├── src/
    │   ├── pages/        Home, Meditation, Chat, Portal, About
    │   ├── components/   Navbar, Footer, EmotionPanel, ...
    │   ├── hooks/useEmotionTracker.js   webcam → FaceMesh → preprocess
    │   └── workers/emotionWorker.js     FER+ ONNX inference (off main thread)
    └── public/
        ├── models/emotion-ferplus-8.onnx   (downloaded, gitignored)
        ├── ort/      onnxruntime-web WASM binaries (offline, no CDN)
        └── sounds/   add ocean.mp3 / rain.mp3 / birds.mp3
```

## Run

**Backend**
```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# torch is large; CPU-only: pip install torch --index-url https://download.pytorch.org/whl/cpu
cp .env.example .env        # add GEMINI_API_KEY + AGORA_* creds
uvicorn app.main:app --reload --port 8000
```

**Frontend**
```bash
cd frontend
npm install
cp .env.example .env        # VITE_API_URL defaults to http://127.0.0.1:8000
npm run dev                 # http://localhost:5173
```

> The emotion model (`emotion-ferplus-8.onnx`, ~33 MB) and the ORT WASM files
> live under `frontend/public/` and are gitignored. If `public/models/` is
> empty, re-download from the
> [ONNX Model Zoo](https://github.com/onnx/models/tree/main/validated/vision/body_analysis/emotion_ferplus).

## Emotion recognition pipeline

1. `getUserMedia` opens the webcam.
2. MediaPipe FaceMesh (tfjs runtime) finds the face bounding box.
3. The crop is converted to **grayscale**, resized to **64×64** (FER+ input).
4. The tensor is transferred (zero-copy) to a **Web Worker** running the
   quantized **FER+** ONNX model via `onnxruntime-web` (multi-threaded WASM).
5. The 8 FER+ outputs are mapped to **{Happy, Sad, Angry, Fear, Neutral}** and
   rendered as live progress bars with a FPS readout.

Multi-threaded WASM requires cross-origin isolation; the Vite config sets the
`COOP`/`COEP` headers automatically in dev and preview.

> **Note:** FER+ expects raw `0–255` grayscale input (not normalized to
> `[0,1]`); the preprocessing in `useEmotionTracker.js` matches this.

## ⚠️ Security — rotate exposed secrets

The git history contains three secrets that were committed before this refactor.
**Revoke and replace all three:**

1. `GEMINI_API_KEY` (was in `Backend/.env`)
2. Firebase service-account key (`firebase-config.json`)
3. The OpenSSH private key (`new-ai-chatbot`)

These files are now gitignored, but they remain in history — rotating the keys
is the only real remediation.

## Known follow-ups

- The `google.generativeai` SDK is **end-of-life**; consider migrating
  `backend/app/services/gemini.py` to the maintained `google-genai` package.
- Add the meditation `.mp3` files to `frontend/public/sounds/`.
- Wire the Portal page to `GET /api/tokens/rtc` + the Agora video SDK to make
  the "Book Doctor Consultation" telehealth call real.
