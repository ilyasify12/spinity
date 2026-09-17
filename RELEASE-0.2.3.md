# Spinity 0.2.3

## Fixes
- Local cover art uses only embedded attached pictures; adjacent `cover.jpg`,
  `folder.jpg`, album folders, and guessed art are never reused by other songs.
- Songs without embedded art show a solid black tile immediately. Their art
  request completes in main with `404`.
- Embedded art is requested only when a tile has stayed visible, and work and
  extraction stay bounded. Covers and confirmed missing results persist across
  app launches in a filesystem cache, so restarting does not extract every song
  again. Artwork extraction still reads the original file and never modifies it.
- Electron build and both TypeScript project checks pass.

Embedded art still requires ffmpeg/ffprobe, because local metadata probing
already does. MP3 embedded PNG extraction is tested. Other combinations are not
individually covered.

## Checks performed
- Ten artwork/player tests passed; no failures.
- The 1,000-track Electron run did not report a result file after termination
  (ran beyond its timeout), so row-request behavior in that exact fixture is
  unverified and not represented in the release notes.
