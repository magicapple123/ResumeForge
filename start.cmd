@echo off
title ResumeForge
setlocal
rem %* forwards -BackendPort / -FrontendPort / -FrontendMode / -NoBrowser to the
rem launcher. -FrontendMode is auto (use the bundled frontend\dist via the backend
rem when present) | dev (force Vite) | production (require dist).
rem Use the space-separated form: -BackendPort=8010 does not bind with -File.
rem First-launch convenience: silently create the branded desktop shortcut
rem when it is missing (-IfMissing no-ops if it already exists; output and
rem failures are suppressed so this never blocks or disturbs the launch).
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Create-DesktopShortcut.ps1" -IfMissing >nul 2>&1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-ResumeForge.ps1" %*
if errorlevel 1 pause
