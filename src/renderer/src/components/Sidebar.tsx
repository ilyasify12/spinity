import { useMemo, useState } from 'react'
import { useApp } from '../store/app'
import { useSocial } from '../store/social'
import { useUi } from '../store/ui'
import { usePlayer } from '../player/engine'
import { TrackArtwork } from './TrackArtwork'
import { openContextMenu, type MenuItem } from './ContextMenu'
import { t } from '../lib/i18n'
import type { Track } from '@shared/types'
import {
  IconDownload,
  IconHome,
  IconLibrary,
  IconPlaylist,
  IconSearch,
  IconUsers,
  IconPlus
} from './Icons'

export type Page = 'home' | 'search' | 'playlists' | 'downloads' | 'friends' | 'settings'

interface SidebarProps {
  page: Page
  onNavigate: (page: Page) => void
}

/** Primary nav — the two destinations the redesign puts front and centre. */
const NAV: { id: Page; label: string; icon: React.JSX.Element }[] = [
  { id: 'home', label: 'Home', icon: <IconHome /> },
  { id: 'search', label: 'Search', icon: <IconSearch /> }
]

/** Secondary nav — quieter, but every page stays reachable.
 *  Settings is deliberately absent: it lives in the profile menu instead. */
const NAV_MORE: { id: Page; label: string; icon: React.JSX.Element }[] = [
  { id: 'downloads', label: 'Downloads', icon: <IconDownload /> },
  { id: 'friends', label: 'Friends', icon: <IconUsers /> }
]

interface RailRow {
  id: string
  title: string
  sub: string
  art?: string
  tile?: React.JSX.Element
  updatedAt: number
  userMade: boolean
}

/** Live friends badge (requests + unread) — event-driven, no polling. */
function FriendsDot(): React.JSX.Element | null {
  const incoming = useSocial((s) => s.incoming.length)
  const unread = useSocial((s) => s.conversations.reduce((a, c) => a + (c.unread ?? 0), 0))
  const total = incoming + unread
  if (total <= 0) return null
  return <span className="nav-badge alert">{total > 99 ? '99+' : total}</span>
}

