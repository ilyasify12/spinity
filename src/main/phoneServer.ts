/**
 * The phone web player server: spawns `website/web-server.cjs` as a child
 * process (running on Electron's own binary via ELECTRON_RUN_AS_NODE, so no
 * system Node install is needed) and exposes its status to the renderer.
 *
 * The same zero-dependency server serves the mobile player over the LAN:
 *   http://<pc-ip>:8901/player  — open on a phone on the same Wi-Fi.
 * It reads the library straight from %APPDATA%\spinity\spinity.json, so it
 * stays in sync with the desktop app for free.
 */
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import QRCode from 'qrcode'
import type { PhoneServerStatus } from '../shared/types'

const PORT = Number(process.env.SPINITY_PHONE_PORT) || 8901
let child: ChildProcess | null = null
let lastError: string | null = null
let logTail: string[] = []

/** The server script ships with the app: plain files beside the asar in prod. */
function scriptPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'website', 'web-server.cjs')
    : path.join(app.getAppPath(), 'website', 'web-server.cjs')
}

/**
 * The first non-internal IPv4 the phone should dial. Prefer the classic
 * home/office ranges: VPN and VM adapters (10.x) would "work" on this PC but
 * be unreachable from the phone.
 */
export function lanIp(): string | null {
  const candidates: string[] = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const ni of list ?? []) {
      if (ni.family === 'IPv4' && !ni.internal) candidates.push(ni.address)
    }
  }
  return (
    candidates.find((a) => a.startsWith('192.168.')) ??
    candidates.find((a) => a.startsWith('172.')) ??
    candidates.find((a) => a.startsWith('10.')) ??
    candidates[0] ??
    null
  )
}

export function phoneStatus(): PhoneServerStatus {
  const ip = lanIp()
  return {
    running: !!child,
    url: ip ? `http://${ip}:${PORT}/player` : null,
    localUrl: `http://localhost:${PORT}/player`,
    port: PORT,
    error: lastError,
    log: logTail.slice(-8)
  }
}

/** Start the LAN server. Resolves once it is listening (or has failed). */
export function startPhoneServer(): Promise<PhoneServerStatus> {
  if (child) return Promise.resolve(phoneStatus())
  lastError = null
  logTail = []
  const script = scriptPath()
  if (!fs.existsSync(script)) {
    lastError = `web player server not found at ${script}`
    return Promise.resolve(phoneStatus())
  }
  return new Promise((resolve) => {
    let settled = false
    const finish = (): void => {
      if (!settled) {
        settled = true
        resolve(phoneStatus())
      }
    }
    try {
      child = spawn(process.execPath, [script, String(PORT)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      })
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      child = null
      finish()
      return
    }
    const onOut = (chunk: Buffer): void => {
      const text = chunk.toString()
      for (const line of text.split(/\r?\n/)) if (line.trim()) logTail.push(line.trim())
      logTail = logTail.slice(-20)
      // The server prints its listening URLs on startup — that is "ready".
      if (/listening|http:\/\//i.test(text)) finish()
    }
    child.stdout?.on('data', onOut)
    child.stderr?.on('data', onOut)
    child.on('error', (err) => {
      lastError = err.message
      child = null
      finish()
    })
    child.on('exit', (code) => {
      child = null
      if (code && !lastError) {
        lastError = `web player server exited (code ${code})${logTail.length ? ' — ' + logTail[logTail.length - 1] : ''}`
      }
      finish()
    })
    // If it stays alive without saying anything, count that as running too.
    setTimeout(finish, 1500)
  })
}

export function stopPhoneServer(): PhoneServerStatus {
  if (child) {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
    child = null
  }
  return phoneStatus()
}

/** Dark-theme QR for the phone URL (dark modules on a white card stay scannable). */
export async function phoneQr(): Promise<string> {
  const url = phoneStatus().url
  if (!url) return ''
  return QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 1, width: 280 })
}
