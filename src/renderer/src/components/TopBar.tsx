import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useApp } from '../store/app'
import { useSocial } from '../store/social'
import { useUi } from '../store/ui'
import { usePlayer } from '../player/engine'
import { normalizeText } from '../lib/search'
import { t } from '../lib/i18n'
import { ACCENTS, AVATAR_BGS, avatarSrc } from '../lib/profile'
import { TrackArtwork } from './TrackArtwork'
import { NotificationsPanel } from './NotificationsPanel'
import { IconKeyboard } from './Icons'
import type { Page } from './Sidebar'

interface TopBarProps {
  /** Page caption, shown centred in the bar. */
  title: string
  onHome: () => void
  onSearch: () => void
  onNavigate: (page: Page) => void
  homeActive: boolean
  onFriends: () => void
  canBack: boolean
  canForward: boolean
  onBack: () => void
  onForward: () => void
}

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/**
 * Custom window chrome + search + profile.
 *
 * The native frame is off (`frame: false` in main), so this bar owns dragging
 * (`-webkit-app-region: drag` in CSS), nav history, window controls, live
 * search suggestions and the profile menu. Every interactive child is
 * explicitly `no-drag` so clicks still land.
 */
export function TopBar({ title, onHome, onSearch, onNavigate, homeActive, onFriends, canBack, canForward, onBack, onForward }: TopBarProps): React.JSX.Element {
  const user = useApp((s) => s.user)
  const logout = useApp((s) => s.logout)
  const updateDisplayName = useApp((s) => s.updateDisplayName)
  const setAvatar = useApp((s) => s.setAvatar)
  const removeAvatar = useApp((s) => s.removeAvatar)
  const tracks = useApp((s) => s.tracks)
  const playlists = useApp((s) => s.playlists)
  const avatarBg = useApp((s) => s.avatarBg)
  const accent = useApp((s) => s.accent)
  const setAvatarBg = useApp((s) => s.setAvatarBg)
  const setAccent = useApp((s) => s.setAccent)

  const [q, setQ] = useState('')
  const [focused, setFocused] = useState(false)
  const [hi, setHi] = useState(-1)
  const inputRef = useRef<HTMLInputElement>(null)

  const [maxed, setMaxed] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const [notifOpen, setNotifOpen] = useState(false)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [appVersion, setAppVersion] = useState<string | null>(null)

  const connected = useSocial((s) => s.connected)
  const onlineMe = useSocial((s) => s.me)
  // Live notification count: friend requests + unread messages + active
  // downloads + party invites.
  const unreadSum = useSocial((s) => s.conversations.reduce((a, c) => a + (c.unread ?? 0), 0))
  const requestCount = useSocial((s) => s.incoming.length)
  const inviteCount = useSocial((s) => s.partyInvites.length)
  const activeDl = useApp((s) => s.jobs.filter((j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting').length)
  const notifCount = unreadSum + requestCount + inviteCount + activeDl

  useEffect(() => {
    void window.spinity.window.isMaximized().then(setMaxed).catch(() => {})
    const off = window.spinity.events.onMaximizeChanged(setMaxed)
    // Ctrl+K from anywhere jumps to search.
    const focus = (): void => {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
    window.addEventListener('spinity:focus-search', focus)
    return () => {
      off()
      window.removeEventListener('spinity:focus-search', focus)
    }
  }, [])

  // Escape closes the profile menu and the notification center.
  useEffect(() => {
    if (!profileOpen && !notifOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') { setProfileOpen(false); setNotifOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [profileOpen])

  useEffect(() => {
    if (profileOpen) {
      setNameDraft(user?.displayName ?? '')
      setEditingName(false)
      void window.spinity.updater.getVersion().then(setAppVersion).catch(() => {})
    }
  }, [profileOpen, user?.displayName])

  // ---- suggestions ----
  const debounced = useDebounced(q.trim(), 150)
  const sugg = useMemo(() => {
    const needle = normalizeText(debounced)
    if (needle.length < 2) return { tracks: [] as typeof tracks, playlists: [] as typeof playlists }
    const words = needle.split(' ').filter(Boolean)
    const hit = (text: string): boolean => {
      const hay = normalizeText(text)
      return words.every((w) => hay.includes(w))
    }
    return {
      tracks: tracks.filter((track) => hit(`${track.title} ${track.artist}`)).slice(0, 6),
      playlists: playlists.filter((p) => hit(p.name)).slice(0, 3)
    }
  }, [debounced, tracks, playlists])
  const showSugg = focused && q.trim().length >= 2
  const flatCount = sugg.tracks.length + sugg.playlists.length + 1 // +1 YouTube row

  useEffect(() => { setHi(-1) }, [debounced])

  function playTrack(id: string): void {
    const idx = tracks.findIndex((track) => track.id === id)
    if (idx >= 0) usePlayer.getState().playQueue(tracks, idx)
    setFocused(false)
    inputRef.current?.blur()
  }

  function submit(e: FormEvent): void {
    e.preventDefault()
    const trimmed = q.trim()
    if (!trimmed) return
    setFocused(false)
    inputRef.current?.blur()
    // Carry the query into the Search page so its input shows what was typed
    // (they used to drift: results arrived while the page input read empty).
    useApp.getState().setSearchQuery(trimmed)
    onSearch()
    void useApp.getState().search(trimmed)
  }

  function onSearchKey(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      setFocused(false)
      inputRef.current?.blur()
      return
    }
    if (!showSugg) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHi((h) => (h + 1) % flatCount)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHi((h) => (h - 1 + flatCount) % flatCount)
    } else if (e.key === 'Enter' && hi >= 0) {
      // Let the form submit handle it, but route to the highlighted item.
      e.preventDefault()
      if (hi < sugg.tracks.length) playTrack(sugg.tracks[hi].id)
      else if (hi < sugg.tracks.length + sugg.playlists.length) {
        const pl = sugg.playlists[hi - sugg.tracks.length]
        setFocused(false)
        onNavigate('playlists')
        void pl
      } else {
        submit(e)
      }
    }
  }

  async function saveName(): Promise<void> {
    const clean = nameDraft.trim()
    if (!clean || clean === user?.displayName) { setEditingName(false); return }
    setSavingName(true)
    try {
      await updateDisplayName(clean)
      setEditingName(false)
    } catch {}
    finally { setSavingName(false) }
  }

  const ytHi = hi === flatCount - 1
  const pic = avatarSrc(user)

  function toggleMax(): void {
    void window.spinity.window.toggleMaximize().then(setMaxed).catch(() => {})
  }

  return (
    <header
      className="sp-topbar"
      onDoubleClick={(e) => {
        // Double-click empty bar space toggles maximize (never on buttons).
        if ((e.target as HTMLElement).closest('button, input, form, .sp-sugg, .sp-menu')) return
        toggleMax()
      }}
    >
      <button className="sp-nav-arrow" title={t('nav.back', 'Back')} aria-label={t('nav.back', 'Back')} onClick={onBack} disabled={!canBack} style={!canBack ? { opacity: 0.35 } : undefined}>
        <svg className="ico-back" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 5l-7 7 7 7" /></svg>
      </button>
      <button className="sp-nav-arrow" title={t('nav.forward', 'Forward')} aria-label={t('nav.forward', 'Forward')} onClick={onForward} disabled={!canForward} style={!canForward ? { opacity: 0.35 } : undefined}>
        <svg className="ico-fwd" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 5l7 7-7 7" /></svg>
      </button>

      <button className={`sp-home-btn${homeActive ? ' active' : ''}`} title={t('nav.home', 'Home')} aria-label={t('nav.home', 'Home')} onClick={onHome}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l9 8h-3v9h-4v-6H10v6H6v-9H3z" /></svg>
      </button>

      <div className="sp-search-wrap">
        <form className="sp-search-pill" onSubmit={submit}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setFocused(true) }}
            onFocus={() => setFocused(true)}
            onKeyDown={onSearchKey}
            placeholder={t('top.placeholder', 'What do you want to play?')}
            aria-label={t('top.searchMusic', 'Search music')}
            autoComplete="off"
            spellCheck={false}
          />
          {q && (
            <button type="button" className="sp-clear" aria-label={t('top.clear', 'Clear search')} onClick={() => { setQ(''); inputRef.current?.focus() }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          )}
        </form>

        {showSugg && (
          <>
            <div className="sp-sugg-backdrop" onMouseDown={() => setFocused(false)} />
            <div className="sp-sugg" role="listbox">
              {sugg.tracks.length === 0 && sugg.playlists.length === 0 ? (
                <div className="sp-sugg-empty">{t('top.noMatches', 'No local matches — press Enter to search YouTube.')}</div>
              ) : (
                <>
                  {sugg.tracks.map((track, i) => (
                    <button key={track.id} role="option" aria-selected={hi === i} className={`sp-sugg-row${hi === i ? ' hi' : ''}`} onMouseDown={() => playTrack(track.id)} onMouseEnter={() => setHi(i)}>
                      <TrackArtwork src={track.thumbnail ?? ''} className="sp-sugg-art" />
                      <span className="sp-sugg-meta">
                        <span className="sp-sugg-title">{track.title}</span>
                        <span className="sp-sugg-sub">{track.artist} · {t('top.library', 'Library')}</span>
                      </span>
                    </button>
                  ))}
                  {sugg.playlists.map((p, j) => {
                    const idx = sugg.tracks.length + j
                    return (
                      <button key={p.id} role="option" aria-selected={hi === idx} className={`sp-sugg-row${hi === idx ? ' hi' : ''}`} onMouseDown={() => { setFocused(false); onNavigate('playlists') }} onMouseEnter={() => setHi(idx)}>
                        <span className="sp-sugg-art">▤</span>
                        <span className="sp-sugg-meta">
                          <span className="sp-sugg-title">{p.name}</span>
                          <span className="sp-sugg-sub">{t('lib.playlist', 'Playlist')} · {p.trackIds.length} {p.trackIds.length === 1 ? t('lib.song', 'song') : t('lib.songs', 'songs')}</span>
                        </span>
                      </button>
                    )
                  })}
                </>
              )}
              <button type="button" className={`sp-sugg-row sp-sugg-yt${ytHi ? ' hi' : ''}`} onMouseDown={submit} onMouseEnter={() => setHi(flatCount - 1)}>
                <span className="sp-sugg-art">▶</span>
                <span className="sp-sugg-meta">
                  <span className="sp-sugg-title">{t('top.searchYoutube', 'Search YouTube for')} “{q.trim()}”</span>
                </span>
              </button>
            </div>
          </>
        )}
      </div>

      <div className="sp-topbar-title" aria-hidden="true">{title}</div>

      <div className="sp-topbar-right">
        <button
          className="sp-icon-btn"
          title={t('sc.title', 'Keyboard shortcuts')}
          aria-label={t('sc.title', 'Keyboard shortcuts')}
          onClick={() => useUi.getState().setHelpOpen(true)}
        >
          <IconKeyboard size={16} />
        </button>

        <div className="sp-notif-wrap">
          <button className="sp-icon-btn" title={t('top.notifications', 'Notifications')} aria-label={t('top.notifications', 'Notifications')} aria-haspopup="menu" onClick={() => { setNotifOpen((v) => !v); setProfileOpen(false) }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 01-3.4 0" /></svg>
            {notifCount > 0 && <span className="sp-notif-count">{notifCount > 99 ? '99+' : notifCount}</span>}
          </button>
          {notifOpen && (
            <>
              <div className="sp-sugg-backdrop" onMouseDown={() => setNotifOpen(false)} />
              <NotificationsPanel
                onClose={() => setNotifOpen(false)}
                onOpenFriends={onFriends}
                onOpenDownloads={() => onNavigate('downloads')}
              />
            </>
          )}
        </div>

        <div className="sp-profile-wrap">
          <button className="sp-avatar-btn" title={t('top.profile', 'Profile')} aria-label={t('top.profile', 'Profile')} aria-haspopup="menu" onClick={() => setProfileOpen((v) => !v)}>
            {pic
              ? <img className="avatar-img" src={pic} alt="" />
              : <span className="avatar" style={{ background: avatarBg }}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</span>}
          </button>
          {profileOpen && (
            <>
              <div className="sp-sugg-backdrop" onMouseDown={() => setProfileOpen(false)} />
              <div className="sp-menu" role="menu">
                <div className="sp-menu-head">
                  {pic
                    ? <img className="avatar-img lg" src={pic} alt="" />
                    : <span className="avatar lg" style={{ background: avatarBg }}>{(user?.displayName ?? '?').slice(0, 1).toUpperCase()}</span>}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    {editingName ? (
                      <input
                        className="sp-name-input"
                        value={nameDraft}
                        autoFocus
                        maxLength={40}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveName()
                          if (e.key === 'Escape') setEditingName(false)
                        }}
                        onBlur={() => void saveName()}
                        aria-label={t('top.displayName', 'Display name')}
                      />
                    ) : (
                      <button className="sp-name" title={t('top.clickToEdit', 'Click to edit')} onClick={() => setEditingName(true)}>
                        {user?.displayName} <span className="hint">✎</span>
                      </button>
                    )}
                    <div className="hint">@{user?.username} · {t('top.thisPC', 'this PC')}{savingName ? ` · ${t('top.saving', 'saving…')}` : ''}</div>
                  </div>
                </div>

                <div className="sp-menu-section">
                  {connected ? (
                    <div className="hint">{t('top.onlineAs', 'Online as')} <strong>{onlineMe?.displayName ?? onlineMe?.username}</strong> · <span className={`presence-dot ${onlineMe?.status ?? 'online'}`} style={{ display: 'inline-block' }} /></div>
                  ) : (
                    <div className="hint">{t('top.offline', 'Offline — reconnecting…')}</div>
                  )}
                </div>

                <div className="sp-menu-section">
                  <button className="sp-menu-row" onClick={() => { setProfileOpen(false); onNavigate('settings') }}>{t('nav.settings', 'Settings')}</button>
                  <button className="sp-menu-row danger" onClick={() => { setProfileOpen(false); void logout() }}>{t('nav.logout', 'Sign out')}</button>
                </div>

                <div className="sp-menu-section">
                  <div className="hint" style={{ padding: '6px 12px 2px' }}>{t('top.picture', 'Picture')} <span className="hint">(JPG, PNG, GIF)</span></div>
                  <div style={{ display: 'flex', gap: 8, padding: '2px 12px 8px' }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => void setAvatar()}>{t('top.upload', 'Upload…')}</button>
                    {pic && <button className="btn btn-ghost btn-sm" onClick={() => void removeAvatar()}>{t('action.remove', 'Remove')}</button>}
                  </div>
                  <div className="hint" style={{ padding: '6px 12px 2px' }}>{t('top.avatarColor', 'Avatar color')} <span className="hint">{t('top.whenNoPic', '(when no picture)')}</span></div>
                  <div className="sp-swatches">
                    {AVATAR_BGS.map((bg) => (
                      <button
                        key={bg}
                        className={`sp-swatch${avatarBg === bg ? ' sel' : ''}`}
                        style={{ background: bg }}
                        title={t('top.avatarStyle', 'Avatar style')}
                        aria-label={t('top.avatarStyle', 'Avatar style')}
                        onClick={() => setAvatarBg(bg)}
                      />
                    ))}
                  </div>
                  <div className="hint" style={{ padding: '8px 12px 2px' }}>{t('top.themeColor', 'Theme color')}</div>
                  <div className="sp-swatches">
                    {ACCENTS.map((a) => (
                      <button
                        key={a.value}
                        className={`sp-swatch${accent === a.value ? ' sel' : ''}`}
                        style={{ background: a.value }}
                        title={a.name}
                        aria-label={`${t('top.theme', 'Theme')} ${a.name}`}
                        onClick={() => setAccent(a.value)}
                      />
                    ))}
                  </div>
                </div>

                <div className="hint" style={{ padding: '4px 12px 8px' }}>Spinity {appVersion ?? '…'} · {t('top.tagline', 'local-first music')}</div>
              </div>
            </>
          )}
        </div>

        <div className="sp-win-sep" />
        <div className="sp-win-controls" role="group" aria-label={t('top.window', 'Window')}>
          <button title={t('top.minimize', 'Minimize')} aria-label={t('top.minimize', 'Minimize')} onClick={() => void window.spinity.window.minimize()}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M1 6h10" /></svg>
          </button>
          <button title={maxed ? t('top.restore', 'Restore') : t('top.maximize', 'Maximize')} aria-label={maxed ? t('top.restore', 'Restore') : t('top.maximize', 'Maximize')} onClick={toggleMax}>
            {maxed
              ? <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="3" y="1" width="8" height="8" /><path d="M1 4V11H8" /></svg>
              : <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2"><rect x="1.5" y="1.5" width="9" height="9" /></svg>}
          </button>
          <button className="close" title={t('top.close', 'Close')} aria-label={t('top.close', 'Close')} onClick={() => void window.spinity.window.close()}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"><path d="M1 1l10 10M11 1L1 11" /></svg>
          </button>
        </div>
      </div>
    </header>
  )
}
