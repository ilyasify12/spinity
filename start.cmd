@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron-vite" (
  echo Spinity is not set up yet.
  echo Double-click setup.cmd first.
  echo.
  pause
  exit /b 1
)

echo Starting Spinity... (keep this window open)
echo.
call npm run dev

echo.
echo Spinity has stopped.
pause
