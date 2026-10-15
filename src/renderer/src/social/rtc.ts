/**
 * WebRTC voice — single call at a time, peer-to-peer via socket signaling relayed
 * through the Electron main process.
 *
 * Fixes applied:
 * - incoming signals are buffered when the peer connection doesn't exist yet
 *   (callee's offer often arrives before they press Accept)
 * - remote audio uses a persistent <audio> element attached to the DOM so
 *   autoplay policies + volume apply reliably
 * - mic errors (denied / no device) are thrown with actionable messages
 * - mute state + mic level metering for UI
 */

let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteAudio: HTMLAudioElement | null = null
let analyser: AnalyserNode | null = null
let audioCtx: AudioContext | null = null

let pendingSignals: unknown[] = []
let onSignal: ((toUserId: string, callId: string, signal: unknown) => void) | null = null
let currentPeer: { toUserId: string; callId: string } | null = null
let muted = false
let levelCb: ((level: number) => void) | null = null
let levelTimer: number | null = null

const FALLBACK_ICE: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' }
  ]
}

async function getIce(): Promise<RTCConfiguration> {
  try {
    const r = await window.spinity.social.ice()
    if (r?.iceServers?.length) return { iceServers: r.iceServers as RTCIceServer[] }
  } catch {}
  return FALLBACK_ICE
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = document.createElement('audio')
    remoteAudio.id = 'spinity-remote-audio'
    remoteAudio.autoplay = true
    remoteAudio.controls = false
    // Required for autoplay in Chromium without a gesture chain.
    try { (remoteAudio as unknown as { playsInline: boolean }).playsInline = true } catch {}
    document.body.appendChild(remoteAudio)
  }
  return remoteAudio
}

function startLevelMeter(): void {
  stopLevelMeter()
  try {
    if (!localStream) return
    audioCtx = new AudioContext()
    const src = audioCtx.createMediaStreamSource(localStream)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    src.connect(analyser)
    const buf = new Uint8Array(analyser.frequencyBinCount)
    levelTimer = window.setInterval(() => {
      if (!analyser) return
      analyser.getByteTimeDomainData(buf)
      let peak = 0
      for (const v of buf) {
        const d = Math.abs(v - 128) / 128
        if (d > peak) peak = d
      }
      levelCb?.(Math.min(1, peak * 1.6))
    }, 120)
  } catch {}
}

function stopLevelMeter(): void {
  if (levelTimer != null) {
    window.clearInterval(levelTimer)
    levelTimer = null
  }
  try { audioCtx?.close() } catch {}
  audioCtx = null
  analyser = null
}

export function onMicLevel(cb: (level: number) => void): () => void {
  levelCb = cb
  return () => {
    if (levelCb === cb) levelCb = null
  }
}

async function acquireMic(): Promise<MediaStream> {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    })
    if (stream.getAudioTracks().length === 0) throw new Error('No microphone track — check your input device')
    return stream
  } catch (err) {
    const name = (err as { name?: string })?.name ?? ''
    if (name === 'NotAllowedError') throw new Error('Microphone blocked — allow mic access for Spinity in Windows Settings → Privacy → Microphone, then try again')
    if (name === 'NotFoundError') throw new Error('No microphone found — plug in a mic and try again')
    if (name === 'NotReadableError') throw new Error('Microphone is busy — close other apps using it (Discord, Zoom) and retry')
    throw new Error(err instanceof Error ? `Microphone error: ${err.message}` : 'Could not access microphone')
  }
}

function buildPc(toUserId: string, callId: string, config: RTCConfiguration): RTCPeerConnection {
  const connection = new RTCPeerConnection(config)
  connection.onicecandidate = (e) => {
    if (e.candidate) onSignal?.(toUserId, callId, { type: 'candidate', candidate: e.candidate.toJSON() })
  }
  connection.ontrack = (e) => {
    const audio = ensureRemoteAudio()
    audio.srcObject = e.streams[0]
    // Must play inside a user gesture chain where possible; retry once.
    void audio.play().catch(() => {
      setTimeout(() => void audio.play().catch(() => {}), 500)
    })
  }
  connection.onconnectionstatechange = () => {
    if (connection.connectionState === 'failed') {
      // ICE restart helps on flaky NATs.
      try { void connection.restartIce() } catch {}
    }
  }
  return connection
}

export async function startCall(toUserId: string, callId: string, isCaller: boolean): Promise<void> {
  endCall(true)
  const config = await getIce()
  currentPeer = { toUserId, callId }
  onSignal = (uid, cid, signal) => {
    void window.spinity.social.callSignal(uid, cid, signal)
  }

  localStream = await acquireMic()
  for (const t of localStream.getAudioTracks()) t.enabled = !muted
  startLevelMeter()

  pc = buildPc(toUserId, callId, config)
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream)

  // Flush anything that arrived before the PC existed (callee offer race).
  const queued = pendingSignals
  pendingSignals = []
  for (const sig of queued) await applySignal(sig)

  if (isCaller) {
    const offer = await pc.createOffer({ offerToReceiveAudio: true })
    await pc.setLocalDescription(offer)
    onSignal?.(toUserId, callId, { type: 'offer', sdp: offer.sdp })
  }
}

async function applySignal(signal: unknown): Promise<void> {
  if (!pc || !currentPeer) {
    pendingSignals.push(signal)
    return
  }
  const s = signal as { type: string; sdp?: string; candidate?: RTCIceCandidateInit }
  if (s.type === 'offer' && s.sdp) {
    await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp })
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    const hook = (globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer
    if (hook) hook?.(answer.sdp ?? '')
    else onSignal?.(currentPeer.toUserId, currentPeer.callId, { type: 'answer', sdp: answer.sdp })
  } else if (s.type === 'answer' && s.sdp) {
    await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp })
  } else if (s.type === 'candidate' && s.candidate) {
    try {
      if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(s.candidate))
      else pendingSignals.push(signal)
    } catch {
      // Ignore stale candidates.
    }
  }
}

export async function handleSignal(signal: unknown): Promise<void> {
  // No PC yet (callee hasn't pressed Accept): buffer until startCall flushes.
  if (!pc) {
    pendingSignals.push(signal)
    return
  }
  await applySignal(signal)
}

export function setMuted(m: boolean): void {
  muted = m
  for (const t of localStream?.getAudioTracks() ?? []) t.enabled = !m
}

export function isMuted(): boolean {
  return muted
}

export function endCall(keepPending = false): void {
  try { pc?.close() } catch {}
  pc = null
  for (const t of localStream?.getTracks() ?? []) try { t.stop() } catch {}
  localStream = null
  stopLevelMeter()
  if (remoteAudio) {
    try { remoteAudio.srcObject = null } catch {}
    try { remoteAudio.pause() } catch {}
  }
  if (!keepPending) pendingSignals = []
  onSignal = null
  currentPeer = null
}
