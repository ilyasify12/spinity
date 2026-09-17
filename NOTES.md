# Spinity — engineering notes

Local-first Windows desktop music player. Library is built by downloading audio
from YouTube via `yt-dlp`, tag-extracting with `ffmpeg`, and storing it on disk
per local user profile. Playback after download is fully offline.

## Verified environment (measured, not assumed)

| Tool | Status | Path |
| --- | --- | --- |
| Node | v24.13.0 | — |
| npm | 11.6.2 | — |
| Python | 3.11.0 | — |
| yt-dlp | 2026.08.19 | `%LOCALAPPDATA%\Programs\Python\Python311\Scripts\yt-dlp.exe` |
| ffmpeg | 8.1-full (gyan.dev) | `%LOCALAPPDATA%\Microsoft\WinGet\Links\ffmpeg.exe` |
| dotnet | present | `C:\Program Files\dotnet\dotnet.exe` |
| cargo/rustc | **absent** | → Tauri ruled out, Electron chosen |

Smoke test that passed:

```
yt-dlp --dump-json --skip-download "https://www.youtube.com/watch?v=aqz-KE-bpKQ"
→ title "Big Buck Bunny 60fps 4K - Official Blender Foundation Short Film"
  uploader "Blender"  duration 635  id "aqz-KE-bpKQ"
```

## Stack decision

**Electron + React + TypeScript + Vite (`electron-vite`).**

- Electron main process is Node, so it can spawn `yt-dlp.exe` / `ffmpeg.exe`
  and write the library to disk. A browser app cannot do either.
- Tauri rejected: no Rust toolchain installed here.
- **No native modules.** `better-sqlite3` and friends need `node-gyp` +
  Visual Studio build tools and break on Electron ABI rebuilds. Persistence is
  a plain JSON store via `fs` instead — zero install risk.

### Resolved dependency versions (actually installed and built)

```
dependencies     react ^19.3.0   react-dom ^19.3.0   zustand ^5.0.0
devDependencies  electron ^44.4.1            electron-vite ^5.0.0
                 vite ^7.3.6                 @vitejs/plugin-react ^5.2.0
                 typescript ^7.0.2            electron-builder ^26.15.3
                 @types/node ^24.13.5         @types/react ^19.3.0
                 @types/react-dom ^19.3.0
```

### Three build gotchas found by actually building (not guessed)

1. **vite must be pinned to ^7.** `electron-vite@5` peer-requires
   `vite ^5||^6||^7`, but `@vitejs/plugin-react@6` requires `vite ^8`.
   Plain `npm i vite` resolves to 8.x and fails with `ERESOLVE`.
   `@vitejs/plugin-react@5.x` accepts both, which resolves the conflict.

2. **TypeScript 7 removed `baseUrl`** (`error TS5102`). Path aliases must be
   declared relative without it:
   `"paths": { "@shared/*": ["./src/shared/*"] }`

3. **npm prunes undeclared packages.** Installing devDependencies when
   `react`/`react-dom` were not in `package.json` silently deleted them,
   which surfaced as `Rollup failed to resolve import "react/jsx-runtime"`.
   All runtime deps must be declared before any install runs.


## Security model

- `contextIsolation: true`, `nodeIntegration: false`, `sandbox` where possible.
- The renderer never touches `fs` or `child_process`; it talks only through a
  narrow `window.spinity` API exposed in the preload script.
- All yt-dlp arguments are passed as an **argv array** via `spawn` with
  `shell: false`. User input is never interpolated into a shell string, so a
  title or URL containing quotes/`;` cannot inject a command.
- Passwords are hashed with **scrypt** (`node:crypto`) and per-user random salt,
  compared with `timingSafeEqual`. No external auth service.

## Legal note (documented once, deliberately)

Downloading from YouTube violates YouTube's Terms of Service, and downloading
copyrighted music without permission infringes copyright. Running locally does
not change that — the download is the potentially infringing act. Practical
consequences include account termination and, in some jurisdictions,
infringement notices or damages.

Intended use is personal, for content the user has the right to: their own
uploads, Creative Commons, public domain, or otherwise licensed material.
This app is not a redistribution tool. `yt-dlp` and `ffmpeg` are legitimate,
widely-used open-source tools; the surrounding application is legal to build
and operate. The UI surfaces a licensing indicator per track to keep this
visible.

## Architecture

```
src/main/       Node: window lifecycle, IPC, JSON store, accounts, yt-dlp control
src/preload/    contextBridge → window.spinity
src/renderer/   React UI (Spotify-style dark theme)
```

Ingestion pipeline:

```
search  → yt-dlp --dump-json --flat-playlist   (metadata only, no download)
queue   → per-user job queue, concurrency-capped
fetch   → yt-dlp -x --audio-format m4a  (ffmpeg does the transcode)
store   → %APPDATA%/spinity/users/<userId>/audio/<id>.m4a
index   → library entry in the local JSON store
```

Known gotcha: yt-dlp is a moving target — YouTube changes break older builds
regularly. The app therefore reports the installed yt-dlp version in Settings
and supports an in-app update path (`yt-dlp -U`).

