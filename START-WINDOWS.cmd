@echo off
setlocal
cd /d "%~dp0"
title Island Now - Start
if exist "%~dp0Island-Now.exe" if exist "%~dp0windows\webview2\Microsoft.Web.WebView2.Core.dll" goto run
echo Island Now wird einmalig als Windows-Anwendung vorbereitet ...
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-windows.ps1"
if errorlevel 1 (
  echo Tray-Anwendung konnte nicht erstellt werden. ZIP vollstaendig in einen beschreibbaren Ordner entpacken.
  pause
  exit /b 1
)
:run
start "" "%~dp0Island-Now.exe"
exit /b 0
