@echo off
title Journal Proof - Development Mode (Frontend + Backend)
color 0B
echo ================================================================
echo   STARTING JOURNAL PROOF SYSTEM - DEVELOPMENT MODE
echo ================================================================
echo.
echo [1/3] Clearing any stuck processes on port 3001...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3001') do taskkill /f /pid %%a 2>nul

echo [2/3] Launching Backend Server on port 3001 in background...
start "Journal Backend (Port 3001)" cmd /k "cd /d "%~dp0\backend" && node server.js"

echo [3/3] Starting Frontend Vite Dev Server on port 5173...
echo.
cd /d "%~dp0\frontend"
npm run dev

