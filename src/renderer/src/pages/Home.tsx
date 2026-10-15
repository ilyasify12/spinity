import { useMemo } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../store/app'
import { usePlayer } from '../player/engine'
import { useUi } from '../store/ui'
import { TrackRow } from '../components/TrackRow'
import { openContextMenu, playlistSubmenu, type MenuItem } from '../components/ContextMenu'
import { TrackArtwork } from '../components/TrackArtwork'
import { IconChevronRight, IconPause, IconPlay } from '../components/Icons'
import type { Page } from '../components/Sidebar'
import type { Track } from '@shared/types'

interface HomeProps {
  onNavigate: (page: Page) => void
}

/** The headline doubles as the time-of-day greeting. */
function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return t('home.greetingMorning', 'Good morning. Ease in.')
  if (h < 18) return t('home.greetingAfternoon', 'Feels like a good day.')
  return t('home.greetingEvening', 'Good evening. Wind it down.')
}

/** Decorative one-liners for the mood cards, cycled by position. */
const MOOD_LINES = [
  'For the long way home.',
  'A little warmth, on repeat.',
  'Start somewhere softer.',
  'Turn it up and disappear.',
  'Slow hours, low light.',
  'Background for good work.'
]

/** A mood card: one of your playlists, or an artist when you have none yet. */
interface Mood {
  id: string
  title: string
  sub: string
  art: string
}

