# SPDX-License-Identifier: Apache-2.0
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
# The file name follows the Windows UI language: a Chinese system gets
# 简历通.lnk, every other language gets ResumeForge.lnk. This matches the
# installer, whose shortcut name also follows the system language, so the
# portable zip and the installed build look alike. Only the file name is
# localised; the shortcut metadata stays English like the application title.
#
# Optional: -Remove deletes the shortcut instead (manual cleanup; the uninstaller
# removes the shortcut itself). It tries BOTH names, because the user may have
# created the shortcut while Windows was in another display language and then
# switched.
# Optional: -IfMissing exits silently when the shortcut already exists under
# either name, so start.cmd can offer it on first launch without touching an
# existing one.
param(
    [switch]$Remove,
    [switch]$IfMissing
)

$ErrorActionPreference = "Stop"

# The desktop shortcut file name for a given system UI language. Pure so the
# tests can pin both branches from any machine, and defined once: the "other"
# language name is derived from it below.
#
# Culture names look like "zh-CN", "zh-Hans-CN" or "en-US"; the invariant culture
# has an empty name and must fall through to the English name.
function Resolve-ShortcutFileName {
    param(
        [string]$UICultureName
    )

    if (-not [string]::IsNullOrEmpty($UICultureName) -and
        $UICultureName.StartsWith("zh", [System.StringComparison]::OrdinalIgnoreCase)) {
        return "简历通.lnk"
    }
    return "ResumeForge.lnk"
}

# Every shortcut name this launcher has ever used. -Remove and -IfMissing must
# consider all of them: the Windows display language can change between creating
# and removing the shortcut.
function Get-DesktopShortcutFileNames {
    return @(
        (Resolve-ShortcutFileName -UICultureName "zh"),
        (Resolve-ShortcutFileName -UICultureName "en")
    )
}

function Get-DesktopShortcutPaths {
    param(
        [string]$DesktopDirectory
    )

    $paths = @()
    foreach ($fileName in (Get-DesktopShortcutFileNames)) {
        $paths += (Join-Path $DesktopDirectory $fileName)
    }
    return $paths
}

function Test-DesktopShortcutExists {
    param(
        [string]$DesktopDirectory
    )

    foreach ($path in (Get-DesktopShortcutPaths -DesktopDirectory $DesktopDirectory)) {
        if (Test-Path -LiteralPath $path) {
            return $true
        }
    }
    return $false
}

function Remove-DesktopShortcut {
    param(
        [string]$DesktopDirectory
    )

    $removed = $false
    foreach ($path in (Get-DesktopShortcutPaths -DesktopDirectory $DesktopDirectory)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
            Write-Host "Removed: $path"
            $removed = $true
        }
    }
    if (-not $removed) {
        Write-Host "No desktop shortcut found (nothing to remove)."
    }
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopDirectory = [Environment]::GetFolderPath("Desktop")
$shortcutFileName = Resolve-ShortcutFileName -UICultureName ([System.Globalization.CultureInfo]::CurrentUICulture.Name)
$shortcutPath = Join-Path $desktopDirectory $shortcutFileName
$startCmd = Join-Path $projectRoot "start.cmd"
$iconPath = Join-Path $projectRoot "branding\resumeforge.ico"

$shell = New-Object -ComObject WScript.Shell

if ($IfMissing -and (Test-DesktopShortcutExists -DesktopDirectory $desktopDirectory)) {
    # First-launch path: a shortcut already exists (under either language name),
    # nothing to do and nothing to print -- start.cmd calls us with output
    # suppressed.
    exit 0
}

if ($Remove) {
    Remove-DesktopShortcut -DesktopDirectory $desktopDirectory
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
