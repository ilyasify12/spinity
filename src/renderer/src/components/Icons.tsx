import type * as React from 'react'

/**
 * Inline SVG icons.
 *
 * Hand-rolled rather than pulling in an icon package: it keeps the dependency
 * list tiny and guarantees the icons render with no font/CSP complications.
 */
interface IconProps {
  size?: number
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
})

export const IconPlay = ({ size = 18 }: IconProps): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M7 4.5v15l13-7.5z" />
  </svg>
)

export const IconPause = ({ size = 18 }: IconProps): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <rect x="6" y="4.5" width="4" height="15" rx="1" />
    <rect x="14" y="4.5" width="4" height="15" rx="1" />
  </svg>
)

export const IconPrev = ({ size = 18 }: IconProps): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M6 5h2.5v14H6z" />
    <path d="M19 5.5v13L9.5 12z" />
  </svg>
)

export const IconNext = ({ size = 18 }: IconProps): React.JSX.Element => (
  <svg {...base(size)} fill="currentColor" stroke="none">
    <path d="M15.5 5H18v14h-2.5z" />
    <path d="M5 5.5v13L14.5 12z" />
  </svg>
)

export const IconShuffle = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M16 3h5v5" />
    <path d="M4 20L21 3" />
    <path d="M21 16v5h-5" />
    <path d="M15 15l6 6" />
    <path d="M4 4l5 5" />
  </svg>
)

export const IconRepeat = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M17 2l4 4-4 4" />
    <path d="M3 11V9a4 4 0 014-4h14" />
    <path d="M7 22l-4-4 4-4" />
    <path d="M21 13v2a4 4 0 01-4 4H3" />
  </svg>
)

export const IconVolume = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M11 5L6 9H2v6h4l5 4z" />
    <path d="M15.5 8.5a5 5 0 010 7" />
    <path d="M18.5 5.5a9 9 0 010 13" />
  </svg>
)

export const IconMute = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M11 5L6 9H2v6h4l5 4z" />
    <path d="M22 9l-6 6" />
    <path d="M16 9l6 6" />
  </svg>
)

export const IconSearch = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
)

export const IconLibrary = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 3h3v18H4z" />
    <path d="M10 3h3v18h-3z" />
    <path d="M16.5 3.6l4 17.4" />
  </svg>
)

export const IconPlaylist = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M3 6h13" />
    <path d="M3 12h13" />
    <path d="M3 18h8" />
    <circle cx="18" cy="16" r="3" />
    <path d="M21 16V7" />
  </svg>
)

export const IconDownload = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 3v12" />
    <path d="M7 11l5 5 5-5" />
    <path d="M4 21h16" />
  </svg>
)

export const IconSettings = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-2.9 1.2V21a2 2 0 11-4 0v-.1A1.7 1.7 0 006 19.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1A1.7 1.7 0 003 13.6H3a2 2 0 110-4h.1A1.7 1.7 0 004.7 6L4.6 6a2 2 0 112.8-2.8l.1.1A1.7 1.7 0 0010 2.9V3a2 2 0 114 0v.1a1.7 1.7 0 002.9 1.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 001.2 2.9H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
  </svg>
)

export const IconTrash = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M6 6l1 15h10l1-15" />
  </svg>
)

export const IconPlus = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </svg>
)

export const IconExternal = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M14 4h6v6" />
    <path d="M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" />
  </svg>
)

export const IconFolder = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1z" />
  </svg>
)

export const IconUsers = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="9" cy="8" r="4" />
    <path d="M3 19a6 6 0 0112 0" />
    <circle cx="18" cy="9" r="3" />
    <path d="M16 19a5 5 0 015 0" />
  </svg>
)

export const IconUserPlus = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="9" cy="7" r="4" />
    <path d="M3 18a6 6 0 0112 0" />
    <path d="M16 8v6" />
    <path d="M13 11h6" />
  </svg>
)

export const IconChat = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 5h16a1 1 0 011 1v9a1 1 0 01-1 1H7l-3 3V6a1 1 0 011-1z" />
    <path d="M8 10h8" />
    <path d="M8 14h5" />
  </svg>
)

export const IconSend = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M20 4L4 11l6 2 2 6z" />
    <path d="M11 13l9-9" />
  </svg>
)

export const IconPhone = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M21 15.5a2 2 0 01-1.4-.6l-2.2-2.2a1 1 0 00-1.4 0l-1.2 1.2a15 15 0 01-5-5l1.2-1.2a1 1 0 000-1.4L8.8 3.9A2 2 0 018 2.5 2 2 0 006 4a12 12 0 0014 14 2 2 0 001.5-2 2 2 0 00-1-1.5z" />
  </svg>
)

export const IconPhoneOff = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M21 15.5a2 2 0 01-1.4-.6l-2.2-2.2a1 1 0 00-1.4 0l-1.2 1.2a15 15 0 01-2-1.5" />
    <path d="M6 4a12 12 0 0010 10" />
    <path d="M3 3l18 18" />
  </svg>
)

export const IconMic = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 10a7 7 0 0014 0" />
    <path d="M12 17v4" />
    <path d="M8 21h8" />
  </svg>
)

export const IconMicOff = ({ size = 15 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <rect x="9" y="3" width="6" height="8" rx="3" />
    <path d="M5 10a7 7 0 0012 3" />
    <path d="M12 17v4" />
    <path d="M8 21h8" />
    <path d="M3 3l18 18" />
  </svg>
)

export const IconBroadcast = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="2.5" />
    <path d="M15.5 8.5a6 6 0 010 7" />
    <path d="M18.5 5.5a10 10 0 010 13" />
    <path d="M8.5 8.5a6 6 0 000 7" />
    <path d="M5.5 5.5a10 10 0 000 13" />
  </svg>
)

export const IconCheck = ({ size = 14 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M5 12l5 5 9-11" />
  </svg>
)

export const IconX = ({ size = 14 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M6 6l12 12" />
    <path d="M18 6L6 18" />
  </svg>
)

export const IconCopy = ({ size = 14 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <rect x="9" y="9" width="9" height="9" rx="1.5" />
    <path d="M6 15V6a1.5 1.5 0 011.5-1.5H14" />
  </svg>
)

export const IconHeadphones = ({ size = 17 }: IconProps): React.JSX.Element => (
  <svg {...base(size)}>
    <path d="M4 13a8 8 0 0116 0" />
    <path d="M4 13a2 2 0 012 2v3a2 2 0 01-2 2h-1a1 1 0 01-1-1v-4a2 2 0 012-2z" />
    <path d="M20 13a2 2 0 00-2 2v3a2 2 0 002 2h1a1 1 0 001-1v-4a2 2 0 00-2-2z" />
  </svg>
)
