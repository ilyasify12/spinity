import { useApp } from '../store/app'
import { IconTrash } from '../components/Icons'

const LABELS: Record<string, string> = {
  queued: 'Queued',
  downloading: 'Downloading',
  converting: 'Converting audio',
  done: 'Done',
  error: 'Failed',
  canceled: 'Cancelled'
}

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
      <h1 className="page-title">Downloads</h1>
      <p className="page-sub">
        {busy.length > 0
          ? `${busy.length} active · ${tracks.length} in library`
          : `Idle · ${tracks.length} track${tracks.length === 1 ? '' : 's'} in library`}
      </p>

      {jobs.length === 0 ? (
        <div className="empty">Nothing here yet. Save a track from Search to start a download.</div>
      ) : (
        <>
          <div style={{ marginBottom: 16 }}>
            <button className="btn btn-ghost btn-sm" onClick={clearJobs}>
              Clear finished
            </button>
          </div>

          <div className="list-plain">
            {jobs.map((job) => {
              const active =
                job.status === 'queued' ||
                job.status === 'downloading' ||
                job.status === 'converting'
              return (
                <div key={job.id} className="card" style={{ maxWidth: '100%', padding: 16 }}>
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
                      {LABELS[job.status] ?? job.status}
                    </span>

                    {active && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => void cancelJob(job.id)}
                      >
                        Cancel
                      </button>
                    )}
                    {!active && (
                      <button
                        className="btn btn-ghost btn-sm"
                        title="Remove from list"
                        onClick={clearJobs}
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
            })}
          </div>
        </>
      )}
    </>
  )
}
