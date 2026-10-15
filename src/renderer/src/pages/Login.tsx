import { useState, type FormEvent } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../store/app'

type Mode = 'signin' | 'create'

/**
 * 1.0 cloud gate. One account (email + password) works on every computer:
 * identity, friends and chat live on the server, while downloaded music and
 * local files stay per-device. Signing in with the same username you used
 * before keeps that profile's music on this PC.
 */
export function LoginPage(): React.JSX.Element {
  const register = useApp((s) => s.register)
  const login = useApp((s) => s.login)

  const [mode, setMode] = useState<Mode>('signin')
  const [loginId, setLoginId] = useState('')
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await register(username.trim(), email.trim(), password, displayName.trim() || undefined)
      else await login(loginId.trim(), password)
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      setError(raw.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, ''))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="brand">
          <span className="brand-glyph">S</span>
          <span className="brand-name">
            Spin<i>i</i>ty
          </span>
        </div>

        <p className="hint" style={{ marginTop: 0, textAlign: 'center' }}>
          {mode === 'create'
            ? t('login.createIntro', 'One account for every computer — friends and chat follow you, music stays on each device.')
            : t('login.signinIntro', 'Welcome back — same email works on all your computers.')}
        </p>

        <form onSubmit={submit}>
          {mode === 'signin' ? (
            <div className="field">
              <label htmlFor="loginId">{t('login.emailOrUsername', 'Email or username')}</label>
              <input
                id="loginId"
                value={loginId}
                onChange={(e) => setLoginId(e.target.value)}
                placeholder={t('login.idPlaceholder', 'you@mail.com or your handle')}
                autoFocus
                required
              />
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="username">{t('login.username', 'Username')}</label>
                <input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t('login.usernamePlaceholder', 'e.g. ilyas')}
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="email">{t('login.email', 'Email')}</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder={t('login.emailPlaceholder', 'you@mail.com — same on every PC')}
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="displayName">{t('login.displayName', 'Display name (optional)')}</label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder={t('login.displayNamePlaceholder', 'Shown to friends')}
                />
              </div>
            </>
          )}

          <div className="field">
            <label htmlFor="password">{t('login.password', 'Password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'create' ? t('login.passwordPlaceholder', 'At least 6 characters') : ''}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? t('login.pleaseWait', 'Please wait…') : mode === 'create' ? t('login.createAccount', 'Create account') : t('login.signIn', 'Sign in')}
          </button>
        </form>

        <p className="hint" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'create' ? t('login.haveAccount', 'Already have an account?') : t('login.noAccount', 'No account yet?')}{' '}
          <button
            className="hint"
            style={{ color: 'var(--accent)', fontWeight: 700 }}
            onClick={() => {
              setMode(mode === 'create' ? 'signin' : 'create')
              setError(null)
            }}
          >
            {mode === 'create' ? t('login.signIn', 'Sign in') : t('login.createOne', 'Create one')}
          </button>
        </p>

        <div className="legal">
          <strong>{t('login.legalStrong', 'Use responsibly.')}</strong>{' '}
          {t('login.legalText', 'Spinity downloads audio from YouTube for local playback. Downloading content you do not have the rights to breaks YouTube’s Terms of Service and may infringe copyright. Use it for your own uploads, Creative Commons, public-domain, or licensed material. You are responsible for what you download.')}
        </div>
      </div>
    </div>
  )
}
