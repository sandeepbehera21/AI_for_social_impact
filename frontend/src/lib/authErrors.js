/** Map Firebase Auth error codes to friendly, user-facing messages. */
const MESSAGES = {
  // Email / password
  'auth/invalid-email': 'That email address looks invalid.',
  'auth/user-disabled': 'This account has been disabled.',
  'auth/user-not-found': 'No account found with that email.',
  'auth/wrong-password': 'Incorrect email or password.',
  'auth/invalid-credential': 'Incorrect email or password.',
  'auth/email-already-in-use': 'An account already exists with that email.',
  'auth/weak-password': 'Password should be at least 6 characters.',
  'auth/too-many-requests': 'Too many attempts. Please try again later.',
  'auth/network-request-failed': 'Network error — check your connection.',
  'auth/invalid-api-key':
    'Firebase is not configured. Set VITE_FIREBASE_* in frontend/.env.',

  // Google Sign-In specific
  'auth/popup-blocked':
    'Google sign-in popup was blocked. Please allow popups for this site and try again.',
  'auth/popup-closed-by-user':
    'Google sign-in was cancelled. Please try again.',
  'auth/cancelled-popup-request':
    'Only one sign-in popup can be open at a time.',
  'auth/unauthorized-domain':
    'This domain is not authorised for Google Sign-In. Add it to Firebase Console → Authentication → Settings → Authorised domains.',
  'auth/account-exists-with-different-credential':
    'An account already exists with this email using a different sign-in method. Try signing in with email & password.',
  'auth/operation-not-allowed':
    'Google Sign-In is not enabled. Please enable it in Firebase Console → Authentication → Sign-in method.',
  'auth/internal-error':
    'An internal error occurred. Please try again.',
}

export function authErrorMessage(err) {
  if (!err) return 'Something went wrong.'
  if (err.code && MESSAGES[err.code]) return MESSAGES[err.code]
  return err.message || 'Something went wrong. Please try again.'
}
