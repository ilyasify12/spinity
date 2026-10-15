/**
 * Profile customization: avatar gradient + UI accent theme.
 * Pure localStorage helpers; reactive state lives in the app store.
 */

export const AVATAR_BGS = [
  'linear-gradient(135deg, #ff6b00, #ff2d78)',
  'linear-gradient(135deg, #7c5cff, #ec4899)',
  'linear-gradient(135deg, #5b6cff, #9a6bff)',
  'linear-gradient(135deg, #34d399, #5b6cff)',
  'linear-gradient(135deg, #ffc06b, #ff6b00)',
  'linear-gradient(135deg, #64748b, #0f172a)'
]

/** AURORA accent palette — names match the design language, not crayons. */
export const ACCENTS = [
  { name: 'Blaze', value: '#ff6b00' },
  { name: 'Violet', value: '#7c5cff' },
  { name: 'Ice', value: '#5b6cff' },
  { name: 'Rose', value: '#ec4899' },
  { name: 'Mint', value: '#34d399' }
]

export const DEFAULT_ACCENT = '#FF6B00'

function avatarKey(userId: string | null | undefined): string | null {
  return userId ? `spinity:avatarBg:${userId}` : null
}

export function loadAvatarBg(userId: string | null | undefined): string {
  try {
    const k = avatarKey(userId)
    if (k) {
      const stored = localStorage.getItem(k)
      // Rebrand migration: old green avatar gradients become the new ember one.
      if (stored && stored.toLowerCase().includes('#1ed760')) return AVATAR_BGS[0]
      return stored ?? AVATAR_BGS[0]
    }
  } catch {}
  return AVATAR_BGS[0]
}

export function saveAvatarBg(userId: string | null | undefined, bg: string): void {
  try {
    const k = avatarKey(userId)
    if (k) localStorage.setItem(k, bg)
  } catch {}
}

export function loadAccent(): string {
  try {
    const stored = localStorage.getItem('spinity:accent')
    // Rebrand migration: the old green default becomes the new orange one so
    // existing installs pick up the identity without losing custom picks.
    if (!stored || stored.toLowerCase() === '#1ed760') return DEFAULT_ACCENT
    return stored
  } catch {
    return DEFAULT_ACCENT
  }
}

export function saveAccent(value: string): void {
  try {
    localStorage.setItem('spinity:accent', value)
  } catch {}
}

/** Apply the accent to every themed control at once. */
export function applyAccent(value: string): void {
  document.documentElement.style.setProperty('--accent', value)
  document.documentElement.style.setProperty('--accent-dim', value)
}

/** Custom uploaded picture, if any (served by the main process, never cached). */
export function avatarSrc(user: { id: string; avatarPath?: string | null } | null): string | null {
  if (!user?.avatarPath) return null
  return `spinity://avatar/${encodeURIComponent(user.id)}`
}
