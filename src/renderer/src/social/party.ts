import { computeSyncTarget, shouldSeek } from '@shared/social'

export function applyPartySync(
  audio: HTMLAudioElement,
  playback: { trackIndex: number; positionMs: number; isPlaying: boolean; updatedAt: string },
  serverAt: number
): void {
  const target = computeSyncTarget(playback as never, serverAt, Date.now())
  if (shouldSeek(audio.currentTime, target)) audio.currentTime = target
  else if (Math.abs(audio.currentTime - target) > 0.3) audio.playbackRate = audio.currentTime < target ? 1.02 : 0.98
  else audio.playbackRate = 1

  if (playback.isPlaying && audio.paused) void audio.play().catch(() => {})
  if (!playback.isPlaying && !audio.paused) audio.pause()
}
