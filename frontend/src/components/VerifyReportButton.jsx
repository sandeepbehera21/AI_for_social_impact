import { useState } from 'react'
import {
  ShieldCheck,
  ShieldAlert,
  Loader2,
  ShieldQuestion,
  FileText,
} from 'lucide-react'
import { getSessionDetail, fetchSessionReport } from '../lib/api.js'
import { verifyReport } from '../lib/verify.js'

/**
 * Patient-facing "Verify Report" control for a completed appointment.
 *
 * Click → fetch the doctor's public key + signature (session detail) and the
 * signed PDF, then verify the RSA-2048 signature entirely in the browser. Shows
 * a green "authentic" badge or a red tamper warning.
 */
export default function VerifyReportButton({ appointmentId }) {
  const [state, setState] = useState('idle') // idle | checking | valid | invalid | error | none
  const [message, setMessage] = useState('')
  const [pdfUrl, setPdfUrl] = useState(null)

  const verify = async () => {
    setState('checking')
    setMessage('')
    try {
      const detail = await getSessionDetail(appointmentId)

      if (!detail.signature || !detail.public_key || !detail.has_report) {
        setState('none')
        setMessage('No signed report is available for this session yet.')
        return
      }

      const pdfBytes = await fetchSessionReport(appointmentId)
      const { valid, digestMatches, computedSha256 } = await verifyReport({
        pdfBytes,
        signatureB64: detail.signature,
        publicKeyPem: detail.public_key,
        expectedSha256: detail.pdf_sha256,
      })

      // Offer the verified PDF for viewing.
      const url = URL.createObjectURL(
        new Blob([pdfBytes], { type: 'application/pdf' }),
      )
      setPdfUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return url
      })

      if (valid && digestMatches !== false) {
        setState('valid')
        setMessage(`Verified against Dr. ${detail.doctor_name}'s key.`)
      } else {
        setState('invalid')
        setMessage(
          digestMatches === false
            ? 'The file hash does not match what the doctor signed.'
            : 'The signature did not validate — the report may have been altered.',
        )
      }
      // computedSha256 is available for power users / debugging if needed.
      void computedSha256
    } catch (err) {
      setState('error')
      setMessage(err.message)
    }
  }

  if (state === 'valid') {
    return (
      <Badge tone="ok" icon={ShieldCheck} title="Signature Verified & Authentic">
        {message}
        {pdfUrl && <ViewLink url={pdfUrl} />}
      </Badge>
    )
  }
  if (state === 'invalid') {
    return (
      <Badge tone="bad" icon={ShieldAlert} title="Verification Failed">
        {message}
        {pdfUrl && <ViewLink url={pdfUrl} />}
      </Badge>
    )
  }
  if (state === 'none') {
    return (
      <Badge tone="muted" icon={ShieldQuestion} title="No Signed Report">
        {message}
      </Badge>
    )
  }
  if (state === 'error') {
    return (
      <div className="mt-3">
        <Badge tone="bad" icon={ShieldAlert} title="Couldn’t Verify">
          {message}
        </Badge>
        <button
          onClick={verify}
          className="mt-2 text-xs text-[#00ffea] underline underline-offset-2"
        >
          Try again
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={verify}
      disabled={state === 'checking'}
      className="mt-3 inline-flex items-center gap-2 rounded-lg border-2 border-[#00ffd5]/50 px-3 py-1.5 text-xs font-semibold text-[#00ffea] transition hover:bg-[#00ffd5]/10 disabled:opacity-50"
    >
      {state === 'checking' ? (
        <>
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> Verifying…
        </>
      ) : (
        <>
          <ShieldCheck className="h-3.5 w-3.5" /> Verify Report
        </>
      )}
    </button>
  )
}

function Badge({ tone, icon: Icon, title, children }) {
  const tones = {
    ok: 'border-emerald-400/50 bg-emerald-500/10 text-emerald-300',
    bad: 'border-red-400/50 bg-red-500/10 text-red-200',
    muted: 'border-white/15 bg-white/5 text-white/60',
  }
  return (
    <div className={`mt-3 rounded-lg border px-3 py-2 text-xs ${tones[tone]}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        <Icon className="h-4 w-4" /> {title}
      </div>
      {children && <div className="mt-1 text-white/70">{children}</div>}
    </div>
  )
}

function ViewLink({ url }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="mt-1 inline-flex items-center gap-1 text-[#00ffea] underline underline-offset-2"
    >
      <FileText className="h-3.5 w-3.5" /> View report PDF
    </a>
  )
}
