import { useState, type FormEvent } from 'react'
import { useApp } from '../store/app'

type Mode = 'signin' | 'create'

/**
 * Local account gate. There is no server: accounts live in
 * `%APPDATA%/spinity/spinity.json` with scrypt-hashed passwords, so this is
 * closer to "profiles on a shared PC" than to a real online account system.
 */
export function LoginPage(): React.JSX.Element {
  const users = useApp((s) => s.users)
  const register = useApp((s) => s.register)
  const login = useApp((s) => s.login)

  const [mode, setMode] = useState<Mode>(users.length > 0 ? 'signin' : 'create')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent): Promise<void> {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'create') await register(username, password, displayName)
      else await login(username, password)
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
        <div className="brand" style={{ padding: '0 0 16px' }}>
          <span>Spinity</span>
        </div>

        <div className="legal">
          <strong>Use responsibly.</strong> Spinity downloads audio from YouTube for
          local playback. Downloading content you do not have the rights to breaks
          YouTube&apos;s Terms of Service and may infringe copyright. Use it for your own
          uploads, Creative Commons, public-domain, or licensed material. You are
          responsible for what you download.
        </div>

        {mode === 'signin' && users.length > 0 && (
          <div className="field">
            <label>Existing accounts on this PC</label>
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              <option value="">Select an account…</option>
              {users.map((u) => (
                <option key={u.id} value={u.username}>
                  {u.displayName} ({u.username})
                </option>
              ))}
            </select>
          </div>
        )}

        <form onSubmit={submit}>
          {mode === 'create' && (
            <>
              <div className="field">
                <label htmlFor="username">Username</label>
                <input
                  id="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="e.g. ilyas"
                  autoFocus
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="displayName">Display name (optional)</label>
                <input
                  id="displayName"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Shown in the sidebar"
                />
              </div>
            </>
          )}

          {mode === 'signin' && (
            <div className="field">
              <label htmlFor="username2">Username</label>
              <input
                id="username2"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoFocus
                required
              />
            </div>
          )}

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'create' ? 'At least 6 characters' : ''}
              required
            />
          </div>

          {error && <p className="error-text">{error}</p>}

          <button className="btn" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Please wait…' : mode === 'create' ? 'Create account' : 'Sign in'}
          </button>
        </form>

        <p className="hint" style={{ marginTop: 16, textAlign: 'center' }}>
          {mode === 'create' ? 'Already have an account?' : 'No account yet?'}{' '}
          <button
            className="hint"
            style={{ color: 'var(--accent)', fontWeight: 700 }}
            onClick={() => {
              setMode(mode === 'create' ? 'signin' : 'create')
              setError(null)
            }}
          >
            {mode === 'create' ? 'Sign in' : 'Create one'}
          </button>
        </p>

        <p className="hint" style={{ marginTop: 10, textAlign: 'center', fontSize: 11.5 }}>
          Spinity remembers your sign-in on this computer by default and reopens
          your account next time. Sign out using Exit in the sidebar to clear
          the saved login, especially on a shared PC.
        </p>
        <p className="hint" style={{ marginTop: 10, textAlign: 'center', fontSize: 11.5 }}>
          Accounts are stored only on this computer. Downloads are kept in your
          AppData folder; local music stays in the folders you choose. Nothing
          is uploaded anywhere.
        </p>
      </div>
    </div>
  )
}
