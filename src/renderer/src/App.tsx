import { Suspense, lazy, useCallback, useEffect, useState } from 'react'
import { useApp } from './store/app'
import { useSocial } from './store/social'
import { persistSession, usePlayer } from './player/engine'
import { Sidebar, type Page } from './components/Sidebar'
import { TopBar } from './components/TopBar'
import { PlayerBar } from './components/PlayerBar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { MenuHost } from './components/ContextMenu'
import { WhatsNew, useWhatsNew } from './components/WhatsNew'
import { BootScreen } from './components/BootScreen'
import { LyricsPanel } from './components/LyricsPanel'
import { ShortcutsHelp } from './components/ShortcutsHelp'
import { LoginPage } from './pages/Login'
import { IconTrash } from './components/Icons'
import { applyAccent } from './lib/profile'
import { setLang, t } from './lib/i18n'
import { useUi } from './store/ui'
import { startPartySync, onPartyState, onPartyQueue } from './player/partySync'
import { useParty } from './store/party'

// Code-split: the initial bundle stays lean (player + home shell) and each
// heavy page loads on first visit instead of at startup.
const HomePage = lazy(() => import('./pages/Home').then((m) => ({ default: m.HomePage })))
const SearchPage = lazy(() => import('./pages/Search').then((m) => ({ default: m.SearchPage })))
const PlaylistsPage = lazy(() => import('./pages/Playlists').then((m) => ({ default: m.PlaylistsPage })))
const DownloadsPage = lazy(() => import('./pages/Downloads').then((m) => ({ default: m.DownloadsPage })))
const FriendsPage = lazy(() => import('./pages/Friends').then((m) => ({ default: m.FriendsPage })))
const SettingsPage = lazy(() => import('./pages/Settings').then((m) => ({ default: m.SettingsPage })))

/** Placeholder while a lazily-loaded page bundle arrives. */
function PageFallback(): React.JSX.Element {
  return (
    <div className="page-loader" role="status" aria-live="polite">
      <span className="page-loader-ring" aria-hidden="true" />
      <span className="hint">{t('page.loading', 'Loading…')}</span>
    </div>
  )
}

/** Centred top-bar caption, mirroring the redesign's small uppercase title. */
const PAGE_TITLES: Record<Page, string> = {
  home: 'Home',
  search: 'Search',
  playlists: 'Library',
  downloads: 'Downloads',
  friends: 'Friends',
  settings: 'Settings'
}

