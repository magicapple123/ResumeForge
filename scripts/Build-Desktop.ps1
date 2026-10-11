# Build-Desktop.ps1 - assemble the desktop payload and package the shell.
#
# Phase 3 of the desktop plan. The Electron shell ships with a "payload"
# (backend sources, built frontend, launcher scripts, branding) baked into
# resources/payload, so the installed app is fully self-contained and the
# shell can delegate backend startup to the shipped launchers.
#
# Usage:
#   powershell -File scripts\Build-Desktop.ps1              # win: dir + nsis
#   powershell -File scripts\Build-Desktop.ps1 -Target dir  # dir only
#   powershell -File scripts\Build-Desktop.ps1 -Target mac  # mac: dmg + dir (run on macOS)
#
# Prereqs: frontend/dist exists (run `npm run build` in frontend/ first);
# desktop/node_modules exists (npm install in desktop/).

param(
    [ValidateSet("win", "mac", "dir")]
    [string]$Target = "win"
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$desktopDir = Join-Path $projectRoot "desktop"
$payloadDir = Join-Path $desktopDir "payload"

if (-not (Test-Path (Join-Path $projectRoot "frontend\dist\index.html"))) {
    throw "frontend/dist/index.html missing - build the frontend first (npm run build)."
}
if (-not (Test-Path (Join-Path $desktopDir "node_modules\electron"))) {
    throw "desktop/node_modules missing - run npm install in desktop/ first."
}

Write-Host "Assembling desktop payload..."
if (Test-Path $payloadDir) { Remove-Item -Recurse -Force $payloadDir }
New-Item -ItemType Directory -Force $payloadDir | Out-Null

# Tracked sources only: git archive keeps the payload free of dev-only
# clutter (venv, node_modules, runtime/, caches) exactly like Build-Release.
# PowerShell pipes object-ify binary streams, so archive to a temp file and
# extract from disk - never `git archive | tar` inline in PowerShell 5.1.
# git archive -o refuses paths outside the repository, so stage the temp tar
# under runtime/ (gitignored) instead of %TEMP%.
$archiveTar = Join-Path $projectRoot "runtime\tmp-desktop-payload.tar"
New-Item -ItemType Directory -Force (Split-Path $archiveTar) | Out-Null
foreach ($spec in @("backend", "scripts", "start.cmd", "start.command", "stop.cmd", "stop.command", "branding")) {
    git -C $projectRoot archive -o $archiveTar HEAD -- $spec
    if ($LASTEXITCODE -ne 0) { throw "git archive $spec failed with $LASTEXITCODE" }
    tar -xf $archiveTar -C $payloadDir
    if ($LASTEXITCODE -ne 0) { throw "tar extract $spec failed with $LASTEXITCODE" }
}
Remove-Item -Force $archiveTar -ErrorAction SilentlyContinue

Copy-Item -Recurse -Force (Join-Path $projectRoot "frontend\dist") (Join-Path $payloadDir "frontend\dist")
New-Item -ItemType Directory -Force (Join-Path $payloadDir "runtime\logs") | Out-Null

# Bundled runtime: build once, reuse across packaging runs. The payload gets
# a copy so first user launch unpacks instead of provisioning. Windows-only:
# the zip holds the amd64 embeddable interpreter, so mac builds skip it (the
# mac shell falls back to the shipped launcher, which provisions on demand).
$runtimeZip = Join-Path $desktopDir "python-runtime.zip"
if ($Target -ne "mac") {
    if (-not (Test-Path $runtimeZip)) {
        Write-Host "python-runtime.zip missing - building it (one-time, downloads + pip install)..."
        & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "Build-PythonRuntime.ps1")
        if ($LASTEXITCODE -ne 0) { throw "Build-PythonRuntime failed with $LASTEXITCODE" }
    }
    Copy-Item -Force $runtimeZip (Join-Path $payloadDir "python-runtime.zip")
}

$payloadFiles = (Get-ChildItem -Recurse -File $payloadDir).Count
Write-Host "Payload assembled: $payloadFiles files"

Push-Location $desktopDir
try {
    $env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
    # electron-builder is a pinned devDependency: never call it via bare npx
    # (an uninstalled npx target prompts interactively and hangs CI/builds).
    $builder = Join-Path $desktopDir "node_modules\.bin\electron-builder.cmd"
    if (-not (Test-Path $builder)) { throw "electron-builder not installed in desktop/" }
    if ($Target -eq "win") {
        & $builder --win --config electron-builder.yml
    } elseif ($Target -eq "mac") {
        & $builder --mac --config electron-builder.yml
    } else {
        & $builder --dir --config electron-builder.yml
    }
    if ($LASTEXITCODE -ne 0) { throw "electron-builder failed with $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "Desktop packaging done -> $(Join-Path $desktopDir 'out')"
