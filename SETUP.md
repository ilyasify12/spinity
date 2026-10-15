# Starting Spinity

## The easy way

Double-click **`setup.cmd`** in this folder.

It installs everything, checks `yt-dlp` and `ffmpeg`, then launches the app.
The first run downloads Electron (~100 MB) and takes a few minutes — that is
normal. Leave the black window open while you use the app; closing it stops
Spinity.

After the first time, double-click **`start.cmd`** to launch it.

## The command-line way

```powershell
cd C:\Users\ilyasify\Documents\spinity
npm install     # first time only
npm run dev
```

## First run inside the app

1. **Create account** — username 3-24 characters (letters, numbers, `_ . -`),
   password at least 6 characters. This is a local account on this PC only.
2. **Search** — find a track, click **Save** to download it.
3. **Library** — downloaded tracks appear here and play fully offline.

Try searching for **Big Buck Bunny** first. It is Creative Commons licensed,
so it is a safe way to confirm the whole download-and-play pipeline works
before you rely on it for anything else.

## On your phone (same Wi-Fi)

The phone player streams the library straight from this PC — no copying files.

1. On the PC, open a terminal in the Spinity folder and run:

   ```powershell
   node website/web-server.cjs
   ```

2. It prints a link like `http://192.168.1.21:8901/player`. Type that address
   in your phone's browser (Chrome on Android), or tap **Add to Home screen**
   in the browser menu to get a Spinity icon on your phone.

3. Log in with your desktop account or create a separate one — the phone
   player keeps its own accounts in `%APPDATA%\spinity\web-users.json`.

On the phone you get the full player: browse and stream your library, search
YouTube and tap **Save** (the file is downloaded to this PC with yt-dlp),
likes and playlists, lyrics, and a **download icon** in the now-playing sheet
to save a track onto the phone itself. Keep the terminal window open while
you listen; the phone needs this PC turned on and on the same Wi-Fi.

Two things that need `https://` (or the future Android app) rather than a
plain `http://` LAN address: installing it as a real app (Add to Home screen
still works, but as a browser shortcut) and the richer lockscreen controls.
Music still keeps playing with the screen off either way.

## Requirements

| Requirement | Status on this PC |
| --- | --- |
| Node.js 18+ | installed (v24.13.0) |
| yt-dlp | installed (2026.08.19) |
| ffmpeg | installed (8.1) |

If a check fails, `setup.cmd` prints the exact command to fix it.

## If something goes wrong

- **A black window appears and closes instantly** — something failed early.
  Run `setup.cmd` from a terminal (type `cmd` in the address bar of this
  folder) so the window stays open and you can read the error.
- **"Dependencies are missing"** — run `setup.cmd` before `start.cmd`.
- **A download fails with a bot-check message** — open **Settings** in the app
  and click **Update yt-dlp**. YouTube changes often, and updating usually
  fixes it.

## A note on where things are stored

- **Your music and accounts:** `%APPDATA%\spinity\` — never uploaded anywhere.
- **This source code:** `C:\Users\ilyasify\Documents\spinity\`

See `NOTES.md` for the technical details and the legal note about downloading.
