@echo off
title AMC Transfer
cd /d "%~dp0"

REM ── Locate Node.js ──────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% equ 0 goto :node_ok

if exist "%ProgramFiles%\nodejs\node.exe"           set "PATH=%ProgramFiles%\nodejs;%PATH%"       & goto :node_ok
if exist "%ProgramFiles(x86)%\nodejs\node.exe"      set "PATH=%ProgramFiles(x86)%\nodejs;%PATH%"  & goto :node_ok
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe"  set "PATH=%LOCALAPPDATA%\Programs\nodejs;%PATH%" & goto :node_ok

echo Node.js was not found on this computer.
echo Please install it from https://nodejs.org and try again.
pause
exit /b 1

:node_ok
REM ── Dependencies ────────────────────────────────────────────────────────────
if not exist "node_modules" (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 ( echo Install failed. & pause & exit /b 1 )
)

REM ── Build ───────────────────────────────────────────────────────────────────
if not exist "dist\server.js" (
    echo Building...
    call npm run build
    if errorlevel 1 ( echo Build failed. & pause & exit /b 1 )
)

REM ── ADB ─────────────────────────────────────────────────────────────────────
if not exist "bin\win\adb.exe" (
    echo Downloading ADB tools ^(one-time setup, requires internet^)...
    call node scripts\setup.js --current
    if errorlevel 1 ( echo ADB setup failed. & pause & exit /b 1 )
)

REM ── Launch ──────────────────────────────────────────────────────────────────
node dist\server.js
