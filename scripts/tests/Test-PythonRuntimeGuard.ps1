# Test-PythonRuntimeGuard.ps1 - regression guard for the stale-runtime defect.
#
# Context: on 2026-10-17 the desktop build reused an old desktop\python-runtime.zip
# that predated the pypdfium2 pin in backend\requirements.txt, so the shipped app
# crashed at import time. Build-Desktop.ps1 now stamps the zip with a manifest
# (requirements SHA-256 + bundled Python version) and only reuses it on a match.
#
# This test exercises that decision logic directly, against fixture zips in a
# temp directory, so it never downloads an interpreter or runs pip. The real
# rebuild action is injected as a counter, which also proves the "did we rebuild?"
# branch without side effects.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$HelperPath = Join-Path $ProjectRoot "scripts\PythonRuntimeManifest.ps1"
$BuildRuntimePath = Join-Path $ProjectRoot "scripts\Build-PythonRuntime.ps1"
$BuildDesktopPath = Join-Path $ProjectRoot "scripts\Build-Desktop.ps1"
$RuntimeDirectory = Join-Path ([IO.Path]::GetTempPath()) ("resumeforge-runtime-guard-" + [Guid]::NewGuid().ToString("N"))

function Assert-GuardTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Send-TestDirectoryToRecycleBin {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }
    try {
        Add-Type -AssemblyName Microsoft.VisualBasic
        [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
            $Path,
            [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
            [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
        )
    }
    catch {
        Write-Warning "Could not move runtime guard test data to the recycle bin; leaving it in place: $($_.Exception.Message)"
    }
}

function New-FakeRuntimeZip {
    # A zip shaped like the real runtime (python\python.exe at the root) but with
    # a stub interpreter, so a test never needs the download + pip install the
    # real Build-PythonRuntime.ps1 performs.
    param([string]$ZipPath)

    $stage = Join-Path $RuntimeDirectory ("stage-" + [Guid]::NewGuid().ToString("N"))
    $pythonDir = Join-Path $stage "python"
    New-Item -ItemType Directory -Force $pythonDir | Out-Null
    [IO.File]::WriteAllBytes((Join-Path $pythonDir "python.exe"), [byte[]](0x4D, 0x5A, 0x00, 0x01))
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    [System.IO.Compression.ZipFile]::CreateFromDirectory($stage, $ZipPath)
    Remove-Item -Recurse -Force $stage
}

try {
    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

    # --- the three scripts must parse, and stay ASCII (PS 5.1 reads a BOM-less
    # file with the locale codec; cf. the same rule Test-Build-Release.ps1 pins
    # for Build-Release.ps1). ---
    foreach ($scriptPath in @($HelperPath, $BuildRuntimePath, $BuildDesktopPath)) {
        $tokens = $null
        $parseErrors = $null
        [System.Management.Automation.Language.Parser]::ParseFile($scriptPath, [ref]$tokens, [ref]$parseErrors) | Out-Null
        Assert-GuardTest `
            -Condition ($parseErrors.Count -eq 0) `
            -Message "$([IO.Path]::GetFileName($scriptPath)) has PowerShell syntax errors."
        $nonAscii = @([IO.File]::ReadAllBytes($scriptPath) | Where-Object { $_ -gt 0x7F }).Count
        Assert-GuardTest `
            -Condition ($nonAscii -eq 0) `
            -Message "$([IO.Path]::GetFileName($scriptPath)) must stay pure ASCII (found $nonAscii non-ASCII bytes)."
    }

    . $HelperPath

    foreach ($functionName in @(
            "Get-RequirementsFingerprint", "New-PythonRuntimeManifest", "Add-PythonRuntimeManifest",
            "Get-PythonRuntimeManifest", "Get-PythonRuntimeStatus", "Invoke-PythonRuntimeEnsure"
        )) {
        Assert-GuardTest `
            -Condition ($null -ne (Get-Command $functionName -ErrorAction SilentlyContinue)) `
            -Message "The helper does not define $functionName."
    }

    # Fixture inputs: a requirements file and a zip stamped against it.
    $requirementsPath = Join-Path $RuntimeDirectory "requirements.txt"
    Set-Content -LiteralPath $requirementsPath -Value "fastapi==0.142.2`npypdfium2==5.14.0" -Encoding ascii

    $zipPath = Join-Path $RuntimeDirectory "python-runtime.zip"
    New-FakeRuntimeZip -ZipPath $zipPath

    # --- (a) marked + unchanged requirements -> UpToDate (reuse) ---
    Add-PythonRuntimeManifest -ZipPath $zipPath -PythonVersion "3.12.10" -RequirementsPath $requirementsPath | Out-Null
    $upToDate = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RequirementsPath $requirementsPath
    Assert-GuardTest `
        -Condition ($upToDate.State -eq "UpToDate") `
        -Message "A matching manifest must report UpToDate (got $($upToDate.State): $($upToDate.Reason))."

    # The marker really lives inside the archive, at the root, with the expected
    # fingerprint -- not in a sidecar a copy would drop.
    $stampedBack = Get-PythonRuntimeManifest -ZipPath $zipPath
    Assert-GuardTest -Condition ($null -ne $stampedBack) -Message "The manifest must read back out of the zip."
    Assert-GuardTest `
        -Condition ("$($stampedBack.requirementsSha256)" -eq (Get-RequirementsFingerprint -RequirementsPath $requirementsPath)) `
        -Message "The stamped fingerprint must equal the SHA-256 of requirements.txt."

    # --- (b) requirements content changed -> Stale (the 10-17 scenario) ---
    $changedRequirements = Join-Path $RuntimeDirectory "requirements-changed.txt"
    Set-Content -LiteralPath $changedRequirements -Value "fastapi==0.142.2`npypdfium2==5.15.0" -Encoding ascii
    $staleByRequirements = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RequirementsPath $changedRequirements
    Assert-GuardTest `
        -Condition ($staleByRequirements.State -eq "Stale") `
        -Message "Changed requirements must report Stale (got $($staleByRequirements.State))."
    Assert-GuardTest `
        -Condition ($staleByRequirements.Reason -match "requirements") `
        -Message "The stale reason must name requirements.txt (got '$($staleByRequirements.Reason)')."

    # A bundled-Python bump is also a mismatch.
    $staleByVersion = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.13.0" -RequirementsPath $requirementsPath
    Assert-GuardTest `
        -Condition ($staleByVersion.State -eq "Stale") `
        -Message "A bundled-Python bump must report Stale (got $($staleByVersion.State))."

    # --- (c) a zip with no manifest (pre-guard cache) -> Stale ---
    $bareZip = Join-Path $RuntimeDirectory "old-runtime.zip"
    New-FakeRuntimeZip -ZipPath $bareZip
    Assert-GuardTest `
        -Condition ($null -eq (Get-PythonRuntimeManifest -ZipPath $bareZip)) `
        -Message "A zip without a manifest must read back as null."
    $staleBare = Get-PythonRuntimeStatus -ZipPath $bareZip -PythonVersion "3.12.10" -RequirementsPath $requirementsPath
    Assert-GuardTest `
        -Condition ($staleBare.State -eq "Stale") `
        -Message "A zip without a manifest must report Stale (got $($staleBare.State))."

    # An absent zip is Missing, which the ensure step also rebuilds.
    $missingStatus = Get-PythonRuntimeStatus -ZipPath (Join-Path $RuntimeDirectory "absent.zip") -PythonVersion "3.12.10" -RequirementsPath $requirementsPath
    Assert-GuardTest `
        -Condition ($missingStatus.State -eq "Missing") `
        -Message "An absent zip must report Missing (got $($missingStatus.State))."

    # --- (d) the rebuild trigger, proven without a real download ---
    # The increment is kept in a hashtable so the injected scriptblock mutates a
    # shared object regardless of scope resolution.
    $rebuilds = @{ Count = 0 }
    $fakeRebuild = { $rebuilds.Count++ }

    $reuse = Invoke-PythonRuntimeEnsure -ZipPath $zipPath -PythonVersion "3.12.10" -RequirementsPath $requirementsPath -Rebuild $fakeRebuild
    Assert-GuardTest -Condition (-not $reuse.Rebuilt) -Message "An up-to-date zip must not trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 0) -Message "The rebuild action must not run for an up-to-date zip."

    $rebuiltStale = Invoke-PythonRuntimeEnsure -ZipPath $zipPath -PythonVersion "3.12.10" -RequirementsPath $changedRequirements -Rebuild $fakeRebuild
    Assert-GuardTest -Condition ($rebuiltStale.Rebuilt) -Message "A stale zip must trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 1) -Message "The rebuild action must run once for a stale zip (ran $($rebuilds.Count))."

    $rebuiltMissing = Invoke-PythonRuntimeEnsure -ZipPath (Join-Path $RuntimeDirectory "absent.zip") -PythonVersion "3.12.10" -RequirementsPath $requirementsPath -Rebuild $fakeRebuild
    Assert-GuardTest -Condition ($rebuiltMissing.Rebuilt) -Message "A missing zip must trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 2) -Message "The rebuild action must run for a missing zip (ran $($rebuilds.Count))."

    # --- the two build scripts must actually be wired to the guard ---
    $desktopTokens = $null
    $desktopErrors = $null
    $desktopAst = [System.Management.Automation.Language.Parser]::ParseFile($BuildDesktopPath, [ref]$desktopTokens, [ref]$desktopErrors)
    Assert-GuardTest -Condition ($desktopErrors.Count -eq 0) -Message "Build-Desktop.ps1 has PowerShell syntax errors."
    $paramNames = @($desktopAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    Assert-GuardTest `
        -Condition ($paramNames -contains "PythonVersion") `
        -Message "Build-Desktop.ps1 must expose a -PythonVersion parameter."

    $desktopText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($BuildDesktopPath))
    Assert-GuardTest `
        -Condition ($desktopText -match "PythonRuntimeManifest\.ps1") `
        -Message "Build-Desktop.ps1 must dot-source the shared runtime helper."
    Assert-GuardTest `
        -Condition ($desktopText -match "Invoke-PythonRuntimeEnsure") `
        -Message "Build-Desktop.ps1 must route the reuse decision through Invoke-PythonRuntimeEnsure."
    Assert-GuardTest `
        -Condition ($desktopText -match "Build-PythonRuntime\.ps1") `
        -Message "Build-Desktop.ps1 must still invoke Build-PythonRuntime.ps1 when it rebuilds."

    $runtimeText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($BuildRuntimePath))
    Assert-GuardTest `
        -Condition ($runtimeText -match "Add-PythonRuntimeManifest") `
        -Message "Build-PythonRuntime.ps1 must stamp the manifest into the zip it produces."

    # The two -PythonVersion defaults must agree, or every cached zip would look
    # (or silently pass as) fresh for the wrong reason.
    $defaultPattern = '\[string\]\$PythonVersion\s*=\s*"([^"]+)"'
    $desktopDefault = [regex]::Match($desktopText, $defaultPattern).Groups[1].Value
    $runtimeDefault = [regex]::Match($runtimeText, $defaultPattern).Groups[1].Value
    Assert-GuardTest `
        -Condition (-not [string]::IsNullOrWhiteSpace($desktopDefault) -and -not [string]::IsNullOrWhiteSpace($runtimeDefault)) `
        -Message "Could not read the -PythonVersion defaults from both build scripts."
    Assert-GuardTest `
        -Condition ($desktopDefault -eq $runtimeDefault) `
        -Message "The -PythonVersion defaults must match (Build-Desktop=$desktopDefault, Build-PythonRuntime=$runtimeDefault)."

    Write-Host "Python runtime guard tests passed."
}
finally {
    Send-TestDirectoryToRecycleBin -Path $RuntimeDirectory
}
