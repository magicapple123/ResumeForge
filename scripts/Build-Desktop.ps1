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
    [string]$Target = "win",
    # Bundled interpreter version. Must stay equal to Build-PythonRuntime.ps1's
    # default (Test-PythonRuntimeGuard.ps1 pins the two together): the reuse guard
    # compares the version stamped into python-runtime.zip against this value, so
    # a bump here without the other would make every cached zip look stale.
    [string]$PythonVersion = "3.12.10"
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
# Extract with the system bsdtar (%SystemRoot%\System32\tar.exe), never trust
# PATH: Git for Windows / MSYS ship a GNU tar that reads "D:\..." as a remote
# host name ("Cannot connect to D: resolve failed") and fails outright -- a
# PATH shape that is common on dev machines. Same policy the runtime unpacking
# got in 6993ef2 (desktop/lib/backend-runtime.js pins the system tar there).
$systemTar = Join-Path $env:SystemRoot "System32\tar.exe"
$tarExe = if (Test-Path $systemTar) { $systemTar } else { "tar" }
foreach ($spec in @("backend", "scripts", "start.cmd", "start.command", "stop.cmd", "stop.command", "branding")) {
    git -C $projectRoot archive -o $archiveTar HEAD -- $spec
    if ($LASTEXITCODE -ne 0) { throw "git archive $spec failed with $LASTEXITCODE" }
    & $tarExe -xf $archiveTar -C $payloadDir
    if ($LASTEXITCODE -ne 0) { throw "tar extract $spec failed with $LASTEXITCODE" }
}
Remove-Item -Force $archiveTar -ErrorAction SilentlyContinue

Copy-Item -Recurse -Force (Join-Path $projectRoot "frontend\dist") (Join-Path $payloadDir "frontend\dist")
New-Item -ItemType Directory -Force (Join-Path $payloadDir "runtime\logs") | Out-Null

# Bundled runtime: build once, reuse across packaging runs. The payload gets
# a copy so first user launch unpacks instead of provisioning. Windows-only:
# the zip holds the amd64 embeddable interpreter, so mac builds skip it (the
# mac shell falls back to the shipped launcher, which provisions on demand).
#
# Reuse is guarded by a manifest embedded in the zip (see
# PythonRuntimeManifest.ps1). It records the SHA-256 of backend\requirements.txt
# and the bundled Python version at build time; here we compare both against the
# current checkout and rebuild on any mismatch -- including a zip that carries no
# manifest, i.e. a cache from before this guard existed. The 1.0.1 incident was
# precisely a cache that predated a requirements change, so a bare existence
# check (the old behaviour) is exactly the trap this closes.
. (Join-Path $PSScriptRoot "PythonRuntimeManifest.ps1")
$runtimeZip = Join-Path $desktopDir "python-runtime.zip"
if ($Target -ne "mac") {
    $requirementsPath = Join-Path $projectRoot "backend\requirements.txt"
    # Bind the rebuild inputs to locals before the scriptblock so it does not
    # depend on scope resolution while the helper invokes it.
    $buildRuntimeScript = Join-Path $PSScriptRoot "Build-PythonRuntime.ps1"
    $bundledPythonVersion = $PythonVersion
    $runtimeDecision = Invoke-PythonRuntimeEnsure -ZipPath $runtimeZip -PythonVersion $PythonVersion -RequirementsPath $requirementsPath -Rebuild {
        & powershell -NoProfile -ExecutionPolicy Bypass -File $buildRuntimeScript -PythonVersion $bundledPythonVersion
        if ($LASTEXITCODE -ne 0) { throw "Build-PythonRuntime failed with $LASTEXITCODE" }
    }
    if ($runtimeDecision.Rebuilt) {
        Write-Host "python-runtime.zip rebuilt from the current requirements."
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

# Checksum sidecar for the installer, in the exact format CI's "Verify packaging
# outputs" step writes and the desktop updater accepts: "<hex>  <name>", two
# spaces, ASCII, no "*" prefix (the updater compares the sidecar's file name to
# the release asset name character for character, so the coreutils "hash *file"
# form is rejected as malformed). Local builds previously left a stale sidecar
# next to a rebuilt exe; writing it here keeps the pair consistent.
if ($Target -eq "win") {
    # Match the artifact this build just produced (the version in desktop/package.json),
    # not "the first ResumeForge-Setup-*.exe" -- desktop/out can still hold installers
    # from earlier versions, and a stale pick would checksum the wrong file.
    $version = (Get-Content (Join-Path $desktopDir "package.json") -Raw | ConvertFrom-Json).version
    $setupPath = Join-Path $desktopDir "out\ResumeForge-Setup-$version.exe"
    if (Test-Path $setupPath) {
        $sha = (Get-FileHash $setupPath -Algorithm SHA256).Hash.ToLowerInvariant()
        # LF (not Set-Content's CRLF): the sidecar must stay `sha256sum -c`
        # friendly on macOS/Linux, where the trailing "\r" would break the
        # file name match.
        [System.IO.File]::WriteAllText("$setupPath.sha256", "$sha  $(Split-Path -Leaf $setupPath)`n", [System.Text.Encoding]::ASCII)
        Write-Host "installer sha256 ($(Split-Path -Leaf $setupPath)): $sha"
    } else {
        Write-Warning "installer artifact not found for checksum sidecar: $setupPath"
    }
}
