/**
 * Browser-side report verification (Phase 4).
 *
 * Proves a clinical PDF is authentic and unaltered by checking the doctor's
 * RSA-2048 signature against the file bytes — entirely in the browser, using the
 * native WebCrypto `subtle` API (no extra dependencies).
 *
 * The backend signs with RSASSA-PKCS1-v1_5 over SHA-256 (pycryptodome
 * `pkcs1_15` + `SHA256`), which is exactly the scheme WebCrypto verifies when
 * given algorithm name `RSASSA-PKCS1-v1_5` and hash `SHA-256`.
 */

/** Decode a base64 string to a Uint8Array. */
function base64ToBytes(b64) {
  const bin = atob(b64.trim())
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

/**
 * Strip a PEM wrapper (`-----BEGIN ...-----`) and decode the base64 body to the
 * raw DER bytes WebCrypto's `importKey('spki', ...)` expects.
 */
function pemToDer(pem) {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/, '')
    .replace(/-----END [^-]+-----/, '')
    .replace(/\s+/g, '')
  return base64ToBytes(body)
}

/** Import a PEM (SPKI) public key as a WebCrypto verification key. */
async function importPublicKey(publicPem) {
  const der = pemToDer(publicPem)
  return crypto.subtle.importKey(
    'spki',
    der,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

/**
 * Verify a clinical report.
 *
 * @param {Object}      args
 * @param {ArrayBuffer} args.pdfBytes      The exact signed PDF bytes.
 * @param {string}      args.signatureB64  base64 RSASSA-PKCS1-v1_5/SHA-256 signature.
 * @param {string}      args.publicKeyPem  Doctor's PEM (SPKI) public key.
 * @param {string}     [args.expectedSha256] Optional hex digest to cross-check.
 * @returns {Promise<{valid: boolean, digestMatches: boolean|null, computedSha256: string}>}
 */
export async function verifyReport({
  pdfBytes,
  signatureB64,
  publicKeyPem,
  expectedSha256,
}) {
  if (!pdfBytes || !signatureB64 || !publicKeyPem) {
    throw new Error('Missing PDF, signature, or public key for verification.')
  }
  const data =
    pdfBytes instanceof ArrayBuffer ? pdfBytes : pdfBytes.buffer || pdfBytes

  // Independent integrity reference: SHA-256 of what we received.
  const computedSha256 = await sha256Hex(data)
  const digestMatches = expectedSha256
    ? computedSha256.toLowerCase() === String(expectedSha256).toLowerCase()
    : null

  const key = await importPublicKey(publicKeyPem)
  const signature = base64ToBytes(signatureB64)
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    data,
  )

  return { valid, digestMatches, computedSha256 }
}

/** Hex-encoded SHA-256 of an ArrayBuffer (for display / cross-checking). */
export async function sha256Hex(buffer) {
  const hash = await crypto.subtle.digest('SHA-256', buffer)
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