/** Spotify-style home: greeting tiles, playlist cards, recent tracks. */
export function HomePage({ onNavigate }: HomeProps): React.JSX.Element {
  const tracks = useApp((s) => s.tracks)
  const playlists = useApp((s) => s.playlists)
  const likedIds = useApp((s) => s.likedIds)
  const toggleLike = useApp((s) => s.toggleLike)
  const addToPlaylist = useApp((s) => s.addToPlaylist)
  const removeTrack = useApp((s) => s.removeTrack)
  const notify = useApp((s) => s.notify)
  const openPlaylist = useUi((s) => s.openPlaylist)
  const playing = usePlayer((s) => s.playing)

  const playQueue = usePlayer((s) => s.playQueue)
  const stop = usePlayer((s) => s.stop)
  const currentId = usePlayer((s) => (s.index >= 0 ? s.queue[s.index]?.id : undefined))

  // Labels resolved up front: inside the track map below the row param `t`
  // shadows the i18n `t`.
  const unknownArtist = t('ui.unknownArtist', 'Unknown')
  const lbl = {
    play: t('ctx.play', 'Play'),
    stop: t('ctx.stop', 'Stop'),
    like: t('ctx.like', 'Like'),
    unlike: t('ctx.unlike', 'Unlike'),
    copyTitle: t('ctx.copyTitle', 'Copy title'),
    copied: t('action.copied', 'Copied'),
    showInExplorer: t('ui.showInExplorer', 'Show in Explorer'),
    couldNotOpenFolder: t('ui.couldNotOpenFolder', 'Could not open folder'),
    removeFromLibrary: t('ui.removeFromLibrary', 'Remove from library'),
    deleteFromLibrary: t('ui.deleteFromLibrary', 'Delete from library and disk')
  }

  /** Mood cards: your playlists first, topped up with artists when you have few. */
  const moods = useMemo<Mood[]>(() => {
    const byId = new Map(tracks.map((t) => [t.id, t]))
    const list: Mood[] = playlists.map((p) => ({
      id: `pl:${p.id}`,
      title: p.name,
      sub: '',
      art: p.trackIds.map((id) => byId.get(id)?.thumbnail).find(Boolean) ?? ''
    }))
    if (list.length < 3) {
      const seen = new Set<string>()
      for (const t of tracks) {
        const name = (t.artist || unknownArtist).trim()
        if (seen.has(name)) continue
        seen.add(name)
        list.push({ id: `ar:${name}`, title: name, sub: '', art: t.thumbnail })
        if (list.length >= 6) break
      }
    }
    return list.slice(0, 6).map((m, i) => {
      const n = i % MOOD_LINES.length
      return { ...m, sub: t(`home.mood${n + 1}`, MOOD_LINES[n]) }
    })
  }, [playlists, tracks])

  /** The tracks behind a mood card, resolved at click time. */
  function moodTracks(m: Mood): Track[] {
    if (m.id.startsWith('pl:')) {
      const pl = playlists.find((p) => p.id === m.id.slice(3))
      if (!pl) return []
      return pl.trackIds.map((id) => tracks.find((t) => t.id === id)).filter(Boolean) as Track[]
    }
    const name = m.id.slice(3)
    return tracks.filter((t) => (t.artist || unknownArtist).trim() === name)
  }

  /** Clicking a mood plays it, or stops if it is what is already playing. */
  function toggleMood(m: Mood): void {
    const list = moodTracks(m)
    if (list.length === 0) return
    if (playing && list.some((t) => t.id === currentId)) stop()
    else playQueue(list, 0)
  }

  const rotation = useMemo(() => tracks.slice(0, 6), [tracks])

  if (tracks.length === 0 && playlists.length === 0) {
    return (
      <>
        <section className="sp-hero">
          <div className="sp-hero-top">
            <span className="sp-overline">{t('home.overline', 'Your space. Your sound.')}</span>
            <span className="sp-badge"><i /> {t('home.localFirst', 'Local-first')}</span>
          </div>
          <h1>{greeting()}</h1>
          <p>{t('home.sub', 'Pick a mood. Find your next favorite.')}</p>
        </section>
        <div className="card">
          <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>{t('home.startsHere', 'Your music starts here')}</h2>
          <p className="hint">{t('home.emptyHint', 'Search YouTube and save tracks, or index folders already on this PC — then this page fills with moods and picks.')}</p>
          <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
            <button className="btn" onClick={() => onNavigate('search')}>{t('action.findMusic', 'Find music')}</button>
            <button className="btn btn-ghost" onClick={() => onNavigate('settings')}>{t('home.addLocalFolders', 'Add local folders')}</button>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <section className="sp-hero">
        <div className="sp-hero-top">
          <span className="sp-overline">{t('home.overline', 'Your space. Your sound.')}</span>
          <span className="sp-badge"><i /> {t('home.localFirst', 'Local-first')}</span>
        </div>
        <h1>{greeting()}</h1>
        <p>{t('home.sub', 'Pick a mood. Find your next favorite.')}</p>
      </section>

      {moods.length > 0 && (
        <div className="sp-moods">
          {moods.map((m) => {
            const list = moodTracks(m)
            const active = playing && list.some((t) => t.id === currentId)
            return (
              <button key={m.id} className="sp-mood" onClick={() => toggleMood(m)} title={m.title}>
                <span className="sp-mood-art">
                  <TrackArtwork src={m.art} className="sp-mood-fill" />
                  <span className="sp-mood-play">{active ? <IconPause size={20} /> : <IconPlay size={20} />}</span>
                </span>
                <span className="sp-mood-title">{m.title}</span>
                <span className="sp-mood-sub">{m.sub}</span>
              </button>
            )
          })}
        </div>
      )}

      {rotation.length > 0 && (
        <>
          <div className="sp-section-head">
            <h2>{t('home.rotation', 'Made for your rotation')}</h2>
            <button className="show-all" onClick={() => { openPlaylist('all'); onNavigate('playlists') }}>
              {t('home.viewAll', 'View all')} <IconChevronRight size={13} />
            </button>
          </div>
          <div className="track-list sp-rot">
            {rotation.map((t, i) => {
              const isActive = currentId === t.id && playing
              const liked = likedIds.includes(t.id)
              const menu = (e: React.MouseEvent): void => {
                const items: MenuItem[] = [
                  { label: isActive ? lbl.stop : lbl.play, onSelect: () => { if (isActive) stop(); else playQueue(rotation, i) } },
                  { label: liked ? lbl.unlike : lbl.like, onSelect: () => void toggleLike(t.id, t) },
                  playlistSubmenu(playlists, (pid) => void addToPlaylist(pid, t.id)),
                  { label: lbl.copyTitle, onSelect: () => void navigator.clipboard.writeText(`${t.title} — ${t.artist}`).then(() => notify(lbl.copied)).catch(() => {}) },
                  { label: lbl.showInExplorer, onSelect: () => void window.spinity.library.revealFile(t.id).catch((err: unknown) => notify(err instanceof Error ? err.message : lbl.couldNotOpenFolder, 'error')) },
                  { label: t.source === 'local' ? lbl.removeFromLibrary : lbl.deleteFromLibrary, danger: true, onSelect: () => void removeTrack(t.id) }
                ]
                openContextMenu(e, items)
              }
              return (
                <TrackRow
                  key={t.id}
                  index={i}
                  numbered
                  title={t.title}
                  artist={t.artist}
                  thumbnail={t.thumbnail}
                  durationSec={t.durationSec}
                  playing={isActive}
                  liked={liked}
                  onToggleLike={() => void toggleLike(t.id, t)}
                  onPlay={() => {
                    if (isActive) stop()
                    else playQueue(rotation, i)
                  }}
                  onContextMenu={menu}
                />
              )
            })}
          </div>
        </>
      )}
    </>
  )
}
