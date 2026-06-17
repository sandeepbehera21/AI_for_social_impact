# 🛡️ MindEase — Secure Multimodal Mental Health Platform

MindEase is a production-grade, HIPAA-compliant mental health portal that pairs an local AI chat companion (**Rahat**) with **on-device** facial emotion recognition, secure telehealth video consultations, patient wellness tracking, CBT worksheets, and administrative overview dashboards.

Webcam frames never leave the patient's device — emotional feature extraction runs completely at the edge via quantized ONNX models running inside a multi-threaded Web Worker.

---

## 🚀 Key Features

### 👤 Patient Portal
* **Chatbot Companion ("Rahat")**: Real-time bi-directional conversation with multi-turn context retention, topic continuity, named entity extraction, and automatic distress gating.
* **On-Device Emotion Fusion**: Real-time emotion feature extraction corroborating text sentiment. Automatically falls back to a manual emoji selector when webcam access is restricted.
* **CBT Workspace & Journaling**: Interactive cognitive behavioral therapy tools and secure journaling with mood-emotion filtering.
* **Habit & Streak Tracker**: Daily routine tracking with interactive progress charts.
* **SOS Safety Hub**: Crisis resources, grounding/box-breathing exercises, and real-time distress notification broadcasts to attending clinicians.

### 🩺 Clinician Dashboard
* **Telehealth Consultations**: Secure, gated video consultations powered by Agora WebRTC with dynamic token validation.
* **Patient History Overview**: Review logs of patient mood trends, habit completions, and journals (respecting granular patient opt-out consent toggles).
* **Cryptographically Signed Session Reports**: Session notes are signed using the clinician's server-held RSA-2048 key. The resulting PDF reports are stored fully AES-256-GCM encrypted.
* **Audit Trail**: Every clinician query triggers an immutable entry inside the `/consent_audit` collection.

### 👑 Administrative Dashboard
* **Clinician Verification**: Gated approval, suspension, and rejection directory for doctors.
* **Platform Health Monitors**: Real-time checks for API latency, Firestore, Agora configuration, and active WebSocket connection logs.
* **Global Broadcaster**: Publish maintenance banners and urgent safety notices instantly to all connected users.

---

## 🏗️ Technical Architecture & Directory Structure

```
.
├── backend/                  # FastAPI Web Service
│   ├── app/
│   │   ├── api/              # API Endpoints (admin, clinical, mood, tokens, wellness)
│   │   ├── data/             # Local therapeutic knowledge base (500+ entries)
│   │   ├── ml/               # Sentiment analyzer & GoEmotions tokenizer
│   │   ├── services/         # Context managers, Agora, and cryptographic operations
│   │   ├── main.py           # FastAPI entrypoint & WS Chat server
│   │   ├── config.py         # Pydantic Settings
│   │   └── schemas.py        # Request/Response schemas
│   ├── tests/                # 127 Unit Tests (pytest)
│   └── Dockerfile            # Container definition
│
└── frontend/                 # React SPA (Vite)
    ├── src/
    │   ├── components/       # Global UI Components (Navbar, ErrorBoundaries, Bell)
    │   ├── context/          # Auth (Firebase) and Theme Contexts
    │   ├── hooks/            # useEmotionTracker (Webcam → FaceMesh → WebWorker)
    │   ├── pages/            # Client views (Dashboard, SOS, CBT, Chat, Admin)
    │   └── workers/          # emotionWorker (quantized FER+ ONNX model runner)
    └── public/               # ONNX models, local audio samples, and WASM binaries
```

---

## 🛠️ Installation & Local Setup

### Prerequisites
* Python 3.10+
* Node.js 18+
* Firebase Project Credentials

### 1. Backend Setup
```bash
# Navigate to backend
cd backend

# Create and activate virtual environment
python -m venv .venv
# On Windows:
.venv\Scripts\activate
# On Linux/macOS:
source .venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Configure environment variables
copy .env.example .env
# Fill in your FIREBASE_CREDENTIALS, CLINICAL_MASTER_KEY, and AGORA credentials

# Run backend development server
uvicorn app.main:app --reload --port 8000
```

### 2. Frontend Setup
```bash
# Navigate to frontend
cd frontend

# Install dependencies
npm install

# Configure environment variables
copy .env.example .env
# VITE_API_URL defaults to http://127.0.0.1:8000

# Run frontend dev server
npm run dev
```

---

## 🔒 Security & Compliance Guidelines

MindEase enforces production-level security configurations:
1. **At-Rest Encrypted Notes**: Patient clinical summaries (diagnosis, prescriptions, notes) are encrypted via AES-256-GCM.
2. **Cryptographic Sign-Off**: PDFs are hashed using SHA-256 and signed with RSA-2048 private keys to prevent post-completion tampering.
3. **Hardened HTTP Headers**: Implements strict `Content-Security-Policy`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and `Strict-Transport-Security` headers.
4. **WebSocket Protection**: Restricts chat connections via active Firebase ID token validation and checks query origins to prevent Cross-Site WebSocket Hijacking (CSWSH).
5. **Rate Limiting**: `slowapi` boundaries restrict API requests per minute to prevent Denial of Service (DoS) attacks on compute-heavy routes.

---

## 🧪 Testing

The backend is fully covered by an automated test suite.
To execute tests locally:
```bash
cd backend
.venv\Scripts\pytest backend/tests/
```

To run frontend checks and production bundle builds:
```bash
cd frontend
npm run build
```

---

## 🚀 Production Deployment

* **Frontend**: Deploy the frontend directory to **Vercel** or **Firebase Hosting**. Set the Root Directory to `frontend`.
* **Backend**: Deploy the backend directory to **Google Cloud Run** or **Render** as a Docker service. Specify environment variables in your server's hosting panel.
