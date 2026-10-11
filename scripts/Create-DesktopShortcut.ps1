# Create-DesktopShortcut.ps1 - create a desktop shortcut for ResumeForge.
#
# A downloaded release zip is a folder the user unzips anywhere; double-clicking
# start.cmd works, but Windows then shows the generic console icon on the
# taskbar and the launch point lives wherever the folder is. A desktop shortcut
# carrying the brand icon (branding/resumeforge.ico) makes the launch feel like
# an installed application.
#
# The shortcut targets start.cmd through cmd.exe so the console window stays
# open on failures exactly like double-clicking start.cmd does (start.cmd pauses
# on error). Run scripts/Create-DesktopShortcut.ps1 anytime; re-running just
# refreshes the existing shortcut.
#
# Optional: -Remove deletes the shortcut instead (uninstall.cmd calls this).
# Optional: -IfMissing exits silently when the shortcut already exists, so
# start.cmd can offer it on first launch without touching an existing one.
param(
    [switch]$Remove,
    [switch]$IfMissing
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$shortcutPath = Join-Path (
    [Environment]::GetFolderPath("Desktop")
) "ResumeForge.lnk"
$startCmd = Join-Path $projectRoot "start.cmd"
$iconPath = Join-Path $projectRoot "branding\resumeforge.ico"

$shell = New-Object -ComObject WScript.Shell

if ($IfMissing -and (Test-Path $shortcutPath)) {
    # First-launch path: the shortcut is already there, nothing to do and
    # nothing to print -- start.cmd calls us with output suppressed.
    exit 0
}

if ($Remove) {
    if (Test-Path $shortcutPath) {
        Remove-Item -LiteralPath $shortcutPath -Force
        Write-Host "Removed: $shortcutPath"
    } else {
        Write-Host "No desktop shortcut found (nothing to remove)."
    }
    exit 0
}

if (-not (Test-Path $startCmd)) {
    throw "start.cmd not found next to this script: $startCmd"
}
$icon = $iconPath
if (-not (Test-Path $iconPath)) {
    # A release archive always carries the icon; a dev tree should too. Fall
    # back to the default console icon rather than failing the launch path.
    Write-Warning "Icon not found, shortcut will use the default icon: $iconPath"
    $icon = ""
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $env:ComSpec
$shortcut.Arguments = "/c `"`"$startCmd`"`""
$shortcut.WorkingDirectory = $projectRoot
if ($icon) { $shortcut.IconLocation = "$icon,0" }
$shortcut.Description = "ResumeForge - local resume workspace"
$shortcut.Save()

Write-Host "Created: $shortcutPath"
if ($icon) { Write-Host "Icon: $icon" }
Write-Host "Double-click it to start ResumeForge, just like start.cmd."