/** Left rail: nav card + Spotify-style Your Library card. */
export function Sidebar({ page, onNavigate }: SidebarProps): React.JSX.Element {
  const user = useApp((s) => s.user)
  const playlists = useApp((s) => s.playlists)
  const tracks = useApp((s) => s.tracks)
  const likedIds = useApp((s) => s.likedIds)
  const jobs = useApp((s) => s.jobs)
  const createPlaylist = useApp((s) => s.createPlaylist)
  const deletePlaylist = useApp((s) => s.deletePlaylist)
  const openPlaylist = useUi((s) => s.openPlaylist)
  const selectedPlaylist = useUi((s) => s.selectedPlaylist)
  const railCollapsed = useUi((s) => s.railCollapsed)
  const toggleRail = useUi((s) => s.toggleRail)
  const playQueue = usePlayer((s) => s.playQueue)
  const toggleShuffle = usePlayer((s) => s.toggleShuffle)

  const byId = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])

  const [filter, setFilter] = useState('')
  const [sortAZ, setSortAZ] = useState(false)

  const activeJobs = useMemo(() => jobs.filter(
    (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
  ).length, [jobs])

  const localCount = useMemo(() => tracks.filter((t) => t.source === 'local').length, [tracks])

  /**
   * Built-in shelves stay pinned at the top; the user's own playlists sit
   * below a divider so the rail reads like the redesign.
   */
  const { builtins, userRows } = useMemo<{ builtins: RailRow[]; userRows: RailRow[] }>(() => {
    const owner = user?.displayName ?? t('common.you', 'You')
    const subLine = (n: number, one: string, many: string): string =>
      `${t('lib.playlist', 'Playlist')} • ${n} ${n === 1 ? one : many}`
    const pin: RailRow[] = [
      {
        id: 'liked',
        title: t('lib.likedSongs', 'Liked Songs'),
        sub: subLine(likedIds.length, t('lib.likedSong', 'liked song'), t('lib.likedSongsN', 'liked songs')),
        tile: (
          <span className="sp-lib-tile-liked">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M19 14c1.5-1.5 3-3.2 3-5.5A4.5 4.5 0 0017.5 4c-1.8 0-3.4 1-4.2 2.4h-2.6C9.9 5 8.3 4 6.5 4A4.5 4.5 0 002 8.5c0 2.3 1.5 4 3 5.5l7 7z" /></svg>
          </span>
        ),
        updatedAt: Number.MAX_SAFE_INTEGER,
        userMade: false
      },
      {
        id: 'local',
        title: t('lib.localFiles', 'Local files'),
        sub: subLine(localCount, t('lib.track', 'track'), t('lib.tracks', 'tracks')),
        tile: (
          <span className="sp-lib-tile-local">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" /></svg>
          </span>
        ),
        updatedAt: Number.MAX_SAFE_INTEGER - 1,
        userMade: false
      },
      {
        id: 'all',
        title: t('lib.allSongs', 'All songs'),
        sub: subLine(tracks.length, t('lib.song', 'song'), t('lib.songs', 'songs')),
        tile: (
          <span className="sp-lib-tile-all">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M9 18.5a3 3 0 11-2-2.8V6.2l10-2.1v9.2a3 3 0 11-2-2.8V7.4L9 8.6z" /></svg>
          </span>
        ),
        updatedAt: Number.MAX_SAFE_INTEGER - 2,
        userMade: false
      }
    ]

    const mine: RailRow[] = playlists.map((p) => ({
      id: p.id,
      title: p.name,
      sub: `${t('lib.playlist', 'Playlist')} • ${owner}`,
      art: p.trackIds.map((id) => byId.get(id)?.thumbnail).find(Boolean),
      updatedAt: p.updatedAt,
      userMade: true
    }))

    const needle = filter.trim().toLowerCase()
    const match = (r: RailRow): boolean => !needle || r.title.toLowerCase().includes(needle)
    const byOrder = (a: RailRow, b: RailRow): number =>
      sortAZ ? a.title.localeCompare(b.title) : b.updatedAt - a.updatedAt

    return {
      builtins: pin.filter(match),
      userRows: mine.filter(match).sort(byOrder)
    }
  }, [playlists, byId, likedIds, localCount, user?.displayName, filter, sortAZ])

  /** Artwork tile, then virtual gradient tile, then a neutral playlist glyph. */
  const artOf = (r: RailRow): React.JSX.Element =>
    r.tile ?? (r.art
      // TrackArtwork, not a bare <img>: a playlist holding cover-less local
      // files otherwise paints Chromium's torn-picture glyph in the rail.
      ? <TrackArtwork src={r.art} className="sp-lib-art" />
      : <IconPlaylist size={20} />)

  const renderLibRow = (r: RailRow): React.JSX.Element => (
    <button
      key={r.id}
      className={`sp-lib-row${selectedPlaylist === r.id && page === 'playlists' ? ' active' : ''}`}
      onClick={() => open(r.id)}
      onContextMenu={(e) => openContextMenu(e, rowMenu(r))}
      title={r.title}
    >
      <span className="sp-lib-art">{artOf(r)}</span>
      <span className="sp-lib-meta">
        <span className={`sp-lib-title${r.id === 'liked' ? ' liked-title' : ''}`}>{r.title}</span>
        <br />
        <span className="sp-lib-sub">{r.sub}</span>
      </span>
    </button>
  )

  function open(id: string): void {
    openPlaylist(id)
    onNavigate('playlists')
  }

  /** Tracks behind a rail row (virtual shelves + user playlists). */
  function rowTracks(rowId: string): Track[] {
    if (rowId === 'liked') {
      return likedIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t))
    }
    if (rowId === 'local') return tracks.filter((t) => t.source === 'local')
    if (rowId === 'all') return tracks
    const pl = playlists.find((p) => p.id === rowId)
    if (!pl) return []
    return pl.trackIds.map((id) => byId.get(id)).filter((t): t is Track => Boolean(t))
  }

  function rowMenu(r: RailRow): MenuItem[] {
    const list = rowTracks(r.id)
    const play = (shuffled: boolean): void => {
      if (list.length === 0) return
      if (shuffled && !usePlayer.getState().shuffle) toggleShuffle()
      open(r.id)
      playQueue(list, 0)
    }
    if (!r.userMade) {
      return [{ label: t('ctx.play', 'Play'), disabled: list.length === 0, onSelect: () => play(false) }]
    }
    return [
      { label: t('ctx.play', 'Play'), disabled: list.length === 0, onSelect: () => play(false) },
      { label: t('ctx.shufflePlay', 'Shuffle play'), disabled: list.length === 0, onSelect: () => play(true) },
      {
        label: t('ctx.rename', 'Rename'),
        onSelect: () => {
          open(r.id)
          window.dispatchEvent(new CustomEvent('spinity:rename-playlist'))
        }
      },
      { label: t('ctx.deletePlaylist', 'Delete playlist'), danger: true, onSelect: () => void deletePlaylist(r.id) }
    ]
  }

  if (railCollapsed) {
    return (
      <aside className="sp-rail collapsed">
        <div className="sp-rail-card">
          {[...NAV, ...NAV_MORE].map((item) => (
            <button
              key={item.id}
              className={`nav-btn${page === item.id ? ' active' : ''}`}
              title={t('nav.' + item.id, item.label)}
              onClick={() => onNavigate(item.id)}
              style={{ justifyContent: 'center' }}
            >
              {item.icon}
            </button>
          ))}
        </div>
        <div className="sp-library">
          <button className="sp-library-head" title={t('lib.expand', 'Expand Your Library')} onClick={toggleRail} style={{ justifyContent: 'center' }}>
            <IconLibrary size={18} />
          </button>
          <div className="sp-library-list">
            {[...builtins, ...userRows].slice(0, 12).map((r) => (
              <button key={r.id} className="sp-lib-row" title={r.title} onClick={() => open(r.id)} style={{ justifyContent: 'center' }}>
                <span className="sp-lib-art">{artOf(r)}</span>
              </button>
            ))}
          </div>
        </div>
      </aside>
    )
  }

  return (
    <aside className="sp-rail">
      <div className="sp-rail-card">
        {NAV.map((item) => (
          <button
            key={item.id}
            className={`nav-btn${page === item.id ? ' active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            {item.icon}
            {t('nav.' + item.id, item.label)}
          </button>
        ))}

        <div className="sp-rail-more">
          {NAV_MORE.map((item) => (
            <button
              key={item.id}
              className={`nav-btn sm${page === item.id ? ' active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon}
              {t('nav.' + item.id, item.label)}
              {item.id === 'downloads' && activeJobs > 0 && (
                <span className="nav-badge">{activeJobs}</span>
              )}
              {item.id === 'friends' && <FriendsDot />}
            </button>
          ))}
        </div>
      </div>

      <div className="sp-library">
        <div className="sp-library-head">
          <span className="sp-lib-label">{t('lib.yourLibrary', 'Your Library')}</span>
          <button className="sp-rail-toggle" title={t('lib.collapse', 'Collapse Your Library')} aria-label={t('lib.collapseShort', 'Collapse library')} onClick={toggleRail}>
            <IconLibrary size={16} />
          </button>
          <button
            className="sp-add-btn"
            title={t('lib.createPlaylist', 'Create playlist')}
            aria-label={t('lib.createPlaylist', 'Create playlist')}
            onClick={() => void (async () => {
              const created = await createPlaylist(`${t('lib.myPlaylist', 'My Playlist')} #${playlists.length + 1}`)
              if (created) {
                open(created.id)
                // Drop straight into naming it — the detail view picks this up.
                window.dispatchEvent(new CustomEvent('spinity:rename-playlist'))
              }
            })()}
          >
            <IconPlus size={16} />
          </button>
        </div>

        <div className="sp-lib-tools">
          <span className="sp-lib-filter">
            <IconSearch size={14} />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t('lib.searchLibrary', 'Search library')}
              aria-label={t('lib.searchLibrary', 'Search library')}
            />
          </span>
          <button
            className="sp-sort"
            title={sortAZ ? t('lib.sortAZ', 'Sort: A–Z (click for Recents)') : t('lib.sortRecent', 'Sort: Recents (click for A–Z)')}
            onClick={() => setSortAZ((v) => !v)}
          >
            {sortAZ ? t('lib.az', 'A–Z') : t('lib.recents', 'Recents')}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
          </button>
        </div>

        <div className="sp-library-list">
          {builtins.map(renderLibRow)}
          {userRows.length > 0 && <div className="sp-lib-divider" />}
          {userRows.map(renderLibRow)}
          {builtins.length === 0 && userRows.length === 0 && (
            <p className="hint" style={{ padding: '4px 12px' }}>{t('lib.noMatch', 'Nothing matches')} “{filter}”.</p>
          )}
        </div>
      </div>
    </aside>
  )
}
