import { useEffect, useState } from 'react'
import { spiralPath } from '../lib/spiral'
import { t } from '../lib/i18n'

/**
 * Boot screen.
 *
 * Shown from the first paint until the main process has restored the session
 * and the library, then faded out over the app so there is no flash between the
 * two. The mark is the Spinity spiral, drawn with `pathLength`-normalised stroke
 * offsets — it doubles as the progress indicator, so the screen never looks
 * stuck even while a large library loads.
 */

/** Phase captions with the moment each becomes the most honest description. */
const PHASES: { at: number; key: string; en: string }[] = [
  { at: 0, key: 'boot.starting', en: 'Starting Spinity…' },
  { at: 350, key: 'boot.session', en: 'Restoring your session…' },
  { at: 900, key: 'boot.library', en: 'Loading your library…' },
  { at: 2200, key: 'boot.almost', en: 'Almost there…' },
  { at: 6000, key: 'boot.slow', en: 'Large library — this can take a moment.' }
]

/**
 * Archimedean spiral as an SVG path, matching the Spinity mark.
 * Generated once at module load (see lib/spiral.ts for the maths).
 */
const SPIRAL = spiralPath()

export function BootScreen({ done, onHidden }: { done: boolean; onHidden: () => void }): React.JSX.Element {
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const timers = PHASES.slice(1).map((step, index) => window.setTimeout(() => setPhase(index + 1), step.at))
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  // Fade out first, then unmount — the app underneath is already rendered, so
  // this reads as a reveal rather than a swap.
  useEffect(() => {
    if (!done) return
    const timer = window.setTimeout(onHidden, 280)
    return () => window.clearTimeout(timer)
  }, [done, onHidden])

  const current = PHASES[phase]

  return (
    <div className={`boot-screen${done ? ' leaving' : ''}`} role="status" aria-live="polite">
      <div className="boot-stack">
        <svg className="boot-mark" viewBox="0 0 100 100" aria-hidden="true">
          <circle className="boot-disc" cx="50" cy="50" r="47" />
          <path className="boot-spiral" d={SPIRAL} pathLength={1} />
        </svg>

        <div className="boot-word">
          Spin<i>i</i>ty
        </div>

        <div className="boot-bar" aria-hidden="true">
          <span />
        </div>

        <p className="boot-status">{t(current.key, current.en)}</p>
      </div>

      <p className="boot-foot">{t('boot.tagline', 'Local-first music · your files stay on this PC')}</p>
    </div>
  )
}
