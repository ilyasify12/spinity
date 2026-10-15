import { useEffect } from 'react'
import { useUi } from '../store/ui'
import { SHORTCUTS } from '../lib/shortcuts'
import { t } from '../lib/i18n'
import { IconX } from './Icons'

/**
 * Keyboard cheat sheet, opened from the top bar, from Settings, or with `?`.
 *
 * It renders the exact list the key handler uses, so the panel can never
 * document a shortcut the app does not actually implement.
 */
export function ShortcutsHelp(): React.JSX.Element | null {
  const open = useUi((s) => s.helpOpen)
  const setOpen = useUi((s) => s.setHelpOpen)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setOpen])

  if (!open) return null

  return (
    <div className="sc-overlay" role="dialog" aria-modal="true" aria-label={t('sc.title', 'Keyboard shortcuts')}>
      <div className="sc-backdrop" onMouseDown={() => setOpen(false)} />
      <div className="sc-card wn-card">
        <header className="sc-head">
          <h3>{t('sc.title', 'Keyboard shortcuts')}</h3>
          <button
            className="sp-icon-btn"
            onClick={() => setOpen(false)}
            title={t('action.close', 'Close')}
            aria-label={t('action.close', 'Close')}
          >
            <IconX size={15} />
          </button>
        </header>
        <div className="sc-list">
          {SHORTCUTS.map((s) => (
            <div className="sc-row" key={s.id}>
              <span className="sc-keys">
                {s.keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
              <span className="sc-label">{t(s.labelKey, s.label)}</span>
            </div>
          ))}
        </div>
        <p className="hint sc-foot">
          {t('sc.hint', 'Shortcuts pause while you are typing in a text field.')}
        </p>
      </div>
    </div>
  )
}
