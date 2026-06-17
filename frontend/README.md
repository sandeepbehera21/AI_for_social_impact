# MindEase — Frontend (React + Vite)

Patient/Doctor telehealth portal: Firebase Auth, role-gated dashboards,
Firestore appointment scheduling, and Agora live video consultations.

## Setup

```bash
npm install
cp .env.example .env   # then fill in the values below
npm run dev            # http://localhost:5173
```

### Environment (`.env`)

| Variable | Purpose |
| --- | --- |
| `VITE_API_URL` | FastAPI backend base URL (default `http://127.0.0.1:8000`). Supplies Agora RTC tokens at `GET /api/tokens/rtc`. |
| `VITE_FIREBASE_API_KEY` … `VITE_FIREBASE_APP_ID` | Firebase **Web App** config (Project settings → General → Your apps → Web app → SDK config). These are client credentials — distinct from the Admin service account in `backend/firebase-config.json`. |

> The Agora App ID is **not** an env var here — it is returned by the backend
> alongside each short-lived RTC token, so the client never hardcodes it.

## Architecture (Phase 3)

```
src/
  lib/firebase.js          Firebase app init (Auth + Firestore)
  lib/roles.js             ROLES + dashboardPathFor() route mapping
  lib/appointments.js      Firestore data layer (doctors, appointments, live subs)
  lib/datetime.js          slot generation + formatting
  context/AuthContext.jsx  current user + role, signUp/signIn/logout
  components/ProtectedRoute.jsx   auth + role guard
  pages/SignInPage, SignUpPage    auth screens (role chosen at sign-up)
  pages/PatientDashboard.jsx      doctor list + calendar slot booking
  pages/DoctorDashboard.jsx       approve/reject requests, upcoming sessions
  pages/VideoConsultation.jsx     Agora RTC room (mute/camera/leave)
```

### Routes

| Path | Guard |
| --- | --- |
| `/login`, `/signup` | public |
| `/portal` | redirects signed-in users to their dashboard |
| `/dashboard/patient` | role = patient |
| `/dashboard/doctor` | role = doctor |
| `/consultation/:appointmentId` | any signed-in participant |

### Firestore

Collections `users` and `appointments` (see the project-root `firestore.rules`).
Deploy the rules with:

```bash
firebase deploy --only firestore:rules
```

Appointment lifecycle: `pending` → `approved` (doctor) → `completed` (on leave),
or `rejected`. Each appointment carries a unique Agora `channelName`.

## Scripts

- `npm run dev` — dev server
- `npm run build` — production build
- `npm run lint` — ESLint
