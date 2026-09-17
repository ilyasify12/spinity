import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import { IconFolder, IconRepeat, IconTrash } from '../components/Icons'
import type { AppSettings, ToolStatus } from '@shared/types'

/** Last path segment of a folder, for a compact row title. */
function folderName(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || folder
}

/**
 * Settings doubles as the health check for the external toolchain.
 * yt-dlp breaks whenever YouTube changes, so the installed version and a
 * one-click update path are surfaced here rather than buried in a log.
 */
export function SettingsPage(): React.JSX.Element {
  const settings = useApp((s) => s.settings)
  const updateSettings = useApp((s) => s.updateSettings)
  const notify = useApp((s) => s.notify)
  const reload = useApp((s) => s.reload)

  const [status, setStatus] = useState<ToolStatus | null>(null)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateLog, setUpdateLog] = useState<string | null>(null)

  // Local music folders. The list lives in the library snapshot (main owns
  // it), so it is fetched here rather than added to the app store.
  const [folders, setFolders] = useState<string[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  async function refresh(): Promise<void> {
    setChecking(true)
    try {
      setStatus(await window.spinity.tools.status())
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not read tool status', 'error')
    } finally {
      setChecking(false)
    }
  }

  /** Folders come from the library snapshot, which main builds from the db. */
  async function refreshFolders(): Promise<void> {
    try {
      const snap = await window.spinity.library.snapshot()
      setFolders(snap.localFolders ?? [])
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not read local folders', 'error')
    }
  }

  /** Refresh the track store and the folder list after a change. */
  async function settleFolders(): Promise<void> {
    await reload()
    await refreshFolders()
  }

  useEffect(() => {
    void refresh()
    void refreshFolders()
    // Runs once on mount; `refresh` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onUpdate(): Promise<void> {
    setUpdating(true)
    setUpdateLog(null)
    try {
      const output = await window.spinity.tools.updateYtDlp()
      setUpdateLog(output)
      notify('yt-dlp updated')
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Update failed'
      setUpdateLog(msg)
      notify(msg, 'error')
    } finally {
      setUpdating(false)
    }
  }

  async function onAddFolder(): Promise<void> {
    setAdding(true)
    try {
      const res = await window.spinity.local.addFolder()
      if (!res.folder) return // dialog canceled — nothing to report
      notify(
        res.added > 0
          ? `Indexed ${res.added} track${res.added === 1 ? '' : 's'} from your folder`
          : 'No new tracks found in that folder'
      )
      await settleFolders()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not add folder', 'error')
    } finally {
      setAdding(false)
    }
  }

  async function onRescan(): Promise<void> {
    setRescanning(true)
    try {
      const res = await window.spinity.local.rescan()
      notify(
        res.added > 0
          ? `Rescan found ${res.added} new track${res.added === 1 ? '' : 's'}`
          : 'Rescan complete — nothing new'
      )
      await settleFolders()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Rescan failed', 'error')
    } finally {
      setRescanning(false)
    }
  }

  async function onRemoveFolder(folder: string): Promise<void> {
    setRemoving(folder)
    try {
      await window.spinity.local.removeFolder(folder)
      notify('Folder removed — its files were never touched on disk')
      await settleFolders()
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not remove folder', 'error')
    } finally {
      setRemoving(null)
    }
  }

  return (
    <>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Preferences apply to this computer and this account.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 16 }}>Downloads</h2>

        <div className="field">
          <label htmlFor="format">Audio format</label>
          <select
            id="format"
            value={settings.audioFormat}
            onChange={(e) =>
              void updateSettings({ audioFormat: e.target.value as AppSettings['audioFormat'] })
            }
          >
            <option value="m4a">M4A (AAC) — best quality per MB</option>
            <option value="mp3">MP3 — most compatible</option>
            <option value="opus">Opus — smallest files</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="quality">Audio quality</label>
          <select
            id="quality"
            value={settings.audioQuality}
            onChange={(e) =>
              void updateSettings({ audioQuality: e.target.value as AppSettings['audioQuality'] })
            }
          >
            <option value="0">Best available (V0)</option>
            <option value="2">High (V2)</option>
            <option value="5">Medium (V5)</option>
            <option value="7">Small (V7)</option>
          </select>
        </div>

        <div className="field">
          <label htmlFor="pref">Playback</label>
          <select
            id="pref"
            value={settings.preferStreaming ? 'stream' : 'download'}
            onChange={(e) => void updateSettings({ preferStreaming: e.target.value === 'stream' })}
          >
            <option value="stream">Stream first — download automatically on failure</option>
            <option value="download">Always download before playing</option>
          </select>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="conc">Simultaneous downloads</label>
          <select
            id="conc"
            value={settings.concurrency}
            onChange={(e) => void updateSettings({ concurrency: Number(e.target.value) })}
          >
            <option value={1}>1 — gentlest on YouTube</option>
            <option value={2}>2 — recommended</option>
            <option value={3}>3</option>
            <option value={4}>4 — more likely to be rate-limited</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Local music folders</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Point Spinity at folders on this PC that already contain music. Files
          are indexed in place — never copied, moved or modified — and removing
          a folder here never deletes anything from disk.
        </p>

        {folders === null ? (
          <p className="hint">Loading folders…</p>
        ) : folders.length === 0 ? (
          <p className="hint">
            No folders added yet — your library only holds YouTube downloads.
          </p>
        ) : (
          <div style={{ marginTop: 10 }}>
            {folders.map((folder) => (
              <div className="pl-row" key={folder} style={{ paddingLeft: 0 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="track-title">{folderName(folder)}</div>
                  <div className="track-artist" style={{ wordBreak: 'break-all' }}>
                    {folder}
                  </div>
                </div>
                <button
                  className="btn btn-danger btn-sm"
                  title="Remove from Spinity — files on disk are never deleted"
                  onClick={() => void onRemoveFolder(folder)}
                  disabled={adding || rescanning || removing !== null}
                >
                  {removing === folder ? 'Removing…' : <IconTrash size={13} />}
                </button>
              </div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-sm"
            onClick={() => void onAddFolder()}
            disabled={adding || rescanning || removing !== null}
          >
            <IconFolder size={14} /> {adding ? 'Indexing…' : 'Add folder…'}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void onRescan()}
            disabled={adding || rescanning || removing !== null || (folders?.length ?? 0) === 0}
          >
            <IconRepeat size={14} /> {rescanning ? 'Rescanning…' : 'Rescan all'}
          </button>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Toolchain</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Spinity uses <strong>yt-dlp</strong> to fetch audio and <strong>ffmpeg</strong> to
          convert it. Both must be installed on this machine.
        </p>

        {checking && <p className="hint">Checking…</p>}

        {status && (
          <>
            <div className="pl-row" style={{ paddingLeft: 0 }}>
              <span className={`chip${status.ytdlpPath ? ' chip-ok' : ' chip-err'}`}>
                {status.ytdlpPath ? 'found' : 'missing'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="track-title">yt-dlp {status.ytdlpVersion ?? ''}</div>
                <div className="track-artist" style={{ wordBreak: 'break-all' }}>
                  {status.ytdlpPath ?? 'Not found — install with: pip install -U yt-dlp'}
                </div>
              </div>
            </div>

            <div className="pl-row" style={{ paddingLeft: 0 }}>
              <span className={`chip${status.ffmpegPath ? ' chip-ok' : ' chip-err'}`}>
                {status.ffmpegPath ? 'found' : 'missing'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="track-title">ffmpeg</div>
                <div className="track-artist" style={{ wordBreak: 'break-all' }}>
                  {status.ffmpegPath ?? 'Not found — install with: winget install ffmpeg'}
                </div>
              </div>
            </div>

            {status.ffmpegVersion && (
              <p className="hint" style={{ wordBreak: 'break-all' }}>
                {status.ffmpegVersion}
              </p>
            )}

            {!status.ready && (
              <p className="error-text" style={{ marginTop: 10 }}>
                Downloads will not work until both tools are available.
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <button
            className="btn btn-ghost btn-sm"
            onClick={() => void refresh()}
            disabled={checking}
          >
            Re-check
          </button>
          <button
            className="btn btn-sm"
            onClick={() => void onUpdate()}
            disabled={updating || !status?.ytdlpPath}
          >
            {updating ? 'Updating…' : 'Update yt-dlp'}
          </button>
        </div>

        {updateLog && (
          <pre
            className="hint"
            style={{
              whiteSpace: 'pre-wrap',
              maxHeight: 180,
              overflow: 'auto',
              background: 'var(--bg)',
              padding: 12,
              borderRadius: 8,
              marginTop: 12
            }}
          >
            {updateLog}
          </pre>
        )}
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Legal and storage</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Downloaded audio is stored on this computer only, under your Windows AppData
          folder, and is tied to your local account. Nothing is uploaded anywhere.
        </p>
        <p className="hint">
          Downloading copyrighted material without permission infringes copyright and
          breaches YouTube&apos;s Terms of Service. Keep this to content you are allowed to
          download — your own uploads, Creative Commons, public domain, or licensed work.
        </p>
      </div>

    </>
  )
}
