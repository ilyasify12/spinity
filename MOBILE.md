# Spinity for Android

The phone app is the same player the desktop app serves (`website/player`),
wrapped in a Capacitor shell under `mobile/`. Two ways to run it:

- **Browser / PWA** (already working): open `http://<your-pc-ip>:8901/player`
  from the desktop app's *Settings → Phone*, or Add to Home Screen.
- **APK** (this folder): a real app icon that also works **away from the PC**.

## What the APK adds over the PWA

The PWA needs the desktop app running (it talks to its web server). The APK
carries its own tiny backend instead — `website/player/native.js` — which
answers every `/api/...` call locally:

| Endpoint | Inside the APK |
| --- | --- |
| library, likes, playlists, auth | localStorage on the phone |
| stream / playback | files on disk: app downloads **plus any music folder on the phone** |
| ytsearch, save | **yt-dlp bundled in the APK** (python + ffmpeg inside `YtDlpEngine`); Termux is an optional fallback |
| lyrics | lrclib.net, straight from the phone |
| probe (codec tag) | not available on the phone (needs ffprobe server-side) |

In a browser this file is inert — the same player keeps talking to the desktop
server, so nothing above changes for the desktop/PWA use.

## Your music, on the phone

The app scans on-device folders and merges everything into the Library — no
setup:

- `Download/Spinity/audio` — songs downloaded inside the app (always scanned).
- `Music/` — the phone's own music folder (on by default).
- `Download/` — everything with an audio extension (off by default).

Copy songs into any of those with a file manager and they show up in the
Library — with the **real cover art embedded in each file** (read from the
file's tags via `MediaMetadataRetriever`, cached under
`Download/Spinity/covers/`), never a guessed thumbnail. Deleting a file removes
it from the Library on the next scan.

The **Settings** screen in the app (gear icon, top right) has the local-files
switches (which folders, auto-scan on launch), **Add music files…** (imports
through the system picker into `Download/Spinity/audio`), engine status and
cache clearing.

## YouTube search & downloads: built in

The APK bundles yt-dlp itself — `io.github.junkfood02.youtubedl-android`
(python + yt-dlp + ffmpeg, all inside the APK, `arm64-v8a`). First launch
unpacks it once in the background (a few seconds); after that search and
downloads work with **zero setup: no Termux, no root, no terminal**. The
Settings screen shows the engine state and has an **Update engine** button
(yt-dlp rots as YouTube changes; updating keeps it fresh).

### Termux fallback (optional, power users)

If the bundled engine ever cannot run (very old Android, exotic storage
restrictions), the app can drive **Termux** instead. Install **Termux from
F-Droid** (the Play Store build is abandoned), then run, once:

```sh
termux-setup-storage
pkg update && pkg upgrade -y
pkg install -y python ffmpeg
pip install -U "yt-dlp[default]"
mkdir -p ~/storage/downloads/Spinity/audio ~/storage/downloads/Spinity/jobs
echo "allow-external-apps=true" >> ~/.termux/termux.properties
termux-reload-settings
```

The app shows this same list (with a Copy button) when it needs it — the panel
only appears when both engines are unavailable. Then tap **Allow file access**
and give Spinity "All files" access, and **Check again**.

## Building the APK

No Android SDK is needed locally — the workflow
`.github/workflows/build-android.yml` builds it in the cloud:

- **Actions → Build Android → Run workflow**, or push a tag (`v*`).
- Download the `spinity-android` artifact (`app-debug.apk`) and open it on the
  phone (allow installing from unknown sources).

For a local build you need JDK 17+ and the Android SDK, then:

```sh
cd mobile
npm install
npx cap sync android     # copies website/player into the APK project
cd android
./gradlew assembleDebug  # -> app/build/outputs/apk/debug/app-debug.apk
```

The APK is debug-signed: fine for sideloading, not for the Play Store.
`MANAGE_EXTERNAL_STORAGE` ("All files") is likewise not Play-Store-fine — it
is the pragmatic permission for a personal, sideloaded music app. The build
ships `arm64-v8a` only (every phone since ~2018); add `armeabi-v7a` in
`android/app/build.gradle` for very old devices.

## Layout

```
mobile/
  capacitor.config.json      appId com.spinity.player, webDir ../website/player
  android/                   the generated Android project (committed)
    app/src/main/java/com/spinity/player/
      MainActivity.java        registers the bridge plugins, kicks off the engine unpack
      SpinityBridgePlugin.java scan folders / import files / engine methods
      YtDlpEngine.java         bundled yt-dlp: init, search, download, update
      TermuxBridgePlugin.java  Termux fallback: status / requestFilesAccess / openTermux / exec
website/player/native.js     the local /api implementation (tested in tests/nativeShim.test.cjs)
```

## How a download flows

1. Search in the app → `/api/ytsearch` → the bundled engine runs
   `yt-dlp -J --flat-playlist "ytsearch12:..."` in-process and returns the
   results (the Termux route writes a job file instead, when it is the engine
   in use).
2. Tap **Save** → `/api/save` → the engine downloads
   `yt-dlp -x --audio-format mp3 --embed-thumbnail` for that video into
   `Download/Spinity/audio/<videoId>.mp3`; native.js polls the job for
   progress and adds the track to the phone library when it lands.
3. The first run of either engine unpacks in the background; search waits a
   moment for it and says so in Settings.
