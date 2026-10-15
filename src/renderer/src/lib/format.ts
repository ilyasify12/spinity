/** Formats seconds as m:ss, or h:mm:ss for long items (DJ sets, mixes). */
export function formatTime(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Truncates long titles for compact contexts. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/** Relative time for feeds ("just now", "5m", "3h", "Mar 4"). */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 0) return 'just now'
  const min = Math.floor(diff / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d`
  return new Date(t).toLocaleDateString([], { month: 'short', day: 'numeric' })
}
