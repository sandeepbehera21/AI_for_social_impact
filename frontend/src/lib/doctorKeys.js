/**
 * Doctor RSA key bootstrap + private-key delivery (Phase 4).
 *
 * On first sign-in we ask the backend to generate the doctor's RSA-2048 pair.
 * The backend returns the PRIVATE key exactly once; we hand it straight to the
 * doctor as a downloadable PEM file and drop a localStorage marker so we don't
 * nag them on every visit. The private key is never persisted by us beyond the
 * one-time download (the backend keeps its own AES-sealed copy for signing).
 */
import { ensureDoctorKeys } from './api.js'

const SEEN_PREFIX = 'mindease.doctorKey.'

function markerKey(uid) {
  return `${SEEN_PREFIX}${uid}`
}

/** Trigger a browser download of the private-key PEM. */
export function downloadPrivateKeyPem(pem, fingerprint) {
  const blob = new Blob([pem], { type: 'application/x-pem-file' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const tag = (fingerprint || '').slice(0, 8) || 'key'
  a.download = `mindease-private-key-${tag}.pem`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Ensure the doctor has keys. If a private key is returned (first generation),
 * download it and return { created: true, fingerprint }. Otherwise resolves
 * with { created: false }. Safe to call on every dashboard mount.
 */
export async function bootstrapDoctorKeys(uid) {
  let marker = null
  try {
    marker = localStorage.getItem(markerKey(uid))
  } catch {}
  if (marker) return { created: false, fingerprint: marker }

  const result = await ensureDoctorKeys()
  if (result.private_key) {
    downloadPrivateKeyPem(result.private_key, result.public_key_fingerprint)
    try {
      localStorage.setItem(markerKey(uid), result.public_key_fingerprint || '1')
    } catch {}
    return { created: true, fingerprint: result.public_key_fingerprint }
  }
  
  // If backend already had it (but localStorage was cleared/absent), save it so we don't hit backend again
  try {
    localStorage.setItem(markerKey(uid), result.public_key_fingerprint || '1')
  } catch {}
  return { created: false, fingerprint: result.public_key_fingerprint }
}

/** Re-download the private key on demand (re-generates only if none exists). */
export async function redownloadPrivateKey() {
  const result = await ensureDoctorKeys()
  if (result.private_key) {
    downloadPrivateKeyPem(result.private_key, result.public_key_fingerprint)
    return true
  }
  // Backend already holds the (sealed) key and won't re-expose it.
  return false
}
