/**
 * WebRTC voice — single call at a time, peer-to-peer via socket signaling relayed
 * through the Electron main process. STUN comes from the server (with the user's
 * snippet as fallback), candidates are buffered until remote description is set.
 */

let pc: RTCPeerConnection | null = null
let localStream: MediaStream | null = null
let remoteAudio: HTMLAudioElement | null = null

let pendingCandidates: RTCIceCandidateInit[] = []
let onSignal: ((toUserId: string, callId: string, signal: unknown) => void) | null = null

const FALLBACK_ICE: RTCConfiguration = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }

async function getIce(): Promise<RTCConfiguration> {
  try {
    const r = await window.spinity.social.ice()
    if (r?.iceServers?.length) return { iceServers: r.iceServers as RTCIceServer[] }
  } catch {}
  return FALLBACK_ICE
}

function ensureRemoteAudio(): HTMLAudioElement {
  if (!remoteAudio) {
    remoteAudio = new Audio()
    remoteAudio.autoplay = true
  }
  return remoteAudio
}

export async function startCall(toUserId: string, callId: string, isCaller: boolean): Promise<void> {
  const config = await getIce()
  pc = new RTCPeerConnection(config)
  pendingCandidates = []
  onSignal = (uid, cid, signal) => { void window.spinity.social.callSignal(uid, cid, signal) }

  pc.onicecandidate = (e) => {
    if (e.candidate) onSignal?.(toUserId, callId, { type: 'candidate', candidate: e.candidate.toJSON() })
  }
  pc.ontrack = (e) => {
    const audio = ensureRemoteAudio()
    audio.srcObject = e.streams[0]
    void audio.play().catch(() => {})
  }

  localStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
  for (const track of localStream.getTracks()) pc.addTrack(track, localStream)

  if (isCaller) {
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    onSignal?.(toUserId, callId, { type: 'offer', sdp: offer.sdp })
  }
}

export async function handleSignal(signal: unknown): Promise<void> {
  if (!pc) return
  const s = signal as { type: string; sdp?: string; candidate?: RTCIceCandidateInit }
  if (s.type === 'offer' && s.sdp) {
    await pc.setRemoteDescription({ type: 'offer', sdp: s.sdp })
    for (const c of pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    pendingCandidates = []
    const answer = await pc.createAnswer()
    await pc.setLocalDescription(answer)
    // caller will be wired via closure in startCall — for callee we need to emit via stored onSignal
    // The caller of handleSignal is responsible for sending the answer via social.callSignal
    // We return the answer sdp via a global emit hook set by the Friends page
    const hook = (globalThis as unknown as { __spinitySendAnswer?: (sdp: string) => void }).__spinitySendAnswer
    hook?.(answer.sdp ?? '')
  } else if (s.type === 'answer' && s.sdp) {
    await pc.setRemoteDescription({ type: 'answer', sdp: s.sdp })
    for (const c of pendingCandidates) await pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {})
    pendingCandidates = []
  } else if (s.type === 'candidate' && s.candidate) {
    if (pc.remoteDescription) await pc.addIceCandidate(new RTCIceCandidate(s.candidate)).catch(() => {})
    else pendingCandidates.push(s.candidate)
  }
}

export function setMuted(muted: boolean): void {
  for (const t of localStream?.getAudioTracks() ?? []) t.enabled = !muted
}

export function endCall(): void {
  try { pc?.close() } catch {}
  pc = null
  for (const t of localStream?.getTracks() ?? []) try { t.stop() } catch {}
  localStream = null
  if (remoteAudio) { remoteAudio.srcObject = null; remoteAudio.pause() }
  pendingCandidates = []
  onSignal = null
}
