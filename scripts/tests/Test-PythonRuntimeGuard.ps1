# SPDX-License-Identifier: Apache-2.0
# Test-PythonRuntimeGuard.ps1 - regression guard for the stale-runtime defect and
# for "every production install path uses the same locked closure".
#
# Context: on 2026-10-17 the desktop build reused an old desktop\python-runtime.zip
# that predated the pypdfium2 pin in backend\requirements.txt, so the shipped app
# crashed at import time. Build-Desktop.ps1 now stamps the zip with a manifest and
# only reuses it on a match.
#
# Schema 2 changed what the fingerprint means: it is the SHA-256 of the production
# lock (backend\requirements.runtime.lock.txt) rather than of requirements.txt.
# The reason is the failure this test pins in case (b2): a lock can be re-resolved
# without touching a single byte of the top-level pins, and an old zip that keys on
# requirements.txt would keep passing as "fresh" while describing a different
# package set.
#
# This test exercises the decision logic directly, against fixture locks and
# fixture zips in a temp directory, so it never downloads an interpreter or runs
# pip. The real rebuild action is injected as a counter, which also proves the
# "did we rebuild?" branch without side effects.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$HelperPath = Join-Path $ProjectRoot "scripts\PythonRuntimeManifest.ps1"
$LockHelperPath = Join-Path $ProjectRoot "scripts\Project-RuntimeLock.ps1"
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

function Set-FakeManifest {
    # Writes an arbitrary manifest entry into a zip. Production only ever stamps
    # well-formed schema-2 manifests, so the hand-edited and legacy shapes the
    # status check has to survive can only be produced here.
    param(
        [string]$ZipPath,
        [string]$Json
    )

    $entryName = "python-runtime.manifest.json"
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Json)
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $archive.GetEntry($entryName)
        if ($null -ne $existing) { $existing.Delete() }
        $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try { $stream.Write($bytes, 0, $bytes.Length) }
        finally { $stream.Dispose() }
    }
    finally {
        $archive.Dispose()
    }
}

