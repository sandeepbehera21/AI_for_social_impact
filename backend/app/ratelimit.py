"""
Shared slowapi limiter.

Lives in its own module so both ``app.main`` and the API routers can import the
same limiter instance without a circular import (main imports the routers).
Limiting is per-remote-IP, in-process token bucket.
"""
from __future__ import annotations

from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
