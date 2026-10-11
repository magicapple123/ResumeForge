@echo off
rem Creates a desktop shortcut for ResumeForge with the brand icon.
rem The shortcut is equivalent to double-clicking start.cmd.
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Create-DesktopShortcut.ps1"
set EXITCODE=%ERRORLEVEL%
echo.
if not "%EXITCODE%"=="0" (
  echo Shortcut creation exited with code %EXITCODE%. Read the messages above.
)
pause
