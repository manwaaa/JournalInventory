@echo off
title Verification Images System
color 0A
cd /d "%~dp0"
echo ================================================================
echo   VERIFICATION IMAGES SYSTEM
echo ================================================================
echo.

if exist "frontend\src\" (
  echo   Building latest frontend bundle...
  cd frontend && call npm run build && cd ..
)

echo   Launching web interface in default browser...
start "" "http://localhost:3001"
echo.
echo   Starting Node.js Server (HTTP: 3001, Mobile HTTPS: 3443)...
echo   Keep this window open while using the tool.
echo ================================================================
echo.
cd backend && node server.js
pause