## Verified results

```
npm install   exit=0
npm run typecheck   exit=0   (both tsconfig.node.json and tsconfig.web.json)
npm run build       exit=0
  out/main/index.js                 28.5 KB
  out/preload/index.js               3.3 KB
  out/renderer/index.html            1.0 KB
  out/renderer/assets/index-*.css    9.8 KB
  out/renderer/assets/index-*.js   688.6 KB
```

Boot test: launching the built app ran the process for 16+ seconds with an
**empty stderr** — the main process registered the custom protocol and IPC,
created the window, and loaded the renderer with no exceptions.

## How to run

Run these yourself — see the sandbox note below for why.

```powershell
cd C:\Users\ilyasify\Documents\spinity
npm install
npm run dev        # development, hot reload
npm run build      # production bundle into out/
npm run dist       # Windows installer into release/
```

`yt-dlp` and `ffmpeg` are already present on this machine, so downloads work
with no further setup. The app re-checks for them in Settings.

## Sandbox constraint (important)

Child processes in this environment **cannot create or delete files** under
`C:\Users\ilyasify\Documents` — `Set-Content`, `New-Item` and `Remove-Item` all
fail there with "Could not find file", while `$env:TEMP` works normally. Only
the editor tool could write to the project directory.

Consequences:

- `npm install` was run against a mirror of the project in
  `%TEMP%\spinity-build`, which is where the build and boot tests happened.
- `npm install` cannot be run inside the project folder by an automated
  process here, so **the first `npm install` in the project must be run by you.**
- The scratch scripts below could not be deleted for the same reason.

## Setup outcome (what was actually done)

`npm install` cannot be run inside `Documents\spinity` by this agent because
the sandbox account (`CodexSandboxUsers`) holds only `ReadAndExecute` there.
`ilyasify` holds `FullControl`, so running it from a normal terminal works.

What was done instead:

- A **ready-to-run copy** was created at `C:\Users\ilyasify\Spinity-ready`
  (535 MB), containing source + `node_modules` + a production `out/` build.
  It is launched by double-clicking `start.cmd` in that folder.
- Verified in the ready copy: `npm run typecheck` exit=0, `npm run build`
  exit=0, and `npm run dev` booting 5 Electron processes stable for 45s with
  an empty stderr.
- `setup.cmd` and `start.cmd` were added to the workspace for the user, since
  their own terminal can install there normally.

The ready copy is a snapshot. If the source in `Documents\spinity` changes,
either re-run `setup.cmd` there or delete and recreate `Spinity-ready`.

## Helper scripts (development only — safe to delete)

| File | Purpose |
| --- | --- |
| `build-and-verify.ps1` | Mirrors sources to `%TEMP%`, installs, typechecks, builds |
| `run-app.ps1` | Boots the built app from the mirror and captures stderr |
| `diagnose.ps1`, `dev-test.ps1` | Boot monitors for the built app and for dev mode |
| `copy-ready.ps1`, `verify-ready.ps1` | Created and verified the `Spinity-ready` copy |
| `install.cmd`, `install-runner.ps1` | Early install attempts (superseded) |
| `search-probe.ps1`, `detach-test.ps1` | Throwaway diagnostics |

None are required to run the app.

Two cautions before running any of them:

- `run-app.ps1`, `diagnose.ps1` and `dev-test.ps1` open a **real Spinity
  window on screen** while they monitor, then close it. That is expected.
- `run-app.ps1` was written before the PID-scoped cleanup was added, so it
  still stops **every** Electron process by name — do not run it while an
  instance you care about is open.


## Architecture notes worth knowing

- **One `<audio>` element for the whole app**, created at module scope in
  `src/renderer/src/player/engine.ts`. Recreating it per track is the most
  common cause of overlapping playback and lost position state.
- **Audio streams through `spinity://audio/<trackId>`**, a privileged custom
  scheme registered in `src/main/index.ts`. This keeps `webSecurity` ON while
  allowing Range requests, which is what makes seeking work against local
  files. It also avoids the usual (bad) fix of setting `webSecurity: false`.
- **Signed URLs are never stored.** The renderer only knows a track id; the
  main process resolves it to a real path at request time.
- **Downloads auto-file into the library** on completion, keyed by `userId`, so
  a job started by one profile can never land in another's library.

## Known limitations / sensible next steps

- Search returns 20 results with no pagination or infinite scroll.
- Whole playlists/channels cannot be imported (`--no-playlist` is forced).
- No reordering inside playlists; no "recently played" or play counts.
- Metadata is whatever yt-dlp writes by default — cover art is not embedded
  into the file, and the UI shows the YouTube thumbnail instead.
- **Bot checks:** YouTube sometimes demands a sign-in confirmation. A future
  improvement is supporting `--cookies-from-browser chrome`, surfaced as a
  Settings toggle. Today the error message points the user at updating yt-dlp.
- No playlist/library export-import yet, which matters if the JSON store in
  `%APPDATA%\spinity\spinity.json` is ever lost.

