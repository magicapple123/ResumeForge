# SPDX-License-Identifier: Apache-2.0
# PythonRuntimeManifest.ps1 - shared dependency guard for the bundled runtime.
#
# Why this file exists
# --------------------
# scripts\Build-Desktop.ps1 used to reuse desktop\python-runtime.zip whenever the
# file merely existed. On 2026-10-17 that shipped a desktop installer whose
# cached runtime predated the pypdfium2 pin added to backend\requirements.txt, so
# the packaged backend died at import time (ModuleNotFoundError: No module named
# 'pypdfium2'), the shell exhausted its restart budget and the app never came up.
# CI never hit it: CI builds the zip on the spot, so only "reuse an old local
# cache" walked into the trap.
#
# The guard
# ---------
# Build-PythonRuntime.ps1 stamps a small JSON manifest into the zip it writes
# (entry name at the zip root, next to python\, so the fingerprint travels with
# the file through copies, archives and re-distribution). Build-Desktop.ps1
# compares the stamped fingerprint and bundled Python version against the current
# checkout before reusing the zip; any mismatch -- including a zip that carries no
# manifest at all -- means rebuild.
#
# What the fingerprint covers (schema 2)
# --------------------------------------
# The identity of a runtime is the set of packages installed into it, and that
# set is defined by exactly one file: backend\requirements.runtime.lock.txt, the
# universal hash lock the whole production chain installs from. So the fingerprint
# is the SHA-256 of THAT file's bytes, plus the bundled Python version.
#
# Schema 1 hashed backend\requirements.txt instead. That was one level too high:
# a lock change (regenerated against the same top-level pins, e.g. a refreshed
# transitive version or hash) moved no byte in requirements.txt, so an old zip
# stayed "fresh" while describing a different package set. Schema 2 keys on the
# lock, so re-resolving it alone is enough to force a rebuild. Manifests written
# with schema 1 are therefore stale by definition and must rebuild -- the check
# below rejects any schema it does not know, which is also how a hand-edited
# manifest that lacks runtimeLockSha256 gets caught.
#
# Content, not mtime: a git checkout rewrites timestamps for identical content, so
# an mtime check would rebuild for nothing and, worse, could miss a change.
#
# Dot-source this file (`. scripts\PythonRuntimeManifest.ps1`); it defines
# functions only and emits no output. Every accessor below is a plain function on
# purpose, so behaviour does not depend on which scope dot-sourced the file.

# The lock helpers (file names, validation) live in their own file and this one
# refuses to work without them, so it pulls them in rather than relying on every
# caller to remember the order. Dot-sourcing the same file twice is harmless.
. (Join-Path $PSScriptRoot "Project-RuntimeLock.ps1")

function Get-PythonRuntimeManifestEntryName {
    # The manifest is a sibling of python\ inside the archive. Storing it in the
    # archive (rather than in a sidecar file next to it) keeps the marker
    # self-contained: whoever copies the zip carries the fingerprint with it.
    return "python-runtime.manifest.json"
}

function Get-PythonRuntimeManifestSchema {
    # Bumped when the manifest shape changes, so an older stamp is treated as
    # stale instead of being misread against a newer field set.
    #   1 = SHA-256 of backend\requirements.txt (pre-RF-09)
    #   2 = SHA-256 of backend\requirements.runtime.lock.txt + Python version
    return 2
}

