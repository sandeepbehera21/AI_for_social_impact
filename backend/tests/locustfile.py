import time
import json
import requests
from datetime import datetime, timezone
from locust import HttpUser, task, between, events

# Try to import websocket-client for WebSocket chat load testing
try:
    import websocket
    HAS_WEBSOCKET = True
except ImportError:
    HAS_WEBSOCKET = False


class MindEaseUser(HttpUser):
    # Wait between 1 and 3 seconds between tasks per user
    wait_time = between(1, 3)

    def on_start(self):
        """
        Runs once when a virtual user starts.
        Seeds mock user profiles and an active appointment in the local Firestore emulator (port 8080)
        to make sure the token and database queries succeed.
        """
        emulator_url = "http://localhost:8080/v1/projects/flowmind-559ee/databases/(default)/documents"
        
        # We need the scheduled appointment time to be current so it doesn't fail the start-time checks
        now_str = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
        
        # Seed mock patient profile
        patient_data = {
            "fields": {
                "uid": {"stringValue": "patient123"},
                "role": {"stringValue": "patient"},
                "name": {"stringValue": "Mock Patient"}
            }
        }
        try:
            requests.patch(f"{emulator_url}/users/patient123", json=patient_data, timeout=2.0)
        except Exception:
            pass  # Fail silently if emulator is not running locally

        # Seed mock doctor profile
        doctor_data = {
            "fields": {
                "uid": {"stringValue": "doctor123"},
                "role": {"stringValue": "doctor"},
                "name": {"stringValue": "Mock Doctor"},
                "verified": {"booleanValue": True}
            }
        }
        try:
            requests.patch(f"{emulator_url}/users/doctor123", json=doctor_data, timeout=2.0)
        except Exception:
            pass

        # Seed mock active appointment
        appt_data = {
            "fields": {
                "patientId": {"stringValue": "patient123"},
                "doctorId": {"stringValue": "doctor123"},
                "status": {"stringValue": "approved"},
                "dateTime": {"stringValue": now_str},
                "channelName": {"stringValue": "mock_channel"}
            }
        }
        try:
            requests.patch(f"{emulator_url}/appointments/appt_mock", json=appt_data, timeout=2.0)
        except Exception:
            pass

    @task(3)
    def get_wellness_score(self):
        """Simulates a patient fetching their wellness score history."""
        headers = {"Authorization": "Bearer mock-uid-patient123"}
        self.client.get(
            "/api/wellness/wellness-score", 
            headers=headers, 
            name="/api/wellness/wellness-score"
        )

    @task(3)
    def get_mood_trend(self):
        """Simulates a patient fetching their mood trend charts."""
        headers = {"Authorization": "Bearer mock-uid-patient123"}
        self.client.get(
            "/api/mood/mood-trend", 
            headers=headers, 
            name="/api/mood/mood-trend"
        )

    @task(1)
    def get_rtc_token(self):
        """Simulates fetching an Agora RTC token for a video consultation."""
        headers = {"Authorization": "Bearer mock-uid-patient123"}
        self.client.get(
            "/api/tokens/rtc?appointment_id=appt_mock&role=publisher&uid=0", 
            headers=headers, 
            name="/api/tokens/rtc"
        )

    @task(2)
    def ws_chat_session(self):
        """
        Simulates an active WebSocket conversation with the AI companion 'Rahat'.
        Establishes a connection, sends a message, receives the AI reply, and disconnects.
        """
        if not HAS_WEBSOCKET:
            # Skip WebSocket test if websocket-client is not installed in the execution environment
            return

        # Determine target host and convert http:// to ws://
        base_host = self.host or "http://127.0.0.1:8000"
        ws_host = base_host.replace("http://", "ws://").replace("https://", "wss://")
        ws_url = f"{ws_host}/ws/chat?token=mock-uid-patient123"

        start_time = time.perf_counter()
        ws = None
        try:
            # Set a 5-second timeout for connection and reads
            ws = websocket.create_connection(ws_url, timeout=5.0)
            
            # Send message
            message = {"text": "I am feeling a bit stressed about my exams. Any advice?"}
            ws.send(json.dumps(message))
            
            # Receive response from AI companion
            response = ws.recv()
            
            # Record success metric
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            events.request.fire(
                request_type="WS",
                name="/ws/chat",
                response_time=elapsed_ms,
                response_length=len(response),
                exception=None
            )
        except Exception as e:
            elapsed_ms = int((time.perf_counter() - start_time) * 1000)
            events.request.fire(
                request_type="WS",
                name="/ws/chat",
                response_time=elapsed_ms,
                response_length=0,
                exception=e
            )
        finally:
            if ws:
                try:
                    ws.close()
                except Exception:
                    pass
