@echo off
setlocal
cd /d "%~dp0"
title Island Now - Start
if exist "%~dp0Island-Now.exe" goto run
set "tray_csc=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%tray_csc%" set "tray_csc=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%tray_csc%" (
  echo Der .NET-Compiler von Windows wurde nicht gefunden.
  echo .NET Framework 4.8 pruefen: https://learn.microsoft.com/dotnet/framework/install/
  echo Diagnose ist mit START-KONSOLE.cmd moeglich.
  pause
  exit /b 1
)
echo Island Now wird einmalig als Tray-Anwendung vorbereitet ...
"%tray_csc%" /nologo /target:winexe /optimize+ /platform:anycpu /r:System.Windows.Forms.dll /r:System.Drawing.dll /out:"%~dp0Island-Now.exe" "%~dp0windows\Tray.cs"
if errorlevel 1 (
  echo Tray-Anwendung konnte nicht erstellt werden. ZIP vollstaendig in einen beschreibbaren Ordner entpacken.
  pause
  exit /b 1
)
:run
start "" "%~dp0Island-Now.exe"
exit /b 0
