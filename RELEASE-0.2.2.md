# Spinity 0.2.2

## Fixes
- Local artwork: embedded attached pictures are read with ffprobe/ffmpeg.
- If there is no embedded picture, look for a matching track image or
  cover/folder/front/album/artwork PNG/JPEG in the same directory.
- Existing imported tracks get artwork URLs when their library is loaded;
  no removal/reimport is needed. Artwork is loaded on demand, with bounded
  concurrency and an in-memory cache. Audio files are never modified.
- Tracks without readable art display a neutral music tile.
- A visible Play button is present on each playable row. Library and playlist
  buttons start at the selected row and retain the displayed list as the queue.
- Keyboard interaction with row action buttons no longer triggers row playback.

## Checks performed
- Seven Node tests passed (embedded artwork, sidecar art, absent art/missing file,
  cache, and three existing player regressions).
- TypeScript main and renderer checks passed; production build passed.
- Electron runtime: an existing track with an empty thumbnail loaded embedded
  cover art; a plain track displayed a placeholder; clicking the second row's
  Play button selected the second song and advanced playback; Previous selected
  the first song; artwork requests for an unknown track returned 404.

Embedded artwork requires ffmpeg and ffprobe on the PC, as used by the existing
local metadata/download functionality. Separate PNG/JPEG covers work without
those tools. Album-art extraction was tested with MP3 embedded PNG artwork; not
all audio/container/image combinations have been individually tested.
