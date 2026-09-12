@echo off
title Journal Proof Capture System
color 0A
cd /d "%~dp0\backend"
echo ================================================================
echo   JOURNAL PROOF CAPTURE SYSTEM
echo ================================================================
echo.
echo   Launching web interface in default browser...
start "" "http://localhost:3001"
echo.
echo   Starting Node.js Server (HTTP: 3001, Mobile HTTPS: 3443)...
echo   Keep this window open while using the tool.
echo ================================================================
echo.
node server.js
pause
