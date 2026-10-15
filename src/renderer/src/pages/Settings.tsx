import { useEffect, useState } from 'react'
import { useApp } from '../store/app'
import { IconFolder, IconRepeat, IconTrash } from '../components/Icons'
import { t } from '../lib/i18n'
import { SHORTCUTS } from '../lib/shortcuts'
import type { AppSettings, PhoneServerStatus, ToolStatus } from '@shared/types'

/** Last path segment of a folder, for a compact row title. */
function folderName(folder: string): string {
  const trimmed = folder.replace(/[\\/]+$/, '')
  return trimmed.split(/[\\/]/).pop() || folder
}

/** Legacy copy path for when the async clipboard API is unavailable. */
function copyFallback(text: string, done: () => void): void {
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    ta.remove()
    done()
  } catch {
    /* nothing else to try; the address is still selectable above */
  }
}

/** True on macOS (Electron user agent carries the OS) — for platform hints. */
const IS_MAC = typeof navigator !== 'undefined' && /mac/i.test(navigator.userAgent)
const IS_WIN = typeof navigator !== 'undefined' && /win/i.test(navigator.userAgent)

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
  const [installing, setInstalling] = useState<string | null>(null)
  const [updateLog, setUpdateLog] = useState<string | null>(null)
  const [pyStatus, setPyStatus] = useState<{ path: string | null; version: string | null } | null>(null)
  const [appVersion, setAppVersion] = useState<string | null>(null)
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updaterMsg, setUpdaterMsg] = useState<string | null>(null)
  const [updaterEvt, setUpdaterEvt] = useState<{ type: string; data?: unknown } | null>(null)

  // Local music folders. The list lives in the library snapshot (main owns
  // it), so it is fetched here rather than added to the app store.
  const [folders, setFolders] = useState<string[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [rescanning, setRescanning] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  // Phone web player (Settings → Phone): the main process owns the server,
  // the renderer only shows its status. Polled, so a server that failed on
  // startup (port busy, firewall) surfaces its error here.
  const [phone, setPhone] = useState<PhoneServerStatus | null>(null)
  const [phoneQr, setPhoneQr] = useState('')
  const [phoneBusy, setPhoneBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const refresh = async (): Promise<void> => {
      try {
        const st = await window.spinity.phone.status()
        if (alive) setPhone(st)
      } catch {
        /* main not ready yet */
      }
    }
    void refresh()
    const timer = setInterval(() => void refresh(), 5000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [])

  // The QR only changes with the address: regenerate when running flips on.
  useEffect(() => {
    let alive = true
    if (phone?.running && phone.url) {
      void window.spinity.phone
        .qr()
        .then((q) => {
          if (alive) setPhoneQr(q)
        })
        .catch(() => {
          if (alive) setPhoneQr('')
        })
    } else {
      setPhoneQr('')
    }
    return () => {
      alive = false
    }
  }, [phone?.running, phone?.url])

  async function togglePhone(): Promise<void> {
    setPhoneBusy(true)
    try {
      const st = phone?.running
        ? await window.spinity.phone.stop()
        : await window.spinity.phone.start()
      setPhone(st)
      if (st.error) notify(st.error, 'error')
    } catch (err) {
      notify(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setPhoneBusy(false)
    }
  }

  // AI lyrics assistance. The key is typed into a draft and saved on blur, so a
  // half-typed key never reaches the store.
  const [aiKeyDraft, setAiKeyDraft] = useState('')
  const [aiStatus, setAiStatus] = useState<Awaited<ReturnType<typeof window.spinity.ai.status>> | null>(null)
  const [testingAi, setTestingAi] = useState(false)

  useEffect(() => {
    setAiKeyDraft(settings.aiApiKey)
  }, [settings.aiApiKey])

  useEffect(() => {
    void window.spinity.ai
      .status()
      .then(setAiStatus)
      .catch(() => setAiStatus(null))
  }, [settings.aiApiKey, settings.aiLyrics, settings.aiModel])

  async function saveAiKey(): Promise<void> {
    const clean = aiKeyDraft.trim()
    if (clean === settings.aiApiKey) return
    await updateSettings({ aiApiKey: clean })
    notify(clean ? t('settings.aiKeySaved', 'API key saved') : t('settings.aiKeyCleared', 'API key removed'))
  }

  async function testAi(): Promise<void> {
    setTestingAi(true)
    try {
      const result = await window.spinity.ai.test()
      notify(
        result.ok
          ? `${t('settings.aiTestOk', 'Model answered in')} ${result.ms} ms · ${result.answer}`
          : `${t('settings.aiTestFailed', 'AI call failed')}: ${result.error ?? 'unknown'}`,
        result.ok ? 'info' : 'error'
      )
      setAiStatus(await window.spinity.ai.status())
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Test failed', 'error')
    } finally {
      setTestingAi(false)
    }
  }

  async function forgetAi(): Promise<void> {
    try {
      const removed = await window.spinity.ai.forget()
      notify(`${t('settings.aiForgotten', 'Forgot')} ${removed} ${t('settings.aiForgottenNames', 'learned names')}`)
      setAiStatus(await window.spinity.ai.status())
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not clear', 'error')
    }
  }

  async function refresh(): Promise<void> {
    setChecking(true)
    try {
      setStatus(await window.spinity.tools.status())
      setPyStatus(await window.spinity.tools.pythonStatus().catch(() => null))
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
    void window.spinity.updater.getVersion().then(setAppVersion).catch(() => {})
    const off = window.spinity.events.onUpdater((evt) => {
      setUpdaterEvt(evt)
      if (evt.type === 'checking') setUpdaterMsg('Checking for updates…')
      else if (evt.type === 'available') setUpdaterMsg(`Update ${(evt.data as { version?: string })?.version ?? ''} found — downloading…`)
      else if (evt.type === 'not-available') setUpdaterMsg('You are on the latest version.')
      else if (evt.type === 'downloaded') setUpdaterMsg(`Update ${(evt.data as { version?: string })?.version ?? ''} downloaded — restart to install.`)
      else if (evt.type === 'error') setUpdaterMsg((evt.data as { message?: string })?.message ?? 'Update check failed.')
    })
    return off
    // Runs once on mount; `refresh` is stable enough for this purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function onCheckUpdate(): Promise<void> {
    setUpdateChecking(true)
    setUpdaterMsg('Checking for updates…')
    try {
      const res = await window.spinity.updater.check()
      setUpdaterMsg(res.message)
      if (res.version) setUpdaterEvt({ type: res.status === 'available' ? 'available' : 'not-available', data: { version: res.version } })
      else if (res.status === 'no-update') setUpdaterEvt({ type: 'not-available' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      setUpdaterMsg(msg.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, ''))
    } finally {
      setUpdateChecking(false)
    }
  }

  async function onInstall(kind: 'ytdlp' | 'ffmpeg' | 'python'): Promise<void> {
    setInstalling(kind)
    setUpdateLog(null)
    try {
      let output = ''
      if (kind === 'ytdlp') output = await window.spinity.tools.installYtDlp()
      else if (kind === 'ffmpeg') output = await window.spinity.tools.installFfmpeg()
      else output = await window.spinity.tools.installPythonDeps()
      setUpdateLog(output)
      notify(kind === 'python' ? 'yt-dlp installed via pip' : `${kind === 'ytdlp' ? 'yt-dlp' : 'ffmpeg'} installed`)
      await refresh()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Install failed'
      setUpdateLog(msg)
      notify(msg, 'error')
    } finally {
      setInstalling(null)
    }
  }

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
      <h1 className="page-title">{t('settings.title', 'Settings')}</h1>
      <p className="page-sub">{t('settings.sub', 'Preferences apply to this computer and this account.')}</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 16 }}>{t('settings.language', 'Language')}</h2>
        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="lang">{t('settings.languageLabel', 'Interface language')}</label>
          <select
            id="lang"
            value={settings.language || 'en'}
            onChange={(e) =>
              void updateSettings({ language: e.target.value as AppSettings['language'] })
            }
          >
            <option value="en">English</option>
            <option value="ar">العربية — Arabic (RTL)</option>
          </select>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 14px', fontSize: 16 }}>{t('settings.downloads', 'Downloads')}</h2>

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
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>General</h2>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) => void updateSettings({ launchAtLogin: e.target.checked })}
          />
          <span>
            <strong>{IS_MAC ? 'Start Spinity at login' : 'Start Spinity with Windows'}</strong>
            <br />
            <span className="hint">{IS_MAC ? 'Launches on sign-in, like Spotify. Turn it off here or in System Settings → General → Login Items.' : 'Launches on sign-in, like Spotify. Turn it off here or in Task Manager → Startup apps.'}</span>
          </span>
        </label>
        <label className="check-row" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={settings.miniAutoHide}
            onChange={(e) => void updateSettings({ miniAutoHide: e.target.checked })}
          />
          <span>
            <strong>Mini-player auto-hide</strong>
            <br />
            <span className="hint">The widget sinks when another app takes focus and pops back briefly on every song change.</span>
          </span>
        </label>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('sc.title', 'Keyboard shortcuts')}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t('sc.settingsHint', 'Transport and volume work anywhere in the app — pressing ? opens this list too.')}
        </p>
        <div className="sc-list" style={{ maxHeight: 260 }}>
          {SHORTCUTS.map((s) => (
            <div className="sc-row" key={s.id}>
              <span className="sc-keys">
                {s.keys.map((k, i) => (
                  <kbd key={i}>{k}</kbd>
                ))}
              </span>
              <span className="sc-label">{t(s.labelKey, s.label)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>{t('settings.ai', 'AI lyrics matching')}</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          {t(
            'settings.aiHint',
            'A small language model reads messy file names and picks the right recording, and can estimate lyric timing when the automatic alignment cannot. Only names, tags and timings are sent — never audio or file paths.'
          )}
        </p>

        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.aiLyrics}
            onChange={(e) => { void updateSettings({ aiLyrics: e.target.checked }); setAiStatus(null) }}
          />
          <span>
            <strong>{t('settings.aiEnable', 'Use AI to match lyrics')}</strong>
            <br />
            <span className="hint">
              {t('settings.aiEnableHint', 'Runs only when the built-in matching is unsure, and at most once per song.')}
            </span>
          </span>
        </label>

        <div className="field">
          <label htmlFor="lyricsMode">{t('settings.lyricsMode', 'Lyrics mode')}</label>
          <select
            id="lyricsMode"
            value={settings.lyricsMode}
            onChange={(e) =>
              void updateSettings({ lyricsMode: e.target.value as AppSettings['lyricsMode'] })
            }
          >
            <option value="normal">
              {t('settings.lyricsModeNormal', 'Normal — upload, .lrc file or matched lyrics')}
            </option>
            <option value="ai">{t('settings.lyricsModeAi', 'AI writing — the model writes them')}</option>
          </select>
          <span className="hint">
            {t(
              'settings.lyricsModeHint',
              'Each mode keeps its own copy, so switching back shows the normal lyrics again straight away — nothing is lost. The same switch is in the lyrics panel.'
            )}
          </span>
        </div>

        <div className="field">
          <label htmlFor="aiKey">{t('settings.aiKey', 'NVIDIA API key')}</label>
          <input
            id="aiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="nvapi-…"
            value={aiKeyDraft}
            onChange={(e) => setAiKeyDraft(e.target.value)}
            onBlur={() => void saveAiKey()}
            onKeyDown={(e) => { if (e.key === 'Enter') void saveAiKey() }}
          />
          <span className="hint">
            {t('settings.aiKeyHint', 'Stored on this PC only (like your Spinity sign-in token). Get one at build.nvidia.com.')}
          </span>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label htmlFor="aiModel">{t('settings.aiModel', 'Model')}</label>
          <input
            id="aiModel"
            value={settings.aiModel}
            spellCheck={false}
            onChange={(e) => { void updateSettings({ aiModel: e.target.value.trim() }) }}
          />
          <span className="hint">
            {t('settings.aiModelHint', 'The default is chosen for latency: it answers in well under a second because its reasoning step is switched off.')}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" disabled={testingAi} onClick={() => void testAi()}>
            {testingAi ? t('settings.aiTesting', 'Testing…') : t('settings.aiTest', 'Test connection')}
          </button>
          <button
            className="btn btn-ghost btn-sm"
            title={t('settings.aiForgetHint', 'Every song is looked up again with the current heuristics')}
            onClick={() => void forgetAi()}
          >
            {t('settings.aiForget', 'Forget learned names')}
          </button>
          {aiStatus && (
            <span className="hint">
              {aiStatus.configured
                ? `${aiStatus.model} · ${aiStatus.calls} ${t('settings.aiCalls', 'calls')}${aiStatus.lastMs !== null ? ` · ${t('settings.aiLast', 'last')} ${aiStatus.lastMs} ms` : ''}`
                : t('settings.aiNotConfigured', 'No API key yet')}
            </span>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Discord</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Shows <strong>Listening to Spinity</strong> on your Discord profile with the song title,
          artists and elapsed/total time — Spotify-style.
        </p>
        <label className="check-row" style={{ marginBottom: 0 }}>
          <input
            type="checkbox"
            checked={settings.discordPresence}
            onChange={(e) => void updateSettings({ discordPresence: e.target.checked })}
          />
          <span><strong>Share what I&apos;m listening to</strong></span>
        </label>
        <p className="hint" style={{ marginBottom: 0 }}>
          Needs the Discord desktop app running. Turn it off anytime here.
        </p>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Notifications</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Desktop popups for chat, calls and party invites — even when the Friends page isn&apos;t open.
        </p>
        <label className="check-row">
          <input
            type="checkbox"
            checked={settings.notificationsEnabled}
            onChange={(e) => void updateSettings({ notificationsEnabled: e.target.checked })}
          />
          <span><strong>Enable desktop notifications</strong></span>
        </label>
        <div style={{ opacity: settings.notificationsEnabled ? 1 : 0.45 }}>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.notifyMessages}
              disabled={!settings.notificationsEnabled}
              onChange={(e) => void updateSettings({ notifyMessages: e.target.checked })}
            />
            <span>New chat messages</span>
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={settings.notifyCalls}
              disabled={!settings.notificationsEnabled}
              onChange={(e) => void updateSettings({ notifyCalls: e.target.checked })}
            />
            <span>Incoming voice calls</span>
          </label>
          <label className="check-row" style={{ marginBottom: 0 }}>
            <input
              type="checkbox"
              checked={settings.notifyPartyInvites}
              disabled={!settings.notificationsEnabled}
              onChange={(e) => void updateSettings({ notifyPartyInvites: e.target.checked })}
            />
            <span>Listening-party invites</span>
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          <button
            className="btn btn-ghost btn-sm"
            disabled={!settings.notificationsEnabled}
            onClick={() =>
              void window.spinity.notify
                .test()
                .then((res) => {
                  if (res?.ok) {
                    notify('Test sent — it should pop up now')
                  } else {
                    notify(`Notifications refused: ${res?.error ?? 'unknown reason'}`, 'error')
                  }
                })
                .catch((err: unknown) => notify(err instanceof Error ? err.message : String(err), 'error'))
            }
          >
            Send a test notification
          </button>
          <span className="hint">
            {IS_MAC
              ? 'Not seeing popups? Check System Settings → Notifications → Spinity is allowed.'
              : IS_WIN
                ? 'Not seeing popups? Check Windows Settings → System → Notifications → “Spinity” is on. In dev (npm run dev) also pin node_modules\electron\dist\electron.exe to the Start Menu.'
                : 'Not seeing popups? Check your system’s notification settings.'}
          </span>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Phone</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Serve the mobile player from this PC to your phone on the same Wi-Fi.
          Playback, playlists and downloads all come from this library, and the
          phone can add it to its home screen to feel like an app.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost btn-sm" disabled={phoneBusy} onClick={() => void togglePhone()}>
            {phone?.running ? 'Stop the phone server' : 'Start the phone server'}
          </button>
          <span className="hint" style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: '50%',
                display: 'inline-block',
                background: phone?.running ? '#4ade80' : '#6b7280'
              }}
            />
            {phone?.running ? 'Running' : 'Stopped'}
          </span>
        </div>
        {phone?.running && (
          <div style={{ display: 'flex', gap: 20, marginTop: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            {phoneQr ? (
              <img
                src={phoneQr}
                alt="QR code for the phone player"
                style={{ width: 190, height: 190, borderRadius: 12, background: '#fff', padding: 8, flex: 'none' }}
              />
            ) : null}
            <div style={{ minWidth: 220, flex: 1 }}>
              <p className="hint" style={{ marginTop: 0 }}>
                {phoneQr ? 'Scan with the phone camera, or open this address:' : 'Open this address on the phone:'}
              </p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: 13 }}>{phone.url ?? phone.localUrl}</code>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const link = phone.url ?? phone.localUrl
                    const done = (): void => notify('Link copied')
                    if (navigator.clipboard?.writeText) {
                      void navigator.clipboard.writeText(link).then(done).catch(() => copyFallback(link, done))
                    } else {
                      copyFallback(link, done)
                    }
                  }}
                >
                  Copy link
                </button>
              </div>
              <p className="hint">
                On this PC: <code>{phone.localUrl}</code>
              </p>
              <p className="hint" style={{ marginBottom: 0 }}>
                Keep this PC awake while listening. In the phone browser menu choose Add to
                Home screen — you then get an app icon, lock-screen controls and background audio.
              </p>
            </div>
          </div>
        )}
        {phone?.error && (
          <p className="hint" style={{ color: '#f87171', marginBottom: 0 }}>
            {phone.error}
          </p>
        )}
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
                  title={t('settings.removeFolder', 'Remove from Spinity — files on disk are never deleted')}
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
                  {status.ffmpegPath ?? (IS_MAC ? 'Not found — install with: brew install ffmpeg' : 'Not found — install with: winget install ffmpeg')}
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

        <div style={{ display: 'flex', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
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
          {!status?.ytdlpPath && (
            <button className="btn btn-sm" onClick={() => void onInstall('ytdlp')} disabled={installing != null}>
              {installing === 'ytdlp' ? 'Downloading…' : 'Download yt-dlp (no Python needed)'}
            </button>
          )}
          {!status?.ffmpegPath && (
            <button className="btn btn-sm" onClick={() => void onInstall('ffmpeg')} disabled={installing != null}>
              {installing === 'ffmpeg' ? 'Installing…' : 'Download ffmpeg'}
            </button>
          )}
        </div>

        <div style={{ display: 'flex', gap: 10, marginTop: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className={`chip${pyStatus?.path ? ' chip-ok' : ''}`}>{pyStatus?.path ? `python: ${pyStatus.version ?? pyStatus.path}` : 'python: not found'}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void onInstall('python')} disabled={installing != null || !pyStatus?.path}>
            {installing === 'python' ? 'Installing…' : 'pip install yt-dlp'}
          </button>
        </div>
        {!pyStatus?.path && (
          <p className="hint" style={{ marginTop: 8 }}>
            Python is optional — “Download yt-dlp” above works without it. Only needed if you prefer pip installs.
            Get it at python.org (tick “Add to PATH”).
          </p>
        )}

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

      <div className="card" style={{ marginBottom: 20 }}>
        <h2 style={{ margin: '0 0 6px', fontSize: 16 }}>Updates</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Installed version <strong>{appVersion ?? '…'}</strong>. Spinity checks on launch and
          downloads in the background — everything happens right here, nothing opens in a browser.
        </p>
        {(() => {
          const pct = updaterEvt?.type === 'progress' && typeof (updaterEvt.data as { percent?: number })?.percent === 'number'
            ? Math.round((updaterEvt.data as { percent: number }).percent)
            : null
          const version = (updaterEvt?.data as { version?: string } | undefined)?.version ?? ''
          return (
            <>
              {(updaterEvt?.type === 'available' || updaterEvt?.type === 'progress') && (
                <div className="sp-notif-progress" style={{ height: 6, margin: '4px 0 10px' }}>
                  <span className="sp-notif-fill" style={{ width: `${pct ?? 2}%` }} />
                </div>
              )}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                <button className="btn btn-sm" onClick={() => void onCheckUpdate()} disabled={updateChecking || updaterEvt?.type === 'progress'}>
                  {updateChecking ? 'Checking…' : 'Check for updates'}
                </button>
                {updaterEvt?.type === 'downloaded' && (
                  <button className="btn btn-sm" onClick={() => void window.spinity.updater.quitAndInstall()}>
                    Update now — restart Spinity
                  </button>
                )}
                <span className="hint" style={{ flex: 1, minWidth: 140 }}>
                  {updaterEvt?.type === 'downloaded'
                    ? `Update ${version} ready — one click restarts into it.`
                    : updaterEvt?.type === 'progress'
                      ? `Downloading ${version}… ${pct ?? 0}%`
                      : updaterEvt?.type === 'available'
                        ? `Update ${version} found — downloading…`
                        : updaterMsg}
                </span>
              </div>
            </>
          )
        })()}
      </div>

      <div className="card">
        <h2 style={{ margin: '0 0 10px', fontSize: 16 }}>Legal and storage</h2>
        <p className="hint" style={{ marginTop: 0 }}>
          Downloaded audio is stored on this computer only, under your {IS_MAC ? 'Application Support' : 'Windows AppData'}
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
