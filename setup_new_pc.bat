@echo off
title Journal Proof System - First Time Setup
color 0B
echo ================================================================
echo   JOURNAL PROOF CAPTURE SYSTEM - FIRST TIME SETUP
echo ================================================================
echo.

:: Check for Node.js
where node >nul 2>&1
if %errorlevel% neq 0 (
    color 0C
    echo [ERROR] Node.js is NOT installed on this PC!
    echo.
    echo Please install Node.js (LTS version) from: https://nodejs.org/
    echo After installing Node.js, run this script again.
    echo.
    pause
    exit /b 1
)

echo [1/3] Node.js detected. Installing Backend dependencies...
cd /d "%~dp0\backend"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install backend dependencies.
    pause
    exit /b 1
)

echo.
echo [2/3] Installing Frontend dependencies...
cd /d "%~dp0\frontend"
call npm install
if %errorlevel% neq 0 (
    echo [ERROR] Failed to install frontend dependencies.
    pause
    exit /b 1
)

echo.
echo [3/3] Building production assets...
call npm run build
if %errorlevel% neq 0 (
    echo [ERROR] Frontend build failed.
    pause
    exit /b 1
)

echo.
echo ================================================================
echo   [SUCCESS] Setup Completed Successfully!
echo   You can now launch the system anytime by running:
echo   start_system.bat
echo ================================================================
echo.
pause

