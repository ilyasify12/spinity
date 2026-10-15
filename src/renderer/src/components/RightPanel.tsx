import { useCurrentTrack, usePlayer } from '../player/engine'
import { t } from '../lib/i18n'
import { TrackArtwork } from './TrackArtwork'

/** Right "Now playing" panel: big artwork, title/artist, about, next up. */
export function RightPanel(): React.JSX.Element {
  const track = useCurrentTrack()
  const queue = usePlayer((s) => s.queue)
  const index = usePlayer((s) => s.index)

  if (!track) {
    return (
      <aside className="sp-right">
        <h3>{t('ui.nowPlaying', 'Now playing')}</h3>
        <div className="sp-np-art"><span style={{ fontSize: 48 }}>♪</span></div>
        <p className="hint" style={{ marginTop: 12 }}>{t('ui.nothingPlaying', 'Nothing playing — pick something from Home, Search or your Library.')}</p>
      </aside>
    )
  }

  const next = queue.slice(index + 1, index + 6)

  return (
    <aside className="sp-right">
      <h3>{track.title}</h3>
      <div className="sp-np-art">
        <TrackArtwork src={track.thumbnail ?? ''} className="sp-np-fill" />
      </div>
      <div className="sp-np-title" title={track.title}>{track.title}</div>
      <div className="sp-np-artist">{track.artist}</div>

      <div className="sp-about-card">
        <TrackArtwork src={track.thumbnail ?? ''} className="sp-about-fill" />
        <div className="sp-about-body">
          <h4>{t('ui.aboutTrack', 'About this track')}</h4>
          <p>{track.artist} — {track.title}. {track.durationSec > 0 ? `${t('ui.playsFor', 'Plays for')} ${Math.floor(track.durationSec / 60)}:${String(track.durationSec % 60).padStart(2, '0')}.` : ''} {t('ui.savedInLibrary', 'Saved in your Spinity library.')}</p>
        </div>
      </div>

      {next.length > 0 && (
        <>
          <h3 style={{ marginTop: 20 }}>{t('ui.nextUp', 'Next up')}</h3>
          {next.map((t) => (
            <button
              key={t.id}
              className="sp-next-row"
              onClick={() => {
                const i = queue.findIndex((x) => x.id === t.id)
                if (i >= 0) usePlayer.getState().playQueue(queue, i)
              }}
            >
              <TrackArtwork src={t.thumbnail ?? ''} className="sp-next-art" />
              <span style={{ minWidth: 0 }}>
                <span className="track-title" style={{ fontSize: 13 }}>{t.title}</span>
                <br />
                <span className="track-artist" style={{ fontSize: 12 }}>{t.artist}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </aside>
  )
}
