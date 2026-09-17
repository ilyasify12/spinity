@echo off
setlocal
title Spinity Setup
cd /d "%~dp0"

echo ==================================================
echo    Spinity - first-time setup
echo ==================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [X] Node.js was not found on this PC.
  echo     Install the LTS build from https://nodejs.org
  echo     then run this file again.
  echo.
  pause
  exit /b 1
)

for /f "delims=" %%v in ('node --version') do echo    Node.js  %%v
for /f "delims=" %%v in ('npm --version')  do echo    npm      %%v
echo.

if exist "node_modules\electron-vite" (
  echo [1/3] Dependencies already installed - skipping.
) else (
  echo [1/3] Installing dependencies...
  echo.
  echo       This downloads Electron ^(~100 MB^) and takes a few minutes.
  echo       It is normal for it to look frozen - please wait.
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo [X] npm install failed. Scroll up for the real error and send it over.
    echo.
    pause
    exit /b 1
  )
)
echo.

echo [2/3] Checking the download tools...
where yt-dlp >nul 2>nul
if errorlevel 1 (
  echo       [!] yt-dlp  not found - downloading music will NOT work
  echo           Fix: pip install -U yt-dlp
) else (
  echo       [ok] yt-dlp found
)
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo       [!] ffmpeg not found - downloading music will NOT work
  echo           Fix: winget install ffmpeg
) else (
  echo       [ok] ffmpeg found
)
echo.

echo [3/3] Starting Spinity...
echo.
echo       KEEP THIS WINDOW OPEN. Closing it stops the app.
echo.
call npm run dev

echo.
echo Spinity has stopped.
pause
