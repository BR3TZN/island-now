@echo off
setlocal
cd /d "%~dp0"
title Island Now - Diagnose
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js ab Version 22 von https://nodejs.org/ installieren.
  pause
  exit /b 1
)
node server.mjs --open
if errorlevel 1 pause
