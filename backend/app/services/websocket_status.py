# Shared module to track active websocket connections.
_active_count = 0

def increment_active_websockets():
    global _active_count
    _active_count += 1

def decrement_active_websockets():
    global _active_count
    _active_count -= 1

def get_active_websockets() -> int:
    return _active_count
