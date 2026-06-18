/**
 * AuthContext — single source of truth for the signed-in user and their role.
 *
 * Wraps Firebase Auth (identity) and the Firestore `users/{uid}` document
 * (profile + role). Components read `{ user, profile, role, loading, googleError }`
 * and call `signUp / signIn / logout / signInWithGoogle / assignGoogleRole`
 * without ever touching Firebase directly.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  sendEmailVerification,
} from 'firebase/auth'
import { doc, getDoc, serverTimestamp, setDoc, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../lib/firebase.js'
import { ROLES } from '../lib/roles.js'

const AuthContext = createContext(null)
const googleProvider = new GoogleAuthProvider()

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null)   // raw Firebase user
  const [profile, setProfile] = useState(null)   // Firestore users/{uid} doc
  const [loading, setLoading] = useState(true)   // resolving initial auth state
  const [googleError, setGoogleError] = useState(null) // redirect sign-in error

  useEffect(() => {
    // ── Subscribe to Firebase auth-state changes ────────────────────────
    let profileUnsub = null

    const unsub = onAuthStateChanged(auth, (fbUser) => {
      setUser(fbUser)

      if (profileUnsub) {
        profileUnsub()
        profileUnsub = null
      }

      if (fbUser) {
        profileUnsub = onSnapshot(
          doc(db, 'users', fbUser.uid),
          (snap) => {
            setProfile(snap.exists() ? { uid: fbUser.uid, ...snap.data() } : null)
            setLoading(false)
          },
          (err) => {
            console.error('[auth] failed to subscribe to Firestore profile', err)
            setProfile(null)
            setLoading(false)
          }
        )
      } else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => {
      unsub()
      if (profileUnsub) profileUnsub()
    }
  }, [])

  // ── Email / password sign-up ─────────────────────────────────────────────
  const signUp = async ({ name, email, password, role }) => {
    if (role !== ROLES.PATIENT && role !== ROLES.DOCTOR) {
      throw new Error('Please select a role (Patient or Doctor).')
    }
    const { user: fbUser } = await createUserWithEmailAndPassword(auth, email, password)
    if (name) await updateProfile(fbUser, { displayName: name })

    const profileData = {
      uid: fbUser.uid,
      email,
      name: name || '',
      role,
      registrationDate: serverTimestamp(),
      ...(role === ROLES.DOCTOR ? { verified: false } : {}),
      ...(role === ROLES.PATIENT ? { onboarded: false } : {}),
    }
    await setDoc(doc(db, 'users', fbUser.uid), profileData)
    setProfile({ uid: fbUser.uid, ...profileData })
    
    try {
      await sendEmailVerification(fbUser)
    } catch (err) {
      console.warn('[auth] Failed to send verification email:', err)
    }
    
    return fbUser
  }

  // ── Email / password sign-in ─────────────────────────────────────────────
  const signIn = ({ email, password }) =>
    signInWithEmailAndPassword(auth, email, password)

  const logout = () => {
    try {
      sessionStorage.removeItem('mindease_session_id')
    } catch {}
    return signOut(auth)
  }

  // ── Google Sign-In (popup flow) ──────────────────────────────────────────
  /**
   * Initiates Google sign-in via a popup.
   * After the popup succeeds, onAuthStateChanged fires → user/profile are set
   * → the calling page's useEffect navigates to the correct destination.
   */
  const signInWithGoogle = async () => {
    setGoogleError(null)
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (err) {
      if (err?.code !== 'auth/popup-closed-by-user') {
        console.error('[auth] Google popup failed:', err.code, err.message)
        setGoogleError(err)
      }
      throw err
    }
  }

  // ── Assign role to new Google user ───────────────────────────────────────
  const assignGoogleRole = async (fbUser, role, name) => {
    if (role !== ROLES.PATIENT && role !== ROLES.DOCTOR) {
      throw new Error('Please select a role (Patient or Doctor).')
    }
    const profileData = {
      uid: fbUser.uid,
      email: fbUser.email || '',
      name: name || fbUser.displayName || '',
      role,
      registrationDate: serverTimestamp(),
      ...(role === ROLES.DOCTOR ? { verified: false } : {}),
      ...(role === ROLES.PATIENT ? { onboarded: false } : {}),
    }
    await setDoc(doc(db, 'users', fbUser.uid), profileData)
    setProfile(profileData)

    if (!fbUser.emailVerified) {
      try {
        await sendEmailVerification(fbUser)
      } catch (err) {
        console.warn('[auth] Failed to send verification email for Google user:', err)
      }
    }

    return profileData
  }

  const value = useMemo(
    () => ({
      user,
      profile,
      role: profile?.role ?? null,
      loading,
      googleError,
      signUp,
      signIn,
      logout,
      signInWithGoogle,
      assignGoogleRole,
    }),
    [user, profile, loading, googleError],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an <AuthProvider>')
  return ctx
}
