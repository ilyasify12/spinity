import { useEffect, useState } from 'react'
import { useApp } from './store/app'
import { Sidebar, type Page } from './components/Sidebar'
import { PlayerBar } from './components/PlayerBar'
import { LoginPage } from './pages/Login'
import { SearchPage } from './pages/Search'
import { LibraryPage } from './pages/Library'
import { PlaylistsPage } from './pages/Playlists'
import { DownloadsPage } from './pages/Downloads'
import { FriendsPage } from './pages/Friends'
import { SettingsPage } from './pages/Settings'
import { IconTrash } from './components/Icons'

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const user = useApp((s) => s.user)
  const init = useApp((s) => s.init)
  const toast = useApp((s) => s.toast)
  const dismissToast = useApp((s) => s.dismissToast)

  const [page, setPage] = useState<Page>('search')

  // Restore the session and start listening for main-process events.
  useEffect(() => {
    void init()
  }, [init])

  // Toasts auto-dismiss so they never pile up.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => dismissToast(), toast.kind === 'error' ? 9000 : 3500)
    return () => clearTimeout(timer)
  }, [toast, dismissToast])

  if (!ready) {
    return (
      <div className="login-wrap">
        <span className="hint">Starting Spinity…</span>
      </div>
    )
  }

  if (!user) return <LoginPage />

  return (
    <div className="app">
      <Sidebar page={page} onNavigate={setPage} />

      <main className="main">
        {page === 'search' && <SearchPage />}
        {page === 'library' && <LibraryPage />}
        {page === 'playlists' && <PlaylistsPage />}
        {page === 'downloads' && <DownloadsPage />}
        {page === 'friends' && <FriendsPage />}
        {page === 'settings' && <SettingsPage />}
      </main>

      <PlayerBar />

      {toast && (
        <div
          className={`toast${toast.kind === 'error' ? ' error' : ''}`}
          onClick={dismissToast}
          role="status"
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ flex: 1 }}>{toast.message}</span>
            {toast.kind === 'error' && <IconTrash size={13} />}
          </div>
        </div>
      )}
    </div>
  )
}
