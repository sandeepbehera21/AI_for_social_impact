"""
Centralised configuration, loaded once from the environment (.env).

Everything that varies between machines/deploys lives here so the rest of the
code never reaches for os.getenv directly.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Use an explicit path so uvicorn's --reload subprocesses always find the right
# .env regardless of their working directory.
_BACKEND_DIR = Path(__file__).resolve().parent.parent  # .../backend/
load_dotenv(_BACKEND_DIR / ".env", override=True)


def _csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


class Settings:
    # Read in __init__ (not class scope) so the config is re-instantiable —
    # tests and reloads can change the environment and rebuild Settings().
    def __init__(self) -> None:
        # ---- Server ----
        self.HOST: str = os.getenv("HOST", "127.0.0.1")
        self.PORT: int = int(os.getenv("PORT", "8000"))

        # ---- CORS (Vite dev server: both localhost & 127.0.0.1 by default) ----
        self.FRONTEND_ORIGINS: list[str] = _csv(
            os.getenv(
                "FRONTEND_ORIGINS",
                "http://localhost:5173,http://127.0.0.1:5173",
            )
        )

        # In dev, Vite may pick the next free port (5174, 5175, …); allowing any
        # localhost port keeps the REST/WS fallback working. In production this
        # MUST be off so only the explicit FRONTEND_ORIGINS are trusted (a wide-
        # open localhost regex would also weaken WebSocket origin checks).
        self.DEV_ALLOW_LOCALHOST: bool = os.getenv("DEV_ALLOW_LOCALHOST", "0") in (
            "1", "true", "True",
        )



        # ---- NLP severity pipeline ----
        self.EMOTION_MODEL: str = os.getenv(
            "EMOTION_MODEL", "SamLowe/roberta-base-go_emotions"
        )
        # Disable the heavyweight transformer (CI / low-resource) and run the
        # deterministic lexicon analyzer only.
        self.DISABLE_ML_MODEL: bool = os.getenv("DISABLE_ML_MODEL", "0") in (
            "1", "true", "True",
        )
        # Strictly greater-than this => Critical Distress safety trigger.
        self.SAFETY_THRESHOLD: float = float(os.getenv("SAFETY_THRESHOLD", "0.85"))

        # ---- Agora (telehealth video) ----
        self.AGORA_APP_ID: str | None = os.getenv("AGORA_APP_ID")
        self.AGORA_APP_CERTIFICATE: str | None = os.getenv("AGORA_APP_CERTIFICATE")
        self.AGORA_TOKEN_EXPIRY_SECONDS: int = int(
            os.getenv("AGORA_TOKEN_EXPIRY_SECONDS", "3600")
        )

        # ---- Firebase Admin (auth verification + Firestore) ----
        # Path to the service-account JSON. Defaults to the file the rest of the
        # project already references. Resolved relative to the backend/ dir.
        self.FIREBASE_CREDENTIALS: str = os.getenv(
            "FIREBASE_CREDENTIALS", "firebase-config.json"
        )

        # ---- Clinical crypto (Phase 4) ----
        # 32-byte AES-256 master key (base64 / hex / passphrase) used to encrypt
        # clinical fields and protect doctor private keys at rest. Generate with:
        #   python -c "import os,base64;print(base64.b64encode(os.urandom(32)).decode())"
        self.CLINICAL_MASTER_KEY: str | None = os.getenv("CLINICAL_MASTER_KEY")


settings = Settings()