function Get-RequirementsFingerprint {
    # SHA-256 over the raw bytes of a requirements file. Content-addressed, so a
    # git checkout (which changes mtime, not content) never looks "changed".
    param(
        [Parameter(Mandatory = $true)][string]$RequirementsPath
    )

    if (-not (Test-Path -LiteralPath $RequirementsPath -PathType Leaf)) {
        throw "requirements file not found at '$RequirementsPath'."
    }
    return (Get-FileHash -LiteralPath $RequirementsPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-RuntimeLockFingerprint {
    # SHA-256 of the production lock, after proving the lock is installable.
    #
    # Validation happens here, not in the builder, so no caller can hash a lock it
    # would then fail to install: a missing, truncated, hash-less or dev-tainted
    # lock throws with the offending lines named. There is deliberately no path
    # that falls back to requirements.txt -- re-resolving top-level pins is the
    # failure mode this whole guard exists to prevent.
    param(
        [Parameter(Mandatory = $true)][string]$RuntimeLockPath
    )

    if (-not (Get-Command Assert-RuntimeLockUsable -ErrorAction SilentlyContinue)) {
        throw "Get-RuntimeLockFingerprint needs scripts\Project-RuntimeLock.ps1 dot-sourced first."
    }    Assert-RuntimeLockUsable -LockPath $RuntimeLockPath | Out-Null
    return (Get-FileHash -LiteralPath $RuntimeLockPath -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-ManifestField {
    # StrictMode-safe property read: returns $null when the field is absent
    # instead of throwing on a hand-edited or older manifest.
    param(
        [Parameter(Mandatory = $true)][object]$Manifest,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $Manifest.PSObject.Properties[$Name]
    if ($null -eq $property) { return $null }
    return $property.Value
}

function New-PythonRuntimeManifest {
    # Builds the manifest object that gets stamped into the zip.
    #
    # RequirementsSha256 is recorded for diagnosis only ("top-level pins unchanged,
    # lock changed" is now a real and interesting case). The reuse decision below
    # never reads it.
    param(
        [Parameter(Mandatory = $true)][string]$PythonVersion,
        [Parameter(Mandatory = $true)][string]$RuntimeLockPath,
        [string]$RequirementsPath = ""
    )

    $manifest = [ordered]@{
        schema             = (Get-PythonRuntimeManifestSchema)
        pythonVersion      = $PythonVersion
        runtimeLockSha256  = (Get-RuntimeLockFingerprint -RuntimeLockPath $RuntimeLockPath)
        createdUtc         = (Get-Date).ToUniversalTime().ToString("o")
    }
    if (-not [string]::IsNullOrWhiteSpace($RequirementsPath)) {
        $manifest["requirementsSha256"] = (Get-RequirementsFingerprint -RequirementsPath $RequirementsPath)
    }
    return [pscustomobject]$manifest
}

function Add-PythonRuntimeManifest {
    # Writes/overwrites the manifest entry inside an existing zip. Called by
    # Build-PythonRuntime.ps1 right after 7za/Compress-Archive produced the zip.
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$PythonVersion,
        [Parameter(Mandatory = $true)][string]$RuntimeLockPath,
        [string]$RequirementsPath = ""
    )

    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
        throw "cannot stamp a runtime manifest: zip not found at '$ZipPath'."
    }

    $manifest = New-PythonRuntimeManifest `
        -PythonVersion $PythonVersion `
        -RuntimeLockPath $RuntimeLockPath `
        -RequirementsPath $RequirementsPath
    $json = $manifest | ConvertTo-Json -Compress
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    $entryName = Get-PythonRuntimeManifestEntryName

    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::Open($ZipPath, [System.IO.Compression.ZipArchiveMode]::Update)
    try {
        $existing = $archive.GetEntry($entryName)
        if ($null -ne $existing) { $existing.Delete() }
        $entry = $archive.CreateEntry($entryName, [System.IO.Compression.CompressionLevel]::Optimal)
        $stream = $entry.Open()
        try {
            $stream.Write($bytes, 0, $bytes.Length)
        }
        finally {
            $stream.Dispose()
        }
    }
    finally {
        $archive.Dispose()
    }
    return $manifest
}

function Get-PythonRuntimeManifest {
    # Reads the manifest back out of a zip. Returns $null when the zip is
    # missing, carries no manifest entry, or holds an unparsable one -- all of
    # which the status check below treats as "no usable marker".
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath
    )

    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { return $null }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $text = $null
    try {
        $archive = [System.IO.Compression.ZipFile]::OpenRead($ZipPath)
        try {
            $entryName = Get-PythonRuntimeManifestEntryName
            $entry = $archive.Entries | Where-Object { $_.FullName -eq $entryName } | Select-Object -First 1
            if ($null -eq $entry) { return $null }
            $stream = $entry.Open()
            try {
                $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
                try {
                    $text = $reader.ReadToEnd()
                }
                finally {
                    $reader.Dispose()
                }
            }
            finally {
                $stream.Dispose()
            }
        }
        finally {
            $archive.Dispose()
        }
    }
    catch {
        return $null
    }
    try {
        return ($text | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Get-PythonRuntimeStatus {
    # The judgement call, kept pure and side-effect free so tests can exercise it
    # without downloading or installing anything. States:
    #   Missing  - no zip at all (first-ever build)
    #   Stale    - zip exists but must not be reused
    #   UpToDate - zip matches the current production lock + Python version
    #
    # Throws when the lock itself is unusable. That is the point: "we could not
    # tell what the runtime should contain" must not be reported as either
    # UpToDate (stale reuse) or Stale (a rebuild that would also fail).
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$PythonVersion,
        [Parameter(Mandatory = $true)][string]$RuntimeLockPath
    )

    $expected = Get-RuntimeLockFingerprint -RuntimeLockPath $RuntimeLockPath

    if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) {
        return [pscustomobject]@{
            State    = "Missing"
            Reason   = "the cached zip does not exist yet"
            Expected = $expected
            Actual   = $null
        }
    }

    $manifest = Get-PythonRuntimeManifest -ZipPath $ZipPath
    if ($null -eq $manifest) {
        return [pscustomobject]@{
            State    = "Stale"
            Reason   = "the cached zip carries no dependency manifest (built before this guard existed)"
            Expected = $expected
            Actual   = $null
        }
    }

    $manifestSchema = Get-ManifestField -Manifest $manifest -Name "schema"
    if ("$manifestSchema" -ne "$(Get-PythonRuntimeManifestSchema)") {
        return [pscustomobject]@{
            State    = "Stale"
            Reason   = "the runtime manifest schema is outdated (found '$manifestSchema', need '$(Get-PythonRuntimeManifestSchema)')"
            Expected = $expected
            Actual   = $null
        }
    }

    $manifestPython = Get-ManifestField -Manifest $manifest -Name "pythonVersion"
    if ("$manifestPython" -ne $PythonVersion) {
        return [pscustomobject]@{
            State    = "Stale"
            Reason   = "the bundled Python version changed (zip has '$manifestPython', build wants '$PythonVersion')"
            Expected = $expected
            Actual   = $null
        }
    }

    # Absent field, empty string and "null" all mean the same thing: this stamp
    # cannot prove which lock produced the runtime.
    $manifestLock = Get-ManifestField -Manifest $manifest -Name "runtimeLockSha256"
    if ([string]::IsNullOrWhiteSpace("$manifestLock") -or "$manifestLock" -eq "null") {
        return [pscustomobject]@{
            State    = "Stale"
            Reason   = "the runtime manifest carries no $(Get-RuntimeLockFileName) fingerprint, so the bundled package set is unknown"
            Expected = $expected
            Actual   = $null
        }
    }

    if ("$manifestLock" -ne $expected) {
        return [pscustomobject]@{
            State    = "Stale"
            Reason   = "$(Get-RuntimeLockFileName) changed since the runtime was built"
            Expected = $expected
            Actual   = "$manifestLock"
        }
    }

    return [pscustomobject]@{
        State    = "UpToDate"
        Reason   = "matches $(Get-RuntimeLockFileName) and Python $PythonVersion"
        Expected = $expected
        Actual   = $expected
    }
}

function Invoke-PythonRuntimeEnsure {
    # Wires the judgement to an action. The rebuild is injected as a scriptblock
    # so the decision ("rebuild" vs "reuse") is testable without running the real
    # download + pip install: production passes the Build-PythonRuntime.ps1 call,
    # tests pass a counter. Only the defaults differ between the two. Returns the
    # decision that was taken (Rebuilt = $true/$false).
    param(
        [Parameter(Mandatory = $true)][string]$ZipPath,
        [Parameter(Mandatory = $true)][string]$PythonVersion,
        [Parameter(Mandatory = $true)][string]$RuntimeLockPath,
        [Parameter(Mandatory = $true)][scriptblock]$Rebuild
    )

    $status = Get-PythonRuntimeStatus -ZipPath $ZipPath -PythonVersion $PythonVersion -RuntimeLockPath $RuntimeLockPath
    if ($status.State -eq "UpToDate") {
        Write-Host "python-runtime.zip is up to date ($($status.Reason)); reusing it."
        return [pscustomobject]@{ Rebuilt = $false; State = $status.State; Reason = $status.Reason }
    }

    Write-Host "Rebuilding python-runtime.zip - $($status.Reason) (one-time: downloads the embeddable Python + pip install)."
    & $Rebuild
    return [pscustomobject]@{ Rebuilt = $true; State = $status.State; Reason = $status.Reason }
}
