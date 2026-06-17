/**
 * Firebase client SDK bootstrap.
 *
 * Uses getApps() / getApp() so Vite HMR never tries to call initializeApp
 * twice, which would throw "app/duplicate-app".
 */
import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId:     import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

if (!firebaseConfig.apiKey || !firebaseConfig.projectId) {
  console.error(
    '[firebase] VITE_FIREBASE_* env vars are missing — ' +
    'copy frontend/.env.example → frontend/.env and fill in your Web App config.',
  )
}

// Guard against Vite HMR re-executing this module and calling initializeApp
// a second time (which throws "app/duplicate-app").
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

export const auth = getAuth(app)
export const db   = getFirestore(app)
export default app