export default function App(): React.JSX.Element {
  const ready = useApp((s) => s.ready)
  const user = useApp((s) => s.user)
  const init = useApp((s) => s.init)
  const toast = useApp((s) => s.toast)
  const dismissToast = useApp((s) => s.dismissToast)

  const [nav, setNav] = useState<{ hist: Page[]; idx: number }>({ hist: ['home'], idx: 0 })
  const page = nav.hist[nav.idx]
  const accent = useApp((s) => s.accent)
  const language = useApp((s) => s.settings.language)
  const railCollapsed = useUi((s) => s.railCollapsed)
  const lyricsOpen = useUi((s) => s.lyricsOpen)
  const whatsNew = useWhatsNew(ready, !!user)

  /**
   * The boot screen stays mounted for a beat after `ready` so it can fade out
   * over the app instead of vanishing between two frames. It never blocks
   * anything: the shell is rendered underneath and the overlay ignores pointer
   * events, so a fast start still feels instant.
   */
  const [bootVisible, setBootVisible] = useState(true)
  const [bootDone, setBootDone] = useState(false)
  const hideBoot = useCallback(() => setBootVisible(false), [])
  useEffect(() => {
    if (!ready) return
    const hold = window.setTimeout(() => setBootDone(true), 340)
    return () => window.clearTimeout(hold)
  }, [ready])

  // Language + writing direction follow the setting. Applied during render
  // (not in an effect) so the keyed remount below renders every t() call
  // against the new dictionary immediately; setLang is idempotent.
  setLang(language || 'en')

  // Saved accent theme applies to the whole UI.
  useEffect(() => {
    applyAccent(accent)
  }, [accent])

  // Flush the precise playback offset as the window goes away, so a restart
  // resumes on the same second even if a debounced write was still pending.
  useEffect(() => {
    const flush = (): void => persistSession(true)
    window.addEventListener('beforeunload', flush)
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('beforeunload', flush)
      window.removeEventListener('pagehide', flush)
    }
  }, [])

  /** In-app history so the top-bar back/forward buttons retrace visited pages. */
  function navigate(next: Page): void {
    setNav((s) => {
      if (s.hist[s.idx] === next) return s
      const hist = [...s.hist.slice(0, s.idx + 1), next].slice(-50)
      return { hist, idx: hist.length - 1 }
    })
  }
  function goBack(): void {
    setNav((s) => (s.idx > 0 ? { hist: s.hist, idx: s.idx - 1 } : s))
  }
  function goForward(): void {
    setNav((s) => (s.idx < s.hist.length - 1 ? { hist: s.hist, idx: s.idx + 1 } : s))
  }

  // Restore the session and start listening for main-process events.
  useEffect(() => {
    void init()
  }, [init])

  // Keyboard shortcuts + OS media keys + window title follow playback.
  useEffect(() => {
    const isEditable = (el: EventTarget | null): boolean => {
      const t = el as HTMLElement | null
      if (!t || typeof (t as HTMLElement).tagName !== 'string') return false
      const tag = (t as HTMLElement).tagName
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (t as HTMLElement).isContentEditable
    }
    const onKey = (e: KeyboardEvent): void => {
      if (isEditable(e.target)) return
      const st = usePlayer.getState()
      const ui = useUi.getState()
      const mod = e.ctrlKey || e.metaKey
      // Seek by 10s, Spotify-style (Shift + arrows).
      const seekBy = (delta: number): void => {
        e.preventDefault()
        st.seek(st.currentTime + delta)
      }
      if (e.code === 'Space') {
        e.preventDefault()
        st.toggle()
      } else if (e.key === 'Escape') {
        // Close whatever panel is on top; pages keep their own Esc handling.
        let closed = false
        if (ui.helpOpen) { ui.setHelpOpen(false); closed = true }
        if (ui.lyricsOpen) { ui.setLyricsOpen(false); closed = true }
        if (closed) e.preventDefault()
      } else if (mod && e.code === 'ArrowRight') {
        e.preventDefault()
        st.next()
      } else if (mod && e.code === 'ArrowLeft') {
        e.preventDefault()
        st.previous()
      } else if (e.shiftKey && e.code === 'ArrowRight') {
        seekBy(10)
      } else if (e.shiftKey && e.code === 'ArrowLeft') {
        seekBy(-10)
      } else if (mod && e.code === 'ArrowUp') {
        e.preventDefault()
        st.setVolume(st.volume + 0.05)
      } else if (mod && e.code === 'ArrowDown') {
        e.preventDefault()
        st.setVolume(st.volume - 0.05)
      } else if (mod && e.code === 'KeyK') {
        // Jump to the top-bar search from anywhere.
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('spinity:focus-search'))
      } else if (e.code === 'KeyM') {
        e.preventDefault()
        st.toggleMute()
      } else if (e.code === 'KeyS') {
        e.preventDefault()
        st.toggleShuffle()
      } else if (e.code === 'KeyR') {
        e.preventDefault()
        st.cycleRepeat()
      } else if (e.code === 'KeyL') {
        e.preventDefault()
        ui.toggleLyrics()
      } else if (e.code === 'KeyF') {
        // Like / unlike the song that is playing, like Spotify's save button.
        e.preventDefault()
        const track = st.index >= 0 ? st.queue[st.index] : undefined
        if (!track) return
        const app = useApp.getState()
        const liked = app.likedIds.includes(track.id)
        // The track doubles as the search metadata, so liking something that is
        // only streamed can still save it to the library (existing behaviour).
        void app.toggleLike(track.id, track)
        app.notify(
          liked
            ? t('toast.removedLiked', 'Removed from Liked Songs')
            : t('toast.addedLiked', 'Added to Liked Songs')
        )
      } else if (e.key === '?' || (mod && e.code === 'Slash')) {
        e.preventDefault()
        ui.setHelpOpen(!ui.helpOpen)
      }
    }
    window.addEventListener('keydown', onKey)

    // OS-level media keys / taskbar HUD.
    try {
      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', () => usePlayer.getState().toggle())
        navigator.mediaSession.setActionHandler('pause', () => usePlayer.getState().toggle())
        navigator.mediaSession.setActionHandler('previoustrack', () => usePlayer.getState().previous())
        navigator.mediaSession.setActionHandler('nexttrack', () => usePlayer.getState().next())
      }
    } catch {}

    // Mirror playback into media session + document title (single subscription).
    // Gate on identity changes: timeupdate ticks 4x/sec must not rebuild
    // MediaMetadata or touch the DOM every tick.
    let lastKey = ''
    const unsub = usePlayer.subscribe((s) => {
      const track = s.index >= 0 ? s.queue[s.index] : undefined
      const key = `${track?.id ?? ''}|${s.playing ? '1' : '0'}|${track?.thumbnail ?? ''}`
      if (key === lastKey) return
      lastKey = key
      document.title = track ? `${track.title} — ${track.artist} · Spinity` : 'Spinity'
      // Discord Rich Presence follows the same gate: one push per
      // track/play/pause change. Main no-ops when unconfigured/disabled.
      void window.spinity.presence
        .update({
          title: track?.title ?? '',
          artist: track?.artist ?? '',
          durationSec: Math.round(s.duration || track?.durationSec || 0),
          positionSec: Math.round(s.currentTime || 0),
          playing: s.playing && !!track
        })
        .catch(() => {})
      try {
        if ('mediaSession' in navigator) {
          if (track) {
            navigator.mediaSession.metadata = new MediaMetadata({
              title: track.title,
              artist: track.artist,
              artwork: track.thumbnail ? [{ src: track.thumbnail, sizes: '512x512' }] : []
            })
            navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused'
          } else {
            navigator.mediaSession.metadata = null
          }
        }
      } catch {}
    })
    return () => {
      window.removeEventListener('keydown', onKey)
      unsub()
    }
  }, [])

  // Party sync + global party socket events live at App level so switching
  // pages never drops the party. Member list refreshes on a slow poll here
  // (single owner) instead of per-page timers.
  useEffect(() => {
    startPartySync()
    void useParty.getState().restore().catch(() => {})
    const membersTimer = window.setInterval(() => {
      if (useParty.getState().partyId) void useParty.getState().refreshMembers()
    }, 10000)
    const off = window.spinity.events.onSocial((evt) => {
      if (evt.type === 'party:state') {        const p = evt.payload as { partyId: string; playback: { trackIndex: number; positionMs: number; isPlaying: boolean; updatedAt: string }; at: number }
        void onPartyState(p.partyId, p.playback, p.at)
      } else if (evt.type === 'party:queue') {
        const p = evt.payload as { partyId: string; queue: never[] }
        onPartyQueue(p.partyId, p.queue as never)
      } else if (evt.type === 'party:members') {
        const p = evt.payload as { partyId: string; participants: string[] }
        useParty.getState().applyMembers(p.partyId, p.participants)
      } else if (evt.type === 'party:member-joined' || evt.type === 'party:member-left') {
        void useParty.getState().refreshMembers()
      } else if (evt.type === 'social:error') {
        // Dead cloud token (server reset / expired): back to login. The
        // local music library stays on disk and re-links on next sign-in.
        const msg = (evt.payload as { message?: string })?.message ?? ''
        if (/invalid token/i.test(msg)) {
          useApp.setState({ user: null })
        }
      } else if (evt.type === 'chat:message') {
        // Global safety net: the Friends page handles live appending when it
        // is open; here we only track party invites and unread badges so the
        // notification center stays correct when it isn't.
        const m = evt.payload as { conversationId?: string; senderId?: string; senderName?: string | null; payload?: { partyCode?: string } | null }
        if (m.payload?.partyCode && m.conversationId) {
          useSocial.getState().pushInvite({
            code: m.payload.partyCode,
            fromId: m.senderId ?? '',
            fromName: m.senderName ?? 'Someone',
            conversationId: m.conversationId,
            at: new Date().toISOString()
          })
        }
        void useSocial.getState().refreshBadge()
      }
    })
    return () => {
      window.clearInterval(membersTimer)
      try { off?.() } catch {}
    }
  }, [])

  // Mini-player widget: push snapshots (track/playing changes immediately,
  // position on a 1s tick while playing) and run its transport commands.
  useEffect(() => {
    const push = (): void => {
      const p = usePlayer.getState()
      const track = p.index >= 0 ? p.queue[p.index] : undefined
      void window.spinity.mini
        .sync({
          trackId: track?.id ?? null,
          title: track?.title ?? '',
          artist: track?.artist ?? '',
          art: track?.thumbnail ?? '',
          playing: p.playing,
          currentTime: p.currentTime,
          duration: p.duration
        })
        .catch(() => {})
    }
    let lastKey = ''
    const unsub = usePlayer.subscribe((s) => {
      const track = s.index >= 0 ? s.queue[s.index] : undefined
      const key = `${track?.id ?? ''}|${s.playing ? '1' : '0'}`
      if (key === lastKey) return
      lastKey = key
      push()
    })
    const tick = window.setInterval(() => {
      if (usePlayer.getState().playing) push()
    }, 1000)
    push()
    const offCmd = window.spinity.events.onMiniCmd((action, value) => {
      const p = usePlayer.getState()
      if (action === 'toggle') p.toggle()
      else if (action === 'next') p.next()
      else if (action === 'previous') p.previous()
      else if (action === 'seek' && typeof value === 'number') p.seek(value)
    })
    return () => {
      unsub()
      window.clearInterval(tick)
      offCmd()
    }
  }, [])

  // Toasts auto-dismiss so they never pile up.
  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => dismissToast(), toast.kind === 'error' ? 9000 : 3500)
    return () => clearTimeout(timer)
  }, [toast, dismissToast])

  // Desktop notification clicks (message/call/party invite): jump to Friends,
  // prefill a party code when there is one, and open the conversation.
  // The chat handoff goes through the ui store (not an event) because the
  // Friends page is lazy-loaded and may mount after the click arrives.
  useEffect(() => {
    const off = window.spinity.events.onNotifyClick((click) => {
      if (click.kind === 'party-invite' && click.code) {
        useParty.getState().setCodeInput(click.code)
      }
      navigate('friends')
      if (click.conversationId) {
        useUi.getState().requestChat(click.conversationId)
      }
    })
    return off
    // `navigate` only uses the functional setNav form, safe to subscribe once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Until main has reported in, the boot screen is the whole UI.
  if (!ready) return <BootScreen done={false} onHidden={hideBoot} />

  const bootOverlay = bootVisible ? <BootScreen done={bootDone} onHidden={hideBoot} /> : null

  if (!user) {
    return (
      <>
        <LoginPage />
        {bootOverlay}
      </>
    )
  }

  return (
    <>
      <div
        className={`sp-app${railCollapsed ? ' rail-collapsed' : ''}${lyricsOpen ? ' lyrics-open' : ''}`}
        key={language || 'en'}
      >
        <Sidebar page={page} onNavigate={navigate} />

      <div className="sp-center">
          <TopBar
            title={t('page.' + page, PAGE_TITLES[page])}
            onHome={() => navigate('home')}
            onSearch={() => navigate('search')}
            onNavigate={navigate}
            homeActive={page === 'home'}
            onFriends={() => navigate('friends')}
          canBack={nav.idx > 0}
          canForward={nav.idx < nav.hist.length - 1}
          onBack={goBack}
          onForward={goForward}
        />
        <main className="main">
          <ErrorBoundary name="Page" resetKey={page}>
            <Suspense fallback={<PageFallback />}>
              {/* Keyed per page so the CSS enter animation replays on every
                  navigation (React reuses same-typed siblings otherwise). */}
              <div className="page-stage" key={page}>
                {page === 'home' && <HomePage onNavigate={navigate} />}
                {page === 'search' && <SearchPage />}
                {page === 'playlists' && <PlaylistsPage />}
                {page === 'downloads' && <DownloadsPage />}
                {page === 'friends' && <FriendsPage />}
                {page === 'settings' && <SettingsPage />}
              </div>
            </Suspense>
          </ErrorBoundary>
        </main>
      </div>

      <LyricsPanel />

      <PlayerBar />

      <MenuHost />

      <ShortcutsHelp />

      {whatsNew.version && <WhatsNew version={whatsNew.version} onClose={whatsNew.dismiss} />}

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

      {bootOverlay}
    </>
  )
}
