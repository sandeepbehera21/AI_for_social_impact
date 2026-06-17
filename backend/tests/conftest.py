"""
Test environment setup.

conftest is imported by pytest BEFORE any test module, so the env vars below are
in place before `app.config` is first imported. NOTE: `app.config` calls
``load_dotenv(override=True)``, which lets the committed ``backend/.env``
overwrite any of these keys that it also defines (e.g. the placeholder
``AGORA_APP_ID``). Keys absent from ``.env`` (DISABLE_ML_MODEL, CLINICAL_MASTER_KEY)
survive untouched; keys present in ``.env`` are re-pinned on the settings
singleton below so tests run against deterministic values regardless of ``.env``.
"""
import os

# Lexicon-only by default: fast, offline, deterministic. The crisis triggers are
# identical to the model path, so safety behaviour is fully covered.
os.environ.setdefault("DISABLE_ML_MODEL", "1")

# Deterministic dummy Agora credentials (32-char hex, like real ones) so the
# token builder produces a real, verifiable token without contacting Agora.
os.environ.setdefault("AGORA_APP_ID", "0123456789abcdef0123456789abcdef")
os.environ.setdefault("AGORA_APP_CERTIFICATE", "fedcba9876543210fedcba9876543210")

# The chatbot is fully local (no Gemini/OpenAI). Defensively clear any stray
# legacy LLM key so nothing in the test environment can imply an external call.
os.environ.pop("GEMINI_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

# Deterministic AES-256 master key (32 bytes, base64) so the Phase 4 clinical
# crypto is "configured" and encrypt/decrypt round-trips work offline.
os.environ.setdefault(
    "CLINICAL_MASTER_KEY",
    "dGVzdC1tYXN0ZXIta2V5LTMyLWJ5dGVzLWxvbmchISE=",  # 32 bytes, base64
)

# `app.config` runs load_dotenv(override=True) on import, clobbering the Agora
# creds above with the 17-char placeholder in backend/.env. Re-pin the
# deterministic 32-char (real-shaped) test creds on the settings singleton so
# token-builder tests validate a correctly-structured token. (Pure test setup —
# no production behaviour changes; the .env override stays as-is for runtime.)
from app.config import settings  # noqa: E402

settings.AGORA_APP_ID = "0123456789abcdef0123456789abcdef"
settings.AGORA_APP_CERTIFICATE = "fedcba9876543210fedcba9876543210"

