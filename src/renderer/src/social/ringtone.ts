/**
 * Call ringtones, synthesized with WebAudio (no audio assets needed).
 *
 * - Outgoing: classic US ring — 440+480 Hz, 2s on / 4s off — until the other
 *   side accepts, declines, or the call errors.
 * - Incoming: urgency double-chirp loop until accept/decline.
 *
 * Everything runs through one AudioContext + gain node; `stop()` tears it
 * all down. If the browser blocks audio (no gesture yet, e.g. an incoming
 * call while the window was never clicked), start fails silently and the
 * visual overlay + desktop notification still carry the call.
 */

let ctx: AudioContext | null = null
let gain: GainNode | null = null
let timer: number | null = null
let oscs: OscillatorNode[] = []

function ensure(): boolean {
  try {
    if (!ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AC) return false
      ctx = new AC()
    }
    if (ctx.state === 'suspended') void ctx.resume().catch(() => {})
    if (!gain) {
      gain = ctx.createGain()
      gain.gain.value = 0.12
      gain.connect(ctx.destination)
    }
    return true
  } catch {
    return false
  }
}

function tone(freq: number, at: number, dur: number): void {
  if (!ctx || !gain) return
  try {
    const o = ctx.createOscillator()
    o.type = 'sine'
    o.frequency.value = freq
    o.connect(gain)
    o.start(at)
    o.stop(at + dur)
    oscs.push(o)
    o.onended = () => {
      oscs = oscs.filter((x) => x !== o)
      try { o.disconnect() } catch {}
    }
  } catch {}
}

function clearLoop(): void {
  if (timer != null) {
    window.clearInterval(timer)
    timer = null
  }
}

export function stopRingtone(): void {
  clearLoop()
  for (const o of oscs) {
    try { o.stop() } catch {}
    try { o.disconnect() } catch {}
  }
  oscs = []
}

/** Outgoing ring-back: 2s on, 4s off. Call after the user's click (gesture). */
export function startOutgoingRing(): void {
  stopRingtone()
  if (!ensure() || !ctx) return
  const pattern = (): void => {
    if (!ctx) return
    const t = ctx.currentTime + 0.05
    for (const f of [440, 480]) tone(f, t, 2)
  }
  pattern()
  timer = window.setInterval(pattern, 6000)
}

/** Incoming ring: two short chirps every 2.5s. */
export function startIncomingRing(): void {
  stopRingtone()
  if (!ensure() || !ctx) return
  const pattern = (): void => {
    if (!ctx) return
    const t = ctx.currentTime + 0.05
    tone(880, t, 0.18)
    tone(660, t + 0.25, 0.18)
  }
  pattern()
  timer = window.setInterval(pattern, 2500)
}
