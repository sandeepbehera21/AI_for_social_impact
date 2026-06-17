/** Role constants and role→route mapping, shared across context/components. */
export const ROLES = { PATIENT: 'patient', DOCTOR: 'doctor', ADMIN: 'admin' }

/** Canonical dashboard path for a given role. */
export function dashboardPathFor(role) {
  if (role === ROLES.DOCTOR) return '/dashboard/doctor'
  if (role === ROLES.PATIENT) return '/dashboard/patient'
  if (role === ROLES.ADMIN) return '/dashboard/admin'
  return '/login'
}
