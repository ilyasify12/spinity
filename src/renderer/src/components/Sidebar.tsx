import { useApp } from '../store/app'
import {
  IconDownload,
  IconLibrary,
  IconPlaylist,
  IconSearch,
  IconSettings,
  IconUsers
} from './Icons'

export type Page = 'search' | 'library' | 'playlists' | 'downloads' | 'friends' | 'settings'

interface SidebarProps {
  page: Page
  onNavigate: (page: Page) => void
}

const NAV: { id: Page; label: string; icon: React.JSX.Element }[] = [
  { id: 'search', label: 'Search', icon: <IconSearch /> },
  { id: 'library', label: 'Library', icon: <IconLibrary /> },
  { id: 'playlists', label: 'Playlists', icon: <IconPlaylist /> },
  { id: 'downloads', label: 'Downloads', icon: <IconDownload /> },
  { id: 'friends', label: 'Friends', icon: <IconUsers /> },
  { id: 'settings', label: 'Settings', icon: <IconSettings /> }
]

export function Sidebar({ page, onNavigate }: SidebarProps): React.JSX.Element {
  const user = useApp((s) => s.user)
  const playlists = useApp((s) => s.playlists)
  const tracks = useApp((s) => s.tracks)
  const jobs = useApp((s) => s.jobs)
  const logout = useApp((s) => s.logout)
  // Friends badge — injected via window event count; keep simple
  const friendsBadge = ((): number => {
    try { return Number(sessionStorage.getItem('spinity:friendsBadge') ?? 0) } catch { return 0 }
  })()

  // Anything still in flight, for the Downloads badge.
  const activeJobs = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
  ).length

  return (
    <aside className="sidebar">
      <div className="brand">
        <span>Spinity</span>
      </div>

      {NAV.map((item) => (
        <button
          key={item.id}
          className={`nav-btn${page === item.id ? ' active' : ''}`}
          onClick={() => onNavigate(item.id)}
        >
          {item.icon}
          {item.label}
          {item.id === 'downloads' && activeJobs > 0 && (
            <span className="nav-badge">{activeJobs}</span>
          )}
          {item.id === 'friends' && friendsBadge > 0 && (
            <span className="nav-badge alert">{friendsBadge}</span>
          )}
        </button>
      ))}

      <div className="sidebar-section">Your music</div>
      <div className="hint" style={{ padding: '0 12px' }}>
        {tracks.length} track{tracks.length === 1 ? '' : 's'} · {playlists.length} playlist
        {playlists.length === 1 ? '' : 's'}
      </div>

      <div className="sidebar-user">
        <span className="avatar">
          {(user?.displayName ?? '?').slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 13 }}>{user?.displayName}</div>
          <div className="hint" style={{ fontSize: 11 }}>
            local account
          </div>
        </div>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => void logout()}
          title="Sign out"
        >
          Exit
        </button>
      </div>
    </aside>
  )
}
