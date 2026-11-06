# SPDX-License-Identifier: Apache-2.0
# Check-All.ps1 - one-shot full quality gate for ResumeForge.
# Pure ASCII content (PS 5.1 BOM safety). No npx (repo rule).
param(
    [switch]$SkipBuild,
    [switch]$SkipAudit
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py  = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = "python" }
$ruff = Join-Path $root "backend\.venv\Scripts\ruff.exe"
if (-not (Test-Path $ruff)) { $ruff = "ruff" }

$failed = @()
$sw = [System.Diagnostics.Stopwatch]::StartNew()

function Step($name) { Write-Host "`n=== [$name] ===" -ForegroundColor Cyan }

# ---- Backend: ruff ----
Step "1/6 ruff (backend)"
& $ruff check backend/app backend/tests
if ($LASTEXITCODE -ne 0) { $failed += "ruff" }

# Format check covers only the Python files this checkout touches, never the whole tree:
# a large share of the existing files is not `ruff format` clean (measured 2026-11-06 over
# backend/app + backend/tests: 501 would be reformatted, 979 already formatted), so a
# directory-wide check is red on an untouched checkout and says nothing about the change.
# The pre-commit hook applies the same idea to staged files; here we cover the working
# tree, i.e. everything that differs from HEAD plus the untracked files.
$changedPy = @()
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if ($null -eq $gitCmd) {
    Write-Host "git not found; skipping the changed-file format check" -ForegroundColor Yellow
} else {
    $inTree = & git rev-parse --is-inside-work-tree 2>$null
    if ($LASTEXITCODE -ne 0 -or ([string]$inTree).Trim() -ne "true") {
        Write-Host "not a git work tree; skipping the changed-file format check" -ForegroundColor Yellow
    } else {
        # Tracked changes (added, copied, modified, renamed) against HEAD, plus untracked files.
        $trackedPy = @(& git diff --name-only --diff-filter=ACMR HEAD -- backend/app backend/tests)
        $untrackedPy = @(& git ls-files --others --exclude-standard -- backend/app backend/tests)
        foreach ($entry in (@($trackedPy) + @($untrackedPy))) {
            if ($null -eq $entry) { continue }
            $name = ([string]$entry).Trim()
            if ($name -eq "") { continue }
            if ($name -notmatch '\.py$') { continue }
            if ($changedPy -notcontains $name) { $changedPy += $name }
        }
        $changedPy = @($changedPy | Sort-Object)
        if ($changedPy.Count -eq 0) {
            Write-Host "no changed Python files under backend/app, backend/tests; format check skipped"
        } else {
            Write-Host ("format --check on " + $changedPy.Count + " changed Python file(s)")
            & $ruff format --check @changedPy
            if ($LASTEXITCODE -ne 0) { $failed += "ruff-format" }
        }
    }
}

# ---- Backend: full pytest (exclude canary tests that need live app on 9333) ----
Step "2/6 pytest (backend full, canary excluded)"
Push-Location backend
& $py -m pytest tests -q -n 2 --ignore-glob="tests/test_webform_js_canary*.py"
$pytestExit = $LASTEXITCODE
Pop-Location
if ($pytestExit -ne 0) { $failed += "pytest-backend" }

# ---- Frontend: typecheck ----
Step "3/6 tsc (frontend)"
Push-Location frontend
& npm run typecheck
if ($LASTEXITCODE -ne 0) { $failed += "tsc" }

# ---- Frontend: eslint ----
Step "4/6 eslint (frontend)"
& npm run lint
if ($LASTEXITCODE -ne 0) { $failed += "eslint" }

# ---- Frontend: vitest ----
Step "5/6 vitest (frontend)"
& npm run test
if ($LASTEXITCODE -ne 0) { $failed += "vitest" }

# ---- npm audit (official registry; npmmirror lacks audit endpoint) ----
if (-not $SkipAudit) {
    Step "5b/6 npm audit (official registry)"
    & npm audit --registry=https://registry.npmjs.org --audit-level=high
    if ($LASTEXITCODE -ne 0) { $failed += "npm-audit" }
}

# ---- Frontend: production build ----
if (-not $SkipBuild) {
    Step "6/6 vite build"
    & npm run build
    if ($LASTEXITCODE -ne 0) { $failed += "vite-build" }
}
Pop-Location

$sw.Stop()
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host ("Total: {0:mm\:ss}" -f $sw.Elapsed)
if ($failed.Count -gt 0) {
    Write-Host ("FAILED: " + ($failed -join ", ")) -ForegroundColor Red
    exit 1
}
Write-Host "ALL GREEN" -ForegroundColor Green
