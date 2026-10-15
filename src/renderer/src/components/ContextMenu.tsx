import { useEffect } from 'react'
import { create } from 'zustand'
import { t } from '../lib/i18n'

/**
 * Global right-click menu. Any component opens it via `openContextMenu(e,
 * items)`; a single `MenuHost` (mounted in App) renders it. One menu at a
 * time, closes on click-away / Esc / scroll / resize, flips near screen
 * edges, supports one level of submenus (e.g. "Add to playlist ▸").
 */

export interface MenuItem {
  label: string
  hint?: string
  /** Red destructive action (delete, remove, leave...). */
  danger?: boolean
  disabled?: boolean
  onSelect?: () => void
  children?: MenuItem[]
}

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

interface MenuStore {
  menu: MenuState | null
  open: (x: number, y: number, items: MenuItem[]) => void
  close: () => void
}

export const useMenu = create<MenuStore>((set) => ({
  menu: null,
  open: (x, y, items) => set({ menu: items.length > 0 ? { x, y, items } : null }),
  close: () => set({ menu: null })
}))

/** Attach to any `onContextMenu`: suppresses the native menu and opens ours. */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]): void {
  e.preventDefault()
  e.stopPropagation()
  if (items.length === 0) return
  useMenu.getState().open(e.clientX, e.clientY, items)
}

/** "Add to playlist ▸" submenu shared by every track menu. */
export function playlistSubmenu(
  playlists: { id: string; name: string }[],
  onPick: (playlistId: string) => void
): MenuItem {
  return {
    label: t('action.addPlaylist', 'Add to playlist'),
    children:
      playlists.length === 0
        ? [{ label: t('ui.noPlaylistsYet', 'No playlists yet'), disabled: true }]
        : playlists.map((p) => ({ label: p.name, onSelect: () => onPick(p.id) }))
  }
}

const WIDTH = 240
const ITEM_H = 34

function MenuList({ items, depth }: { items: MenuItem[]; depth: number }): React.JSX.Element {
  const close = useMenu((s) => s.close)
  return (
    <div className={`ctx-menu${depth > 0 ? ' sub' : ''}`} role="menu">
      {items.map((item, i) => (
        <div key={i} className="ctx-item-wrap">
          <button
            role="menuitem"
            disabled={item.disabled}
            className={`ctx-item${item.danger ? ' danger' : ''}${item.children ? ' has-sub' : ''}`}
            onClick={() => {
              if (item.children || item.disabled) return
              close()
              item.onSelect?.()
            }}
          >
            <span className="ctx-label">{item.label}</span>
            {item.hint && <span className="ctx-hint">{item.hint}</span>}
            {item.children && <span className="ctx-arrow">▸</span>}
          </button>
          {item.children && item.children.length > 0 && (
            <div className="ctx-sub">
              <MenuList items={item.children} depth={depth + 1} />
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

export function MenuHost(): React.JSX.Element | null {
  const menu = useMenu((s) => s.menu)
  const close = useMenu((s) => s.close)

  useEffect(() => {
    if (!menu) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    // Any scroll (capture) or outside mousedown dismisses.
    const onScroll = (): void => close()
    const onDown = (e: MouseEvent): void => {
      if (!(e.target as HTMLElement).closest('.ctx-menu')) close()
    }
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('mousedown', onDown)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('mousedown', onDown)
    }
  }, [menu, close])

  if (!menu) return null
  const height = Math.min(menu.items.length * ITEM_H + 12, window.innerHeight - 16)
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8))

  return (
    <div className="ctx-host" style={{ left, top, ['--ctx-w' as string]: `${WIDTH}px` }}>
      <MenuList items={menu.items} depth={0} />
    </div>
  )
}
