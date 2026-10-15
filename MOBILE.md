# Spinity for Android

The phone app is the same player the desktop app serves (`website/player`),
wrapped in a Capacitor shell under `mobile/`. Two ways to run it:

- **Browser / PWA** (already working): open `http://<your-pc-ip>:8901/player`
  from the desktop app's *Settings → Phone*, or Add to Home Screen.
- **APK** (this folder): a real app icon that also works **away from the PC**,
  downloading music on the phone itself with yt-dlp.

## What the APK adds over the PWA

The PWA needs the desktop app running (it talks to its web server). The APK
carries its own tiny backend instead — `website/player/native.js` — which
answers every `/api/...` call locally:

| Endpoint | Inside the APK |
| --- | --- |
| library, likes, playlists, auth | localStorage on the phone |
| stream / playback | the mp3s downloaded to `Download/Spinity/audio` |
| ytsearch, save | **yt-dlp, run through Termux** (search + download + mp3 + cover art) |
| lyrics | lrclib.net, straight from the phone |
| probe (codec tag) | not available on the phone (needs ffprobe server-side) |

In a browser this file is inert — the same player keeps talking to the desktop
server, so nothing above changes for the desktop/PWA use.

## One-time phone setup (Termux)

The APK doesn't ship yt-dlp: YouTube changes constantly and a bundled copy
would rot. Instead the app drives **Termux** (a real Linux userland for
Android), so yt-dlp stays a single `pip` command away from up to date.

Install **Termux from F-Droid** (the Play Store build is abandoned), then run,
once:

```sh
termux-setup-storage
pkg update && pkg upgrade -y
pkg install -y python ffmpeg
pip install -U "yt-dlp[default]"
mkdir -p ~/storage/downloads/Spinity/audio ~/storage/downloads/Spinity/jobs
echo "allow-external-apps=true" >> ~/.termux/termux.properties
termux-reload-settings
```

The app shows this same list (with a Copy button) the first time it needs it —
open the app and tap **Set up** when the panel appears. Then tap **Allow file
access** and give Spinity "All files" access (needed to read what yt-dlp
writes into shared storage), and **Check again**.

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
is the pragmatic permission for a personal, sideloaded music app.

## Layout

```
mobile/
  capacitor.config.json      appId com.spinity.player, webDir ../website/player
  android/                   the generated Android project (committed)
    app/src/main/java/com/spinity/player/
      MainActivity.java        registers the bridge plugin
      TermuxBridgePlugin.java  status / requestFilesAccess / openTermux / exec
website/player/native.js     the local /api implementation (tested in tests/nativeShim.test.cjs)
```

## How a download flows

1. Search in the app → `/api/ytsearch` → new job → Termux runs
   `yt-dlp -J --flat-playlist "ytsearch12:..."` → writes the JSON into
   `Download/Spinity/jobs/`.
2. Tap **Save** → `/api/save` → Termux runs
   `yt-dlp -x --audio-format mp3 --embed-thumbnail` for that video.
3. `native.js` polls the job's `.code` marker every 2 s; when it lands (0 =
   success) the mp3 is added to the phone library and appears in the app.
   Downloads survive closing the app — the next launch finishes the job.
