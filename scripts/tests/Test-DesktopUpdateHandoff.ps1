# SPDX-License-Identifier: Apache-2.0
[CmdletBinding(DefaultParameterSetName = 'Candidate')]
param(
    [Parameter(Mandatory)][string]$BaselineInstaller,
    [Parameter(Mandatory, ParameterSetName = 'Candidate')][string]$CandidateInstaller,
    [Parameter(ParameterSetName = 'Candidate')][string]$ReleaseNotesFile,
    [Parameter(Mandatory, ParameterSetName = 'Public')][string]$PublicTargetTag,
    [string]$ProductName = 'ResumeForge',
    [string]$WorkRoot = (Join-Path ([IO.Path]::GetTempPath()) ("rf-update-e2e-" + [guid]::NewGuid()))
)
$ErrorActionPreference = 'Stop'
Import-Module (Join-Path $PSScriptRoot 'WindowsUpgradeRelease.psm1')
$baseline = Get-Item -LiteralPath $BaselineInstaller
if ($ProductName -notmatch '^ResumeForge(?:UpdateQA[0-9]+)?$') { throw 'Unexpected test product' }
if ($ProductName -eq 'ResumeForge' -and $env:RUNNER_ENVIRONMENT -ne 'github-hosted') {
    throw 'Use a uniquely branded QA installer on a workstation. The release installer uses the real uninstall registration.'
}
$namePattern = '^ResumeForge-Setup-(\d+\.\d+\.\d+)\.exe$'
$source = [regex]::Match($baseline.Name, $namePattern)
if (!$source.Success) { throw "Unexpected baseline installer name: $($baseline.Name)" }
$baselineVersion = [version]$source.Groups[1].Value
if ($PublicTargetTag) {
    $targetVersion = Get-WindowsReleaseVersion $PublicTargetTag
} else {
    $candidate = Get-Item -LiteralPath $CandidateInstaller
    $target = [regex]::Match($candidate.Name, $namePattern)
    if (!$target.Success) { throw "Unexpected candidate installer name: $($candidate.Name)" }
    $targetVersion = [version]$target.Groups[1].Value
    Assert-WindowsInstallerChecksum $candidate.FullName
}
if ($baselineVersion -ge $targetVersion) { throw "Expected an upgrade from $baselineVersion to $targetVersion" }
Assert-WindowsInstallerChecksum $baseline.FullName
if (Test-Path -LiteralPath $WorkRoot) { throw "Test directory already exists: $WorkRoot" }
[void][IO.Directory]::CreateDirectory($WorkRoot)
$installDir = Join-Path $WorkRoot 'app'
$exe = Join-Path $installDir "$ProductName.exe"
$localProfile = Join-Path $WorkRoot 'local'
[void][IO.Directory]::CreateDirectory($localProfile)
$oldLocal = $env:LOCALAPPDATA
try {
    $env:LOCALAPPDATA = $localProfile
    # NSIS requires /D as the last, unquoted argument (including paths with spaces).
    $setup = Start-Process -FilePath $baseline.FullName -ArgumentList "/S /D=$installDir" -WindowStyle Hidden -PassThru
    if (-not $setup.WaitForExit(180000) -or $setup.ExitCode -ne 0) { throw 'Baseline installation failed' }
    if (-not (Test-Path -LiteralPath $exe)) { throw "Missing baseline executable: $exe" }
    $driver = Join-Path $PSScriptRoot '../../desktop/scripts/verify-packaged-update.js'
    $driverArgs = @($driver, $exe, "$baselineVersion", "$targetVersion", $WorkRoot)
    if (!$PublicTargetTag) {
        $driverArgs += $candidate.FullName
        if ($ReleaseNotesFile) { $driverArgs += (Get-Item -LiteralPath $ReleaseNotesFile).FullName }
    }
    node @driverArgs
    if ($LASTEXITCODE) { throw "Update UI or shutdown failed. Diagnostics: $WorkRoot" }
    $proof = Get-Content -Raw -Encoding UTF8 -LiteralPath (Join-Path $WorkRoot 'baseline.json') | ConvertFrom-Json
    $deadline = [datetime]::UtcNow.AddMinutes(3)
    $health = $null
    while ([datetime]::UtcNow -lt $deadline) {
        $running = Get-CimInstance Win32_Process -Filter "Name = '$ProductName.exe'" |
            Where-Object { $_.ExecutablePath -eq $exe -and $_.ProcessId -ne $proof.pid -and $_.CommandLine -notmatch '--type=' } |
            Select-Object -First 1
        if ($running) {
            # Explorer can relaunch the updated app with the normal user
            # environment. Verify the new shell's actual listener by ownership.
            $backendProc = Get-CimInstance Win32_Process -Filter "ParentProcessId = $($running.ProcessId) AND Name = 'python.exe'" |
                Where-Object { $_.CommandLine -match '-m\s+uvicorn\s+app\.main:app' } | Select-Object -First 1
            if ($backendProc -and $backendProc.CommandLine -match '--port\s+(\d+)') {
                $port = [int]$Matches[1]
                $listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
                    Where-Object { $_.LocalAddress -eq '127.0.0.1' -and $_.OwningProcess -eq $backendProc.ProcessId }
                if (-not $listener) { Start-Sleep -Milliseconds 300; continue }
                try {
                    $health = Invoke-WebRequest -UseBasicParsing -TimeoutSec 3 -Uri "http://127.0.0.1:$port/api/health"
                } catch { $health = $null }
                if ($health -and $health.StatusCode -eq 200) { break }
            }
        }
        Start-Sleep -Seconds 1
    }
    if (-not $running -or -not $health -or $health.StatusCode -ne 200) { throw "No healthy restarted installation. Diagnostics: $WorkRoot" }
    $installed = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
    if ($installed -notin @("$targetVersion", "$targetVersion.0")) {
        throw "Expected $targetVersion, got $installed"
    }
    $backendHealth = $health.Content | ConvertFrom-Json
    if ($backendHealth.status -cne 'ok' -or $backendHealth.version -cne "$targetVersion") {
        throw "Expected healthy backend $targetVersion, got $($backendHealth.version)"
    }
    if ([IO.File]::ReadAllText($proof.marker) -cne $proof.value) { throw 'User-data marker changed during upgrade' }
    Write-Output "PASS: in-app upgrade $baselineVersion -> $installed, new shell PID $($running.ProcessId), healthy backend, user data preserved"
    # The update has finished. Close only this rehearsal's process tree after
    # rechecking the exact executable and its own backend process.
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId = $($running.ProcessId)"
    if ($owned.ExecutablePath -eq $exe) {
        $ownedBackend = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
            Where-Object LocalAddress -eq '127.0.0.1' | Select-Object -First 1
        $backendProc = if ($ownedBackend) { Get-CimInstance Win32_Process -Filter "ProcessId = $($ownedBackend.OwningProcess)" }
        if ($backendProc.ParentProcessId -eq $owned.ProcessId -and $backendProc.CommandLine -match '-m\s+uvicorn\s+app\.main:app') {
            taskkill /PID $owned.ProcessId /T /F | Out-Null
        }
    }
} finally {
    $env:LOCALAPPDATA = $oldLocal
}
