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
    [switch]$Restart,
    # 应用内更新会带上这两个：`-InstallId` 是"这一次安装"的唯一标识（后端靠它确认
    # 更新器真的起来了，见 `runtime\update-status.json`），`-TargetVersion` 是要升到的
    # 版本号，用来核对"新版本到底跑起来没有"。
    [string]$InstallId = "",
    [string]$TargetVersion = ""
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

$StatusPath = Join-Path $ProjectRoot "runtime\update-status.json"
$InstallStartedAt = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
# 只有"没有 -ArchivePath 且这个目录是 git 检出"时才为真。显式给初值：下面决定
# 要不要在依赖同步前停应用时要用到它，而 `-ArchivePath` 分支根本不会走到赋值的那个
# 分支——依赖未定义变量是碰运气。
$useGit = $false
# 重启之后最多等这么久，看新版本有没有真的起来（启动器自己的预算是后端 90s + 前端
# 120s，所以这里要留得比它们宽）。
$VerifyTimeoutSeconds = 240

# 这两个函数**必须在 `trap` 之前定义**：PowerShell 从上往下执行，函数在定义处才可见，
# 而 trap 里会调 `Write-InstallStatus`——它若还没定义，真正的故障就会被一句"无法将
# Write-InstallStatus 识别为 cmdlet"盖掉，用户拿到的是一条与原因无关的报错。
# 2026-10-01 的升级彩排逮到过这一处（当时 `$FromVersion = Get-InstalledVersion` 写在
# 文件顶部，脚本一上来就死了）。其余函数放在后面无妨，它们只在主体里被调用。
function Get-InstalledVersion {
    $configPath = Join-Path $ProjectRoot "backend\app\config.py"
    if (-not (Test-Path -LiteralPath $configPath)) { return "" }
    $match = Select-String -LiteralPath $configPath -Pattern 'app_version:\s*str\s*=\s*"([^"]+)"' |
        Select-Object -First 1
    if ($null -eq $match) { return "" }
    return $match.Matches[0].Groups[1].Value
}

<#
把这次安装的状态写进 `runtime\update-status.json`。