function New-FixtureLock {
    # Minimal but well-formed uv lock text: pinned, hashed, with a "# via" block.
    # Validation rejects anything without a hash per pin, so fixtures cannot be
    # looser than the real thing.
    param(
        [string]$Path,
        [string[]]$Pins
    )

    $lines = New-Object System.Collections.Generic.List[string]
    $zeroHash = "0" * 64
    foreach ($pin in $Pins) {
        $lines.Add("$pin \")
        $lines.Add("    --hash=sha256:$zeroHash")
        $lines.Add("    # via -r requirements.txt")
    }
    Set-Content -LiteralPath $Path -Value ($lines -join "`n") -Encoding ascii
    return $Path
}

try {
    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

    # --- the scripts must parse, and stay ASCII (PS 5.1 reads a BOM-less file
    # with the locale codec; cf. the same rule Test-Build-Release.ps1 pins for
    # Build-Release.ps1). ---
    foreach ($scriptPath in @($HelperPath, $LockHelperPath, $BuildRuntimePath, $BuildDesktopPath)) {
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
    . $LockHelperPath

    foreach ($functionName in @(
            "Get-RequirementsFingerprint", "New-PythonRuntimeManifest", "Add-PythonRuntimeManifest",
            "Get-PythonRuntimeManifest", "Get-PythonRuntimeStatus", "Invoke-PythonRuntimeEnsure",
            "Get-RuntimeLockFingerprint", "Get-RuntimeLockPath"
        )) {
        Assert-GuardTest `
            -Condition ($null -ne (Get-Command $functionName -ErrorAction SilentlyContinue)) `
            -Message "The helper does not define $functionName."
    }
    foreach ($functionName in @(
            "Get-LockEntryList", "Get-RuntimeLockRootNames", "Select-RuntimeLockEntries",
            "ConvertTo-LockText", "Get-RuntimeLockPackageNames", "Get-LockVersionMap",
            "Get-RuntimeLockProblems", "Assert-RuntimeLockUsable", "Test-DevToolPackageName"
        )) {
        Assert-GuardTest `
            -Condition ($null -ne (Get-Command $functionName -ErrorAction SilentlyContinue)) `
            -Message "The lock helper does not define $functionName."
    }

    # ---------------------------------------------------------------------
    # Part 1 - the real repository locks agree with each other.
    # ---------------------------------------------------------------------
    $backendDir = Join-Path $ProjectRoot "backend"
    $realRequirementsPath = Join-Path $backendDir (Get-RequirementsFileName)
    $realDevLockPath = Join-Path $backendDir (Get-DevelopmentLockFileName)
    $realRuntimeLockPath = Join-Path $backendDir (Get-RuntimeLockFileName)

    foreach ($requiredPath in @($realRequirementsPath, $realDevLockPath, $realRuntimeLockPath)) {
        Assert-GuardTest `
            -Condition (Test-Path -LiteralPath $requiredPath -PathType Leaf) `
            -Message "Missing shipped dependency file: $requiredPath (the production installers require it)."
    }

    $realRuntimeLockText = Read-LockTextFile -Path $realRuntimeLockPath
    $realRequirementsText = Read-LockTextFile -Path $realRequirementsPath
    $realDevLockText = Read-LockTextFile -Path $realDevLockPath

    # The lock file NAME must be bare: both helpers append it to a backend
    # directory (Get-RuntimeLockPath here, rf_runtime_lock_path in the bash chain),
    # so a "backend/" prefix inside the constant resolves to backend/backend/... and
    # every install dies on "lock not found". That defect shipped once on macOS and
    # Linux in exactly this shape, which is why the composition is asserted, not
    # just the name.
    $runtimeLockName = Get-RuntimeLockFileName
    Assert-GuardTest `
        -Condition ($runtimeLockName -notmatch '[\\/]') `
        -Message "Get-RuntimeLockFileName must return a bare file name (got '$runtimeLockName'); the path helpers append it to a backend directory."
    $composed = (Get-RuntimeLockPath -BackendDirectory "/tmp/proj/backend").Replace("\", "/")
    Assert-GuardTest `
        -Condition ($composed -eq "/tmp/proj/backend/$runtimeLockName") `
        -Message "Get-RuntimeLockPath must append the bare lock name to the backend directory it is given (got '$composed')."

    # (a1) The runtime lock is installable as written: every pin hashed, nothing
    # delegating to another file, and no development tool in it.
    $runtimeLockProblems = @(Get-RuntimeLockProblems -LockText $realRuntimeLockText -RejectDevTools)
    Assert-GuardTest `
        -Condition ($runtimeLockProblems.Count -eq 0) `
        -Message ("backend\$((Get-RuntimeLockFileName)) is not installable: " + ($runtimeLockProblems -join "; "))

    $runtimeNames = @(Get-RuntimeLockPackageNames -LockText $realRuntimeLockText)
    foreach ($name in $runtimeNames) {
        Assert-GuardTest `
            -Condition (-not (Test-DevToolPackageName -Name $name)) `
            -Message "backend\$(Get-RuntimeLockFileName) carries the development tool '$name'; the production runtime must not install it."
    }

    # (a2) Drift guard: the runtime lock must equal the projection of the single
    # pin source. This is what makes "one version source" verifiable without uv or
    # the network -- if someone edits the lock by hand, or re-resolves it against
    # different pins, the sets/versions stop matching here.
    $projected = @(Select-RuntimeLockEntries -LockText $realDevLockText -RequirementsText $realRequirementsText)
    $projectedText = ConvertTo-LockText -Entries $projected
    $projectedNames = @(Get-RuntimeLockPackageNames -LockText $projectedText)
    Assert-GuardTest `
        -Condition ($projectedNames.Count -gt 0) `
        -Message "Projecting the dev lock produced no entries; the '# via' parser is broken."

    $runtimeNameList = ($runtimeNames -join ",")
    $projectedNameList = ($projectedNames -join ",")
    $onlyInLock = (@($runtimeNames | Where-Object { $projectedNames -notcontains $_ }) -join ",")
    $onlyInProjection = (@($projectedNames | Where-Object { $runtimeNames -notcontains $_ }) -join ",")
    Assert-GuardTest `
        -Condition ($runtimeNameList -eq $projectedNameList) `
        -Message ("backend\$(Get-RuntimeLockFileName) is not the runtime closure of $((Get-RequirementsFileName)). " +
            "only in lock: [$onlyInLock] only in projection: [$onlyInProjection]")

    # Versions must be compared against the RUNTIME lock, not against the dev lock
    # the projection was copied from: the latter is a tautology (the projected entry
    # *is* the dev entry, so the two maps can never disagree) and yields a guard that
    # stays green forever. Measured before this fix: bumping pypdfium2 5.14.0 ->
    # 5.15.0 in the shipped lock still passed, because only the name set was
    # cross-checked and names never move when a version does.
    $runtimeVersions = Get-LockVersionMap -LockText $realRuntimeLockText
    $projectedVersions = Get-LockVersionMap -LockText $projectedText
    $versionDrift = @(
        $projectedVersions.Keys |
            Where-Object { "$($runtimeVersions[$_])" -ne "$($projectedVersions[$_])" } |
            ForEach-Object { "$_ (lock=$($runtimeVersions[$_]) expected=$($projectedVersions[$_]))" }
    )
    Assert-GuardTest `
        -Condition ($versionDrift.Count -eq 0) `
        -Message ("The runtime lock pins different versions than $((Get-DevelopmentLockFileName)): " + ($versionDrift -join ", "))

    # (a3) Environment markers are part of a universal lock, not noise: dropping
    # the one uvloop carries would make the lock platform-specific and break the
    # Linux install.
    $markerCount = @($projected | Where-Object { -not [string]::IsNullOrWhiteSpace($_.Marker) }).Count
    Assert-GuardTest `
        -Condition ($markerCount -gt 0) `
        -Message "Projection dropped every PEP 508 marker; a universal lock must keep them."
    Assert-GuardTest `
        -Condition ($projectedText -match "uvloop==" -and $projectedText -match "sys_platform") `
        -Message "The projected runtime lock must keep uvloop's sys_platform marker verbatim."

    # ---------------------------------------------------------------------
    # Part 2 - the status decision, on fixture zips and fixture locks.
    # ---------------------------------------------------------------------
    $requirementsPath = Join-Path $RuntimeDirectory "requirements.txt"
    Set-Content -LiteralPath $requirementsPath -Value "fastapi==0.142.2`npypdfium2==5.14.0" -Encoding ascii

    $lockA = New-FixtureLock -Path (Join-Path $RuntimeDirectory "lock-a.txt") -Pins @("fastapi==0.162.0", "pypdfium2==5.14.0")
    $lockB = New-FixtureLock -Path (Join-Path $RuntimeDirectory "lock-b.txt") -Pins @("fastapi==0.162.0", "pypdfium2==5.15.0")

    $zipPath = Join-Path $RuntimeDirectory "python-runtime.zip"
    New-FakeRuntimeZip -ZipPath $zipPath

    # (b1) stamped with lock A and checked against lock A -> UpToDate (reuse)
    Add-PythonRuntimeManifest -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $lockA -RequirementsPath $requirementsPath | Out-Null
    $upToDate = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($upToDate.State -eq "UpToDate") `
        -Message "A matching manifest must report UpToDate (got $($upToDate.State): $($upToDate.Reason))."

    # The marker really lives inside the archive, at the root, with the expected
    # fingerprint -- not in a sidecar a copy would drop.
    $stampedBack = Get-PythonRuntimeManifest -ZipPath $zipPath
    Assert-GuardTest -Condition ($null -ne $stampedBack) -Message "The manifest must read back out of the zip."
    Assert-GuardTest `
        -Condition ("$($stampedBack.runtimeLockSha256)" -eq (Get-RuntimeLockFingerprint -RuntimeLockPath $lockA)) `
        -Message "The stamped fingerprint must equal the SHA-256 of the production lock."

    # (b2) THE regression this schema exists for: requirements.txt untouched, only
    # the lock re-resolved. The fingerprint must move and the zip must rebuild.
    # Under schema 1 this case reported UpToDate and shipped the old package set.
    $fingerprintA = Get-RuntimeLockFingerprint -RuntimeLockPath $lockA
    $fingerprintB = Get-RuntimeLockFingerprint -RuntimeLockPath $lockB
    Assert-GuardTest `
        -Condition ($fingerprintA -ne $fingerprintB) `
        -Message "A lock-only change must change the runtime fingerprint."

    $staleByLock = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $lockB
    Assert-GuardTest `
        -Condition ($staleByLock.State -eq "Stale") `
        -Message "A lock-only change must report Stale (got $($staleByLock.State): $($staleByLock.Reason))."
    Assert-GuardTest `
        -Condition ($staleByLock.Reason -match [regex]::Escape((Get-RuntimeLockFileName))) `
        -Message "The stale reason must name the production lock (got '$($staleByLock.Reason)')."
    Assert-GuardTest `
        -Condition ("$($staleByLock.Expected)" -ne "$($staleByLock.Actual)") `
        -Message "A stale decision must expose both fingerprints."

    # (b3) a bundled-Python bump is also a mismatch.
    $staleByVersion = Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.13.0" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($staleByVersion.State -eq "Stale") `
        -Message "A bundled-Python bump must report Stale (got $($staleByVersion.State))."

    # (b4) a zip with no manifest (pre-guard cache) -> Stale
    $bareZip = Join-Path $RuntimeDirectory "old-runtime.zip"
    New-FakeRuntimeZip -ZipPath $bareZip
    Assert-GuardTest `
        -Condition ($null -eq (Get-PythonRuntimeManifest -ZipPath $bareZip)) `
        -Message "A zip without a manifest must read back as null."
    $staleBare = Get-PythonRuntimeStatus -ZipPath $bareZip -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($staleBare.State -eq "Stale") `
        -Message "A zip without a manifest must report Stale (got $($staleBare.State))."

    # (c) legacy manifest: schema 1 hashed requirements.txt and carries no lock
    # fingerprint. It must be stale, never reinterpreted.
    $legacyZip = Join-Path $RuntimeDirectory "legacy-runtime.zip"
    New-FakeRuntimeZip -ZipPath $legacyZip
    Set-FakeManifest -ZipPath $legacyZip -Json (@{
            schema             = 1
            pythonVersion      = "3.12.10"
            requirementsSha256 = (Get-RequirementsFingerprint -RequirementsPath $requirementsPath)
        } | ConvertTo-Json -Compress)
    $staleLegacy = Get-PythonRuntimeStatus -ZipPath $legacyZip -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($staleLegacy.State -eq "Stale") `
        -Message "A schema-1 manifest must report Stale (got $($staleLegacy.State))."
    Assert-GuardTest `
        -Condition ($staleLegacy.Reason -match "schema") `
        -Message "A legacy manifest must be rejected for its schema (got '$($staleLegacy.Reason)')."

    # (d) a schema-2 manifest with the lock field missing (hand-edited, or written
    # by a future writer that forgot the field) is stale, not "assume current".
    $noLockZip = Join-Path $RuntimeDirectory "no-lock-field-runtime.zip"
    New-FakeRuntimeZip -ZipPath $noLockZip
    Set-FakeManifest -ZipPath $noLockZip -Json (@{
            schema        = 2
            pythonVersion = "3.12.10"
        } | ConvertTo-Json -Compress)
    $staleNoField = Get-PythonRuntimeStatus -ZipPath $noLockZip -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($staleNoField.State -eq "Stale") `
        -Message "A manifest without the lock fingerprint must report Stale (got $($staleNoField.State))."
    Assert-GuardTest `
        -Condition ($staleNoField.Reason -match "fingerprint") `
        -Message "The reason must say the lock fingerprint is missing (got '$($staleNoField.Reason)')."

    # Also cover the empty-string shape, which is what a half-migrated manifest
    # looks like in practice.
    $emptyLockZip = Join-Path $RuntimeDirectory "empty-lock-field-runtime.zip"
    New-FakeRuntimeZip -ZipPath $emptyLockZip
    Set-FakeManifest -ZipPath $emptyLockZip -Json (@{
            schema            = 2
            pythonVersion     = "3.12.10"
            runtimeLockSha256 = ""
        } | ConvertTo-Json -Compress)
    $staleEmptyField = Get-PythonRuntimeStatus -ZipPath $emptyLockZip -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($staleEmptyField.State -eq "Stale") `
        -Message "An empty lock fingerprint must report Stale (got $($staleEmptyField.State))."

    # (e) an unusable lock must FAIL, never degrade to requirements.txt. A
    # checkout without the lock cannot install a reproducible runtime, so the
    # honest answer is an error that names the file.
    $missingLockPath = Join-Path $RuntimeDirectory "absent.lock.txt"
    $missingThrew = $false
    try {
        Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $missingLockPath | Out-Null
    }
    catch {
        $missingThrew = $true
        Assert-GuardTest `
            -Condition ($_.Exception.Message -match "not found") `
            -Message "A missing lock must fail with a 'not found' message (got '$($_.Exception.Message)')."
    }
    Assert-GuardTest -Condition $missingThrew -Message "A missing production lock must throw instead of reporting a state."

    # (f) corrupt locks are rejected with a reason that points at the defect:
    # no pins, no hashes, a delegating line, a truncated tail, or a dev tool.
    $zeroHash = "0" * 64
    $corruptCases = @(
        @{ Name = "empty"; Content = "# nothing here`n"; Expect = "no pinned" },
        @{ Name = "unhashed"; Content = "fastapi==0.162.0`n"; Expect = "no --hash=sha256" },
        @{ Name = "delegating"; Content = "fastapi==0.162.0 `n    --hash=sha256:$zeroHash`n-r requirements.txt`n"; Expect = "delegates" },
        @{ Name = "truncated"; Content = "fastapi==0.162.0 `n    --hash=sha256:$zeroHash \"; Expect = "truncated" },
        @{ Name = "devtool"; Content = "pytest==8.4.2 `n    --hash=sha256:$zeroHash`n"; Expect = "development tool" }
    )
    foreach ($case in $corruptCases) {
        $corruptPath = Join-Path $RuntimeDirectory ("corrupt-" + $case.Name + ".lock.txt")
        Set-Content -LiteralPath $corruptPath -Value $case.Content -Encoding ascii -NoNewline
        $problemText = (@(Get-RuntimeLockProblems -LockText (Read-LockTextFile -Path $corruptPath) -RejectDevTools) -join " | ")
        Assert-GuardTest `
            -Condition ($problemText -match [regex]::Escape($case.Expect)) `
            -Message "The '$($case.Name)' lock must be rejected for '$($case.Expect)' (reported: '$problemText')."

        $caseThrew = $false
        try {
            Get-PythonRuntimeStatus -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $corruptPath | Out-Null
        }
        catch { $caseThrew = $true }
        Assert-GuardTest `
            -Condition $caseThrew `
            -Message "The '$($case.Name)' lock must make the status check throw rather than fall back to requirements.txt."
    }

    # (g) an absent zip is Missing, which the ensure step also rebuilds.
    $missingStatus = Get-PythonRuntimeStatus -ZipPath (Join-Path $RuntimeDirectory "absent.zip") -PythonVersion "3.12.10" -RuntimeLockPath $lockA
    Assert-GuardTest `
        -Condition ($missingStatus.State -eq "Missing") `
        -Message "An absent zip must report Missing (got $($missingStatus.State))."

    # (h) the rebuild trigger, proven without a real download
    $rebuilds = @{ Count = 0 }
    $fakeRebuild = { $rebuilds.Count++ }

    $reuse = Invoke-PythonRuntimeEnsure -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $lockA -Rebuild $fakeRebuild
    Assert-GuardTest -Condition (-not $reuse.Rebuilt) -Message "An up-to-date zip must not trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 0) -Message "The rebuild action must not run for an up-to-date zip."

    $rebuiltStale = Invoke-PythonRuntimeEnsure -ZipPath $zipPath -PythonVersion "3.12.10" -RuntimeLockPath $lockB -Rebuild $fakeRebuild
    Assert-GuardTest -Condition ($rebuiltStale.Rebuilt) -Message "A stale zip must trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 1) -Message "The rebuild action must run once for a stale zip (ran $($rebuilds.Count))."

    $rebuiltMissing = Invoke-PythonRuntimeEnsure -ZipPath (Join-Path $RuntimeDirectory "absent.zip") -PythonVersion "3.12.10" -RuntimeLockPath $lockA -Rebuild $fakeRebuild
    Assert-GuardTest -Condition ($rebuiltMissing.Rebuilt) -Message "A missing zip must trigger a rebuild."
    Assert-GuardTest -Condition ($rebuilds.Count -eq 2) -Message "The rebuild action must run for a missing zip (ran $($rebuilds.Count))."

    # ---------------------------------------------------------------------
    # Part 3 - the build scripts must be wired to the guard and to the lock.
    # ---------------------------------------------------------------------
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
        -Condition ($desktopText -match "-RuntimeLockPath") `
        -Message "Build-Desktop.ps1 must key the decision on the production lock, not on requirements.txt."
    Assert-GuardTest `
        -Condition ($desktopText -match "Build-PythonRuntime\.ps1") `
        -Message "Build-Desktop.ps1 must still invoke Build-PythonRuntime.ps1 when it rebuilds."

    $runtimeText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($BuildRuntimePath))
    Assert-GuardTest `
        -Condition ($runtimeText -match "Add-PythonRuntimeManifest") `
        -Message "Build-PythonRuntime.ps1 must stamp the manifest into the zip it produces."
    Assert-GuardTest `
        -Condition ($runtimeText -match "--require-hashes") `
        -Message "Build-PythonRuntime.ps1 must install with --require-hashes."
    Assert-GuardTest `
        -Condition ($runtimeText -match "-r \`$runtimeLockPath") `
        -Message "Build-PythonRuntime.ps1 must install the production lock, not requirements.txt."

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

    # ---------------------------------------------------------------------
    # Part 4 - every production install point uses the same lock and the same
    # hash flag. A single file that still installs requirements.txt re-opens the
    # whole defect: that path has no hashes and lets the resolver pick versions.
    # ---------------------------------------------------------------------
    $installPoints = @(
        "scripts\Build-PythonRuntime.ps1",
        "scripts\ResumeForge.Process.ps1",
        "scripts\Update-ResumeForge.ps1",
        "scripts\macos\start.sh",
        "scripts\macos\update.sh",
        "scripts\linux\start.sh",
        "scripts\linux\update.sh"
    )
    $topLevelInstallPattern = '-r\s+"?\S*requirements\.txt'
    foreach ($relative in $installPoints) {
        $fullPath = Join-Path $ProjectRoot $relative
        Assert-GuardTest -Condition (Test-Path -LiteralPath $fullPath -PathType Leaf) -Message "Install point not found: $relative"
        $text = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($fullPath))
        Assert-GuardTest `
            -Condition ($text -match "--require-hashes") `
            -Message "$relative must install backend dependencies with --require-hashes."
        Assert-GuardTest `
            -Condition ($text -notmatch $topLevelInstallPattern) `
            -Message "$relative still installs requirements.txt directly; the production chain must install $(Get-RuntimeLockFileName)."
        Assert-GuardTest `
            -Condition ($text -match "requirements\.runtime\.lock\.txt" -or $text -match "Get-RuntimeLockPath" -or $text -match "rf_runtime_lock_path") `
            -Message "$relative must reference the production lock (by name, Get-RuntimeLockPath or rf_runtime_lock_path)."
    }

    # The updaters and the release packager must carry the lock with the program
    # files, or a fresh install from the new package fails on the missing lock.
    $linuxUpdateText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes((Join-Path $ProjectRoot "scripts\linux\update.sh")))
    Assert-GuardTest `
        -Condition ($linuxUpdateText -match "backend/requirements\.runtime\.lock\.txt\) return 0") `
        -Message "scripts\linux\update.sh must list the production lock in rf_is_program_path, or updates never replace it."
    Assert-GuardTest `
        -Condition ($linuxUpdateText -match "RF_BACKUP_PATHS_BASE=.*backend/requirements\.runtime\.lock\.txt") `
        -Message "scripts\linux\update.sh must back the production lock up before overwriting it."

    $releaseText = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes((Join-Path $ProjectRoot "scripts\Build-Release.ps1")))
    Assert-GuardTest `
        -Condition ($releaseText -match '"backend/requirements\.runtime\.lock\.txt"') `
        -Message "Build-Release.ps1 RequiredFiles must require the production lock, or release archives can ship without it."

    Write-Host "Python runtime guard tests passed."
}
finally {
    Send-TestDirectoryToRecycleBin -Path $RuntimeDirectory
}
