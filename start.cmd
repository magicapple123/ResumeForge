@echo off
title ResumeForge
setlocal
rem %* forwards -BackendPort / -FrontendPort / -FrontendMode / -NoBrowser to the
rem launcher. -FrontendMode is auto (use the bundled frontend\dist via the backend
rem when present) | dev (force Vite) | production (require dist).
rem Use the space-separated form: -BackendPort=8010 does not bind with -File.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-ResumeForge.ps1" %*
if errorlevel 1 pause