应用内更新是**隐藏窗口**在跑：失败时用户什么都看不到，只会发现"应用关了，什么都没发生"。
这个文件是唯一能告诉他"这次没成、日志在哪"的东西，后端下次启动时读它并显示出来。
只按相对路径碰 `runtime\`（更新不会覆盖 runtime），所以它一定还在。
#>
function Write-InstallStatus {
    param(
        [string]$State,
        [string]$Message = ""
    )
    if (-not $InstallId) { return }
    # 目录从状态文件自己的路径推出来，而不是另外拼一遍：两者必须是同一个地方。
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $StatusPath) | Out-Null
    $payload = [ordered]@{
        install_id     = $InstallId
        state          = $State
        from_version   = $script:FromVersion
        target_version = $TargetVersion
        started_at     = $script:InstallStartedAt
        restart        = [bool]$Restart
        message        = $Message
        log            = "runtime/update.log"
    }
    # `Set-Content -Encoding utf8` 在 Windows PowerShell 5.1 下会带 BOM；后端按
    # utf-8-sig 读，两种写法都认。
    ($payload | ConvertTo-Json) | Set-Content -LiteralPath $StatusPath -Encoding utf8
}

<#
任何一步失败都要留下"失败"的痕迹再往外抛。

应用内更新是隐藏窗口在跑（`Start-Process -WindowStyle Hidden` + 输出重定向到
`runtime\update.log`），失败时用户看不到任何东西——只会发现"应用关了，什么都没发生"。
原先连输出都被丢进 DEVNULL，连事后排查都没有线索；现在状态文件 + 日志两样都在，
后端下次启动会读状态文件并把原因显示出来。

用 `trap` 而不是把整段主体包进 try/catch：它会捕获脚本作用域里所有终止性错误，不必把
下面一百多行整体缩进一遍；`break` 让错误照旧往外抛，`update.cmd` 仍能拿到非 0 退出码。
#>
trap {
    Write-InstallStatus -State "failed" -Message ($_.Exception.Message)
    break
}

# 更新时要跳过的路径，分两层——因为"名字叫 data"在不同层级含义完全不同：
#   * 任何层级都是本地环境或缓存：`.git`、`node_modules`、`.venv`、`__pycache__` 之类；
#   * 只有项目根下的这几个位置才是用户数据与本地运行时。
# **必须按相对路径判断**：早先的规则是"任意层级下名为 data 的目录"，于是受跟踪的
# `backend/app/data/`（skills.json、ats_keywords.json，`preflight.py` 必需）被静默跳过
# ——新版本往那个目录里加的文件永远到不了老用户机器上，preflight 随后会拒绝启动
# （2026-10-01 发现）。两条规则都不能省：只按名字会误伤 `backend/app/data`，只按
# 相对路径又会让 `frontend/node_modules` 这种深层目录被复制进去。
$ExcludedAnyDepthNames = @(
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    "dist",
    "coverage",
    ".env"
)
$ExcludedRootRelative = @(
    "data",
    "runtime",
    "backend/data"
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
    param([string]$RelativePath)

    # 大小写不敏感：Windows 与 macOS 的默认文件系统都是；压缩包里的名字是原样的大小写，
    # 所以这里统一小写之后再比。
    $normalized = $RelativePath.Replace("\", "/").Trim("/").ToLowerInvariant()
    if (-not $normalized) {
        return $false
    }

    foreach ($segment in $normalized.Split("/")) {
        if ($ExcludedAnyDepthNames -contains $segment) {
            return $true
        }
    }
    foreach ($rule in $ExcludedRootRelative) {
        # 带斜杠地比前缀，才不会把 `backend/database.py` 当成 `backend/data` 下的文件。
        if ($normalized -eq $rule -or $normalized.StartsWith("$rule/")) {
            return $true
        }
    }
    return $false
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

function Get-DefaultBackendPort {
    # 更新器不参与启动，拿不到运行时端口；读启动器里的默认值就够——用户若用
    # `-BackendPort` 起在别的端口上，下面那次核对会超时，而后端会用**版本号**兜底
    # （见 `update_download.read_install_result`：版本对上就算成功）。
    $launcherPath = Join-Path $ScriptRoot "Start-ResumeForge.ps1"
    if (-not (Test-Path -LiteralPath $launcherPath)) { return 8005 }
    $match = Select-String -LiteralPath $launcherPath -Pattern '\$BackendPort\s*=\s*(\d+)' |
        Select-Object -First 1
    if ($null -eq $match) { return 8005 }
    return [int]$match.Matches[0].Groups[1].Value
}

function Wait-ForTargetVersion {
    param([int]$TimeoutSeconds = 240)

    if (-not $TargetVersion) { return $true }
    $healthUrl = "http://127.0.0.1:$(Get-DefaultBackendPort)"
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        $health = Get-ResumeForgeHealth -Url $healthUrl
        if ($null -ne $health -and [string]$health.version -eq $TargetVersion) {
            return $true
        }
        Start-Sleep -Seconds 2
    }
    return $false
}

function Resolve-ExtractedPackage {
    param([string]$Staging)

    $extracted = Get-ChildItem -LiteralPath $Staging -Directory | Select-Object -First 1
    if (-not $extracted) {
        throw "The downloaded archive did not contain a folder. Download it manually from https://github.com/$Repository/releases"
    }
    if (-not (Test-Path -LiteralPath (Join-Path $extracted.FullName "start.cmd"))) {
        # 解压出来的第一个目录未必是我们的包（`__MACOSX` 之类也会是目录）。少了这个
        # 判断就会"更新完成"地报告成功，而实际上一行文件都没覆盖。
        throw "The downloaded archive does not look like a ResumeForge package (no start.cmd). Download it manually from https://github.com/$Repository/releases"
    }
    return $extracted
}

function Copy-ProgramFiles {
    param(
        [string]$Source,
        [string]$Destination,
        # 相对项目根的路径，供 Test-Excluded 判断——排除规则看的就是这个，不是名字。
        [string]$RelativePath = ""
    )
    Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
        $childRelative = if ($RelativePath) { "$RelativePath/$($_.Name)" } else { $_.Name }
        if (Test-Excluded -RelativePath $childRelative) { return }
        $target = Join-Path $Destination $_.Name
        if ($_.PSIsContainer) {
            New-Item -ItemType Directory -Force -Path $target | Out-Null
            Copy-ProgramFiles -Source $_.FullName -Destination $target -RelativePath $childRelative
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

# **必须放在所有函数定义之后**：PowerShell 从上往下执行，函数在定义之前不可见。
# 这里调用 `Get-InstalledVersion` 与 `Write-InstallStatus`，把它们放到文件顶部会以
# "无法将 … 识别为 cmdlet" 在脚本一开始就死掉——而且 trap 里那句也一起失效（它同样
# 调用未定义的函数），用户看到的会是完全无关的报错。2026-10-01 的升级彩排逮到过这一处。
$FromVersion = Get-InstalledVersion

# 起手第一件事就写状态：后端会轮询它确认"更新器真的起来了"，收不到就不退出应用
# （不然就是"应用关了、什么都没发生"）。写在这里也意味着**解压之前**就已经有凭据了。
if (-not $DryRun) {
    Write-InstallStatus -State "installing" -Message "正在覆盖程序文件"
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
        $extracted = Resolve-ExtractedPackage -Staging $staging
    }
}
else {
    Write-Step "Checking repository"
    $gitDirectory = Join-Path $ProjectRoot ".git"
    $useGit = [bool]((Test-Path $gitDirectory) -and (Get-Command git -ErrorAction SilentlyContinue))

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
        $extracted = Resolve-ExtractedPackage -Staging $staging

        # **先停应用再覆盖**。反过来的话，正在运行的实例被覆盖时会锁住文件，`Copy-Item`
        # 中途抛错就留下一棵"一半新一半旧"的树，而且没有回滚。停在这一步之后（不是之前）
        # 是有意的：下载或解压失败时不该把用户正在用的应用关掉。
        Write-Step "Stopping a running ResumeForge before copying program files"
        Stop-RunningApplication

        Write-Step "Copying program files (data, .env and runtime are kept)"
        try {
            Copy-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
        } catch {
            Write-DependencySyncHint -Message $_.Exception.Message
            throw
        }
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
    # git 分支在这里再停一次：上面只 pull 了代码，还没碰过文件，所以停在这一步之前
    # 都来得及；而 npm ci 删 node_modules、pip 覆盖 .venv 时必须有文件锁的进程先退出。
    # 另外两条分支**不能**在这里再调一次：手动 zip 分支在覆盖之前已经停过了，而
    # `-ArchivePath` 分支更不能停——更新器是那个后端的子进程，`taskkill /T` 会连
    # 更新器自己一起杀掉。
    if ($useGit -and -not $DryRun) {
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
        # 重启也是隐藏窗口，失败时用户看不到任何东西——把它的输出也留一份。
        Start-Process -FilePath $launcher -WorkingDirectory $ProjectRoot -WindowStyle Hidden `
            -RedirectStandardOutput (Join-Path $ProjectRoot "runtime\restart.stdout.log") `
            -RedirectStandardError (Join-Path $ProjectRoot "runtime\restart.stderr.log")
    }

    # **文件覆盖完不等于更新成功**：依赖同步可能失败、迁移可能中断、端口可能起不来。
    # 只有 `/api/health` 报出来的版本号等于目标版本，才写 success——写早了界面就会
    # 在下次打开时撒谎（"已更新"而其实还在跑旧版本）。
    if ($InstallId) {
        if ($Restart) {
            Write-Step "Verifying the new version is running"
        }
        if (-not $Restart) {
            Write-InstallStatus -State "success" -Message "文件已更新；双击 start.cmd 重新打开即可"
        } elseif (Wait-ForTargetVersion -TimeoutSeconds $VerifyTimeoutSeconds) {
            Write-InstallStatus -State "success" -Message "已更新到 $TargetVersion"
        } else {
            Write-InstallStatus -State "failed" `
                -Message "文件已覆盖，但 $VerifyTimeoutSeconds 秒内没等到新版本起来；请查看 runtime\restart.stderr.log"
        }
    }
}
