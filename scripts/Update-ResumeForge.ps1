<#
ResumeForge updater.

Updates the program files only. User data lives in data\ (database, datasets,
backups) and in .env, so those paths are never overwritten.

Two modes:
  * git checkout  -> git pull --ff-only, then sync dependencies
  * plain folder  -> download the repository zip and copy program files over

同步依赖前会先停掉仍在运行的简历通（按 `runtime\*.json` 的记录校验 PID、启动时间与
命令行），否则 `npm ci` 删不掉被前端占着的 `node_modules`，会以 EPERM 失败。

Run it from the project root with:  update.cmd
#>

[CmdletBinding()]
param(
    [switch]$SkipDependencies,
    [switch]$DryRun,
    [string]$ArchivePath = "",
    [int[]]$WaitForPids = @(),
    [int[]]$StopPids = @(),
    [switch]$Restart
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptRoot
$Repository = if ($env:RESUMEFORGE_UPDATE_REPO) { $env:RESUMEFORGE_UPDATE_REPO } else { "magicapple123/ResumeForge" }
$ArchiveUrl = "https://github.com/$Repository/archive/refs/heads/main.zip"

# Process records and the stop path are shared with start.cmd / stop.cmd: the same
# PID + start-time + command-line checks decide what may be stopped, so the updater
# cannot kill an unrelated process that happened to reuse a PID.
. (Join-Path $ScriptRoot "ResumeForge.Common.ps1")

# Paths that belong to the user or to the local environment; never overwritten.
$ExcludedNames = @(
    "data",
    "runtime",
    ".git",
    ".env",
    "node_modules",
    ".venv",
    "dist",
    "__pycache__",
    ".pytest_cache",
    "coverage"
)

function Write-Step {
    param([string]$Message)
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-External {
    param(
        [string]$FilePath,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $ProjectRoot
    )
    Write-Host ("    " + $FilePath + " " + ($Arguments -join " "))
    if ($DryRun) { return }
    # Native commands write progress to stderr; with $ErrorActionPreference = Stop
    # that would abort the script, so roll it back for the duration of the call.
    $previous = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        Push-Location $WorkingDirectory
        & $FilePath @Arguments
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
        $ErrorActionPreference = $previous
    }
    if ($code -ne 0) {
        throw "$FilePath exited with code $code"
    }
}

function Test-Excluded {
    param([string]$Name)
    return $ExcludedNames -contains $Name
}

function Wait-ForPidsExit {
    param(
        [int[]]$ProcessIds,
        [int]$TimeoutSeconds = 90
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $running = @($ProcessIds | Where-Object {
                $_ -gt 0 -and (Get-Process -Id $_ -ErrorAction SilentlyContinue)
            })
        if ($running.Count -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Timed out waiting for the running application to close: $($ProcessIds -join ', ')"
}

function Stop-FrontendPid {
    param([int]$ProcessId)
    if ($ProcessId -le 0) { return }
    $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
    if ($null -eq $process) { return }
    $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue).CommandLine
    if ($commandLine -notmatch "npm\.cmd.*\brun\s+dev") {
        Write-Warning "Skipped stopping PID $ProcessId because it is not the recorded ResumeForge frontend."
        return
    }
    & taskkill.exe /PID $ProcessId /T /F | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "Could not stop the ResumeForge frontend (PID $ProcessId)."
    }
}

<#
依赖同步要**删掉** `frontend\node_modules` 再重装（npm ci）、还要覆盖
`backend\.venv` 里的文件，而正在运行的简历通正把这些文件锁在手里：`npm ci` 删不掉
`node_modules\@esbuild\win32-x64\esbuild.exe` 就会以 EPERM 中断（2026-09-28 有用户
双击 update.cmd 时就是这么失败的），用户看到的是一页 npm 日志，看不出"关掉应用就能好"。

应用内「检查更新」走的是 -ArchivePath 分支，那里已经先等应用退出、再按传进来的 PID
停前端。手动双击 update.cmd 没有任何这类机制，所以在这里补上；**只补手动那条路径**——
在 -ArchivePath 分支里再按记录杀一次，会把正在运行更新器的那个后端连同进程树一起
杀掉（taskkill /T），更新器自己就没了。
#>
function Stop-RunningApplication {
    foreach ($service in @("frontend", "backend")) {
        Stop-RecordedProcess `
            -DisplayName $service `
            -RecordPath (Join-Path $ProjectRoot "runtime\$service.json") `
            -CommandPattern (Get-ResumeForgeProcessPattern -Service $service)
    }
}

function Write-DependencySyncHint {
    param([string]$Message)
    Write-Host ""
    Write-Host "    Dependency sync failed: $Message" -ForegroundColor Yellow
    Write-Host "    如果报的是 EPERM / EBUSY / operation not permitted，说明还有进程占着" -ForegroundColor Yellow
    Write-Host "    frontend\node_modules 或 backend\.venv 里的文件；最常见的原因是简历通还在" -ForegroundColor Yellow
    Write-Host "    运行（那个 start 窗口没关），杀毒软件也会占同一批文件。" -ForegroundColor Yellow
    Write-Host "    处理办法：双击 stop.cmd 关掉应用，再运行一次 update.cmd。" -ForegroundColor Yellow
}

function Copy-ProgramFiles {
    param(
        [string]$Source,
        [string]$Destination
    )
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        if (Test-Excluded -Name $_.Name) { return }
        $target = Join-Path $Destination $_.Name
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            Copy-ProgramFiles -Source $_.FullName -Destination $target
        } else {
            Copy-Item -LiteralPath $_.FullName -Destination $target -Force
        }
    }
}

Write-Host "ResumeForge updater" -ForegroundColor Green
Write-Host "Project: $ProjectRoot"
if ($DryRun) {
    Write-Host "Dry run: no file will be changed." -ForegroundColor Yellow
}

$extracted = $null
if ($ArchivePath) {
    $resolvedArchive = Resolve-Path -LiteralPath $ArchivePath -ErrorAction Stop
    if ($DryRun) {
        Write-Host "Would use the downloaded archive $resolvedArchive." -ForegroundColor Yellow
    }
    else {
        Write-Step "Preparing the downloaded update archive"
        $staging = Join-Path $ProjectRoot ("runtime\update-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Expand-Archive -LiteralPath $resolvedArchive -DestinationPath $staging -Force
        $extracted = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
        if (-not $extracted) {
            throw "The downloaded update archive did not contain a folder."
        }
    }
}
else {
    Write-Step "Checking repository"
    $gitDirectory = Join-Path $ProjectRoot ".git"
    $useGit = (Test-Path $gitDirectory) -and (Get-Command git -ErrorAction SilentlyContinue)

    if ($useGit) {
        Write-Step "Pulling the latest code (git pull --ff-only)"
        Invoke-External -FilePath "git" -Arguments @("-C", $ProjectRoot, "pull", "--ff-only")
    } elseif ($DryRun) {
        # In a dry run no archive is downloaded or extracted.
        Write-Host "Would download $ArchiveUrl and copy program files over $ProjectRoot." -ForegroundColor Yellow
        Write-Host "    data, .env, runtime, .venv and node_modules would be kept." -ForegroundColor DarkGray
    } else {
        Write-Step "Downloading the latest archive"
        $staging = Join-Path $ProjectRoot ("runtime\update-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
        $archive = Join-Path $staging "resumeforge.zip"
        New-Item -ItemType Directory -Force -Path $staging | Out-Null
        Invoke-WebRequest -Uri $ArchiveUrl -OutFile $archive -UseBasicParsing
        Expand-Archive -LiteralPath $archive -DestinationPath $staging -Force
        $extracted = Get-ChildItem -LiteralPath $staging -Directory | Select-Object -First 1
        if (-not $extracted) {
            throw "The downloaded archive did not contain a folder. Download it manually from https://github.com/$Repository/releases"
        }
        Write-Step "Copying program files (data, .env and runtime are kept)"
        Copy-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
        Write-Host "    Source kept at: $staging" -ForegroundColor DarkGray
    }
}

if ($ArchivePath -and -not $DryRun) {
    if ($WaitForPids.Count -gt 0) {
        Write-Step "Waiting for the running application to close"
        Wait-ForPidsExit -ProcessIds $WaitForPids
    }
    foreach ($processId in $StopPids) {
        Stop-FrontendPid -ProcessId $processId
    }
    if ($StopPids.Count -gt 0) {
        Start-Sleep -Milliseconds 800
    }
    Write-Step "Copying program files (data, .env and runtime are kept)"
    Copy-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
}

if ($SkipDependencies) {
    Write-Step "Dependency sync skipped (-SkipDependencies)"
} else {
    # 手动更新（没带 -ArchivePath）时先停掉仍在运行的实例：不停就只能等 npm 把
    # EPERM 甩到屏幕上。应用内更新已经在 -ArchivePath 分支里停过了，别重复。
    if (-not $ArchivePath -and -not $DryRun) {
        Write-Step "Stopping a running ResumeForge before touching node_modules / .venv"
        Stop-RunningApplication
    }

    $requirements = Join-Path $ProjectRoot "backend\requirements.txt"
    $venvPython = Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe"
    $packageJson = Join-Path $ProjectRoot "frontend\package.json"
    $nodeModules = Join-Path $ProjectRoot "frontend\node_modules"
    try {
        if ((Test-Path $requirements) -and (Test-Path $venvPython)) {
            Write-Step "Syncing backend dependencies"
            Invoke-External -FilePath $venvPython -Arguments @(
                "-m", "pip", "install", "--disable-pip-version-check", "-r", $requirements
            ) -WorkingDirectory (Join-Path $ProjectRoot "backend")
        } else {
            Write-Host "    Backend virtual environment not found; it will be created on the next start."
        }

        if ((Test-Path $packageJson) -and (Test-Path $nodeModules) -and (Get-Command npm -ErrorAction SilentlyContinue)) {
            Write-Step "Syncing frontend dependencies (npm ci)"
            Invoke-External -FilePath "npm" -Arguments @("ci", "--no-audit", "--no-fund") -WorkingDirectory (Join-Path $ProjectRoot "frontend")
        } else {
            Write-Host "    Frontend dependencies not installed; they will be installed on the next start."
        }
    } catch {
        Write-DependencySyncHint -Message $_.Exception.Message
        throw
    }
}

Write-Host ""
if ($DryRun) {
    Write-Host "Dry run finished: nothing was downloaded, copied or installed." -ForegroundColor Yellow
} else {
    Write-Host "Update finished." -ForegroundColor Green
    Write-Host "Start the app again with start.cmd. Your data in data\ was not touched." -ForegroundColor Green
    if ($Restart) {
        Write-Step "Restarting ResumeForge"
        $launcher = Join-Path $ProjectRoot "start.cmd"
        if (-not (Test-Path -LiteralPath $launcher)) {
            throw "The update completed, but start.cmd was not found, so the app was not restarted."
        }
        Start-Process -FilePath $launcher -WorkingDirectory $ProjectRoot -WindowStyle Hidden
    }
}
