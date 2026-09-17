@echo off
cd /d "%~dp0"
echo === START %DATE% %TIME% === > install.log
call npm install react react-dom >> install.log 2>&1
echo --- react done, exit=%ERRORLEVEL% --- >> install.log
call npm install -D electron electron-vite vite typescript @vitejs/plugin-react @types/react @types/react-dom @types/node electron-builder >> install.log 2>&1
echo === ALL DONE %DATE% %TIME% exit=%ERRORLEVEL% === >> install.log
