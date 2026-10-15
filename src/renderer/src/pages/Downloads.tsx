import { memo } from 'react'
import { t } from '../lib/i18n'
import { useApp } from '../store/app'
import { IconTrash } from '../components/Icons'
import { openContextMenu, type MenuItem } from '../components/ContextMenu'
import type { DownloadJob } from '@shared/types'

/** Status → [i18n key, English fallback], resolved at render time. */
const LABELS: Record<string, [string, string]> = {
  queued: ['dl.queued', 'Queued'],
  downloading: ['dl.downloading', 'Downloading'],
  converting: ['dl.converting', 'Converting audio'],
  done: ['dl.done', 'Done'],
  error: ['dl.failed', 'Failed'],
  canceled: ['dl.canceled', 'Cancelled']
}

/** Memoized: progress ticks for one job must not re-render every other row. */
const JobRow = memo(function JobRow({ job, onCancel, onClear }: { job: DownloadJob; onCancel: (id: string) => void; onClear: () => void }): React.JSX.Element {
  const active =
    job.status === 'queued' ||
    job.status === 'downloading' ||
    job.status === 'converting'
  const menu = (e: React.MouseEvent): void => {
    const items: MenuItem[] = [
      ...(active
        ? [{ label: t('dl.cancelDownload', 'Cancel download'), danger: true, onSelect: () => onCancel(job.id) } as MenuItem]
        : [{ label: t('dl.clearFromList', 'Clear from list'), onSelect: () => onClear() } as MenuItem]),
      { label: t('ctx.copyTitle', 'Copy title'), onSelect: () => void navigator.clipboard.writeText(`${job.title} — ${job.artist}`).catch(() => {}) }
    ]
    openContextMenu(e, items)
  }
  const statusLabel = LABELS[job.status]
  return (
    <div className="card" style={{ maxWidth: '100%', padding: 16 }} onContextMenu={menu}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="track-title" title={job.title}>
            {job.title}
          </div>
          <div className="track-artist">{job.artist}</div>
        </div>

        <span
          className={`chip${
            job.status === 'done' ? ' chip-ok' : job.status === 'error' ? ' chip-err' : ''
          }`}
        >
          {statusLabel ? t(statusLabel[0], statusLabel[1]) : job.status}
        </span>

        {active && (
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void onCancel(job.id)}
          >
            {t('action.cancel', 'Cancel')}
          </button>
        )}
        {!active && (
          <button
            className="btn btn-ghost btn-sm"
            title={t('dl.removeFromList', 'Remove from list')}
            onClick={onClear}
          >
            <IconTrash size={13} />
          </button>
        )}
      </div>

      {active && (
        <div className="progress-wrap" style={{ maxWidth: '100%', marginTop: 12 }}>
          <div
            style={{
              flex: 1,
              height: 5,
              borderRadius: 3,
              background: '#3a3a48',
              overflow: 'hidden'
            }}
          >
            <div
              style={{
                width: `${job.progress}%`,
                height: '100%',
                background: 'var(--accent)',
                transition: 'width 0.25s'
              }}
            />
          </div>
          <span className="time" style={{ width: 42 }}>
            {job.progress}%
          </span>
        </div>
      )}

      {job.error && <p className="error-text" style={{ marginTop: 10, marginBottom: 0 }}>{job.error}</p>}
    </div>
  )
})
/** Download queue with live progress pushed from the main process. */
export function DownloadsPage(): React.JSX.Element {
  const jobs = useApp((s) => s.jobs)
  const cancelJob = useApp((s) => s.cancelJob)
  const clearJobs = useApp((s) => s.clearJobs)
  const tracks = useApp((s) => s.tracks)

  const busy = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'downloading' || j.status === 'converting'
  )

  return (
    <>
      <h1 className="page-title">{t('page.downloads', 'Downloads')}</h1>
      <p className="page-sub">
        {busy.length > 0
          ? `${busy.length} ${t('dl.active', 'active')} · ${tracks.length} ${t('dl.inLibrary', 'in library')}`
          : `${t('dl.idle', 'Idle')} · ${tracks.length} ${t(tracks.length === 1 ? 'lib.track' : 'lib.tracks', tracks.length === 1 ? 'track' : 'tracks')} ${t('dl.inLibrary', 'in library')}`}
      </p>

      {jobs.length === 0 ? (
        <div className="empty">{t('dl.empty', 'Nothing here yet. Save a track from Search to start a download.')}</div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={clearJobs}>
              {t('dl.clearFinished', 'Clear finished')}
            </button>
          </div>

          <div className="list-plain">
            {jobs.map((job) => (
              <JobRow key={job.id} job={job} onCancel={(id) => void cancelJob(id)} onClear={clearJobs} />
            ))}
          </div>
        </>
      )}
    </>
  )
}
