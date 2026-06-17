import { Link } from 'react-router-dom'
import { Compass } from 'lucide-react'
import PageTransition from '../components/PageTransition.jsx'

export default function NotFoundPage() {
  return (
    <PageTransition className="mx-auto max-w-xl px-5 py-24 text-center">
      <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-soft text-primary">
        <Compass className="h-8 w-8" />
      </div>
      <h1 className="mb-3 text-5xl font-extrabold tracking-tight text-fg">404</h1>
      <p className="mb-8 text-muted">
        This page wandered off to meditate. Let's get you back.
      </p>
      <Link
        to="/"
        className="inline-flex rounded-full bg-primary px-7 py-3 font-semibold text-primary-fg shadow-md transition-all hover:-translate-y-0.5 hover:bg-primary-hover"
      >
        Back home
      </Link>
    </PageTransition>
  )
}
