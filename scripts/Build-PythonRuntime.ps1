# Build-PythonRuntime.ps1 - build the bundled Python runtime for the desktop app.
#
# Produces desktop/python-runtime.zip containing python/ (<interpreter> +
# site-packages with backend requirements preinstalled). The shell unpacks it
# on first launch into %LOCALAPPDATA%\ResumeForge\runtime, so the packaged
# app never bootstraps a venv or downloads anything at user time.
#
# Python version is pinned to the same 3.12.10 the console flow uses
# (scripts/Start-ResumeForge.ps1). The embeddable distribution + get-pip +
# requirements install happens ONCE here, on the build machine.

param(
    [string]$PythonVersion = "3.12.10"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$staging = Join-Path $projectRoot "desktop\runtime-staging"
$zipPath = Join-Path $projectRoot "desktop\python-runtime.zip"

Write-Host "Building bundled Python runtime $PythonVersion..."
if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
New-Item -ItemType Directory -Force $staging | Out-Null

# 1. Embeddable distribution (curl.exe: quiet, fast, no progress flood).
$embedUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$embedZip = Join-Path $staging "python-embed.zip"
Write-Host "Downloading $embedUrl"
curl.exe -sSL -o $embedZip $embedUrl
if ($LASTEXITCODE -ne 0) { throw "download embeddable python failed ($LASTEXITCODE)" }
Expand-Archive -LiteralPath $embedZip -DestinationPath (Join-Path $staging "python") -Force
Remove-Item $embedZip

# 2. Enable site-packages imports (embeddable ships with them disabled).
$pth = Get-ChildItem (Join-Path $staging "python") -Filter "python*._pth" | Select-Object -First 1
if (-not $pth) { throw "python ._pth file not found in embeddable package" }
$pthContent = Get-Content $pth.FullName -Raw
$pthContent = $pthContent -replace "#import site", "import site"
$pthContent = $pthContent -replace "#Lib/site-packages", "Lib/site-packages"
Set-Content -LiteralPath $pth.FullName -Value $pthContent -Encoding ASCII -NoNewline

# 3. pip bootstrap.
$pythonExe = Join-Path $staging "python\python.exe"
$getPip = Join-Path $staging "get-pip.py"
Write-Host "Bootstrapping pip..."
curl.exe -sSL -o $getPip https://bootstrap.pypa.io/pip/get-pip.py
if ($LASTEXITCODE -ne 0) { throw "download get-pip failed ($LASTEXITCODE)" }
& $pythonExe $getPip --no-warn-script-location -q
if ($LASTEXITCODE -ne 0) { throw "get-pip failed with $LASTEXITCODE" }

# 4. Backend requirements.
Write-Host "Installing backend requirements..."
& $pythonExe -m pip install -r (Join-Path $projectRoot "backend\requirements.txt") -q --no-warn-script-location
if ($LASTEXITCODE -ne 0) { throw "pip install failed with $LASTEXITCODE" }

# 5. Sanity check: the exact import set the console launcher verifies.
& $pythonExe -c "import fastapi, uvicorn, sqlalchemy, alembic, pydantic, pydantic_settings, PIL, pypdf, fpdf, websocket, docx, multipart"
if ($LASTEXITCODE -ne 0) { throw "backend import verification failed" }

# 6. Compress (layout: python/... at zip root, matching resolveRuntimePython).
# 7za over Compress-Archive: faster, and PS 5.1's archive module intermittently
# hits PermissionDenied on freshly-written executables (AV scan race).
Write-Host "Compressing to python-runtime.zip..."
if (Test-Path $zipPath) { Remove-Item -Force $zipPath }
$sevenZip = Join-Path $projectRoot "desktop\node_modules\7zip-bin\win\x64\7za.exe"
if (Test-Path $sevenZip) {
    & $sevenZip a -tzip -mx=7 $zipPath (Join-Path $staging "python") | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "7za compression failed with $LASTEXITCODE" }
} else {
    Compress-Archive -Path (Join-Path $staging "python") -DestinationPath $zipPath -CompressionLevel Optimal
}
Remove-Item -Recurse -Force $staging

$size = "{0:N1} MB" -f ((Get-Item $zipPath).Length / 1MB)
Write-Host "Done: $zipPath ($size)"
