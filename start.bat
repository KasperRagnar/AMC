@echo off
title AMC Transfer
cd /d "%~dp0"

if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

if not exist "dist\server.js" (
    echo Building...
    call npm run build
    if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

if not exist "bin\win\adb.exe" (
    echo Downloading ADB tools (one-time setup, requires internet)...
    call node scripts\setup.js --current
    if errorlevel 1 ( echo ADB setup failed. & pause & exit /b 1 )
)

node dist\server.js
