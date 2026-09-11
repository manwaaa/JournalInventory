@echo off
title Journal Proof Capture Launcher
echo =======================================================
echo   Starting Journal Proof & Anti-Plagiarism Capture Tool
echo =======================================================
echo.

cd /d "%~dp0"

REM Check if backend node_modules exist
if not exist "backend\node_modules\" (
  echo [1/3] Installing backend dependencies...
  cd backend && call npm install && cd ..
)

REM Check if frontend dist exists, if not build it
if not exist "frontend\dist\" (
  if not exist "frontend\node_modules\" (
    echo [2/3] Installing frontend dependencies...
    cd frontend && call npm install && cd ..
  )
  echo [2/3] Building frontend production bundle...
  cd frontend && call npm run build && cd ..
)

echo [3/3] Launching local server on port 3001...
start "" "http://localhost:3001"
cd backend && node server.js

pause
