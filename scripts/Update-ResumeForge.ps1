# SPDX-License-Identifier: Apache-2.0
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
#   * 只有项目根下的这几个位置才是用户数据、本地运行时与发布产物。
# **必须按相对路径判断**：早先的规则是"任意层级下名为 data 的目录"，于是受跟踪的
# `backend/app/data/`（skills.json、ats_keywords.json，`preflight.py` 必需）被静默跳过
# ——新版本往那个目录里加的文件永远到不了老用户机器上，preflight 随后会拒绝启动
# （2026-10-01 发现）。两条规则都不能省：只按名字会误伤 `backend/app/data`，只按
# 相对路径又会让 `frontend/node_modules` 这种深层目录被复制进去。
#
# `dist` 是同一个坑的第二次（2026-10-02 定位）。它指的是**仓库根部**的发布产物目录
# （`dist\ResumeForge-1.0.2.zip`、`dist\ResumeForge-Setup-1.0.2.exe`，由
# `scripts\Build-Release.ps1` 生成），2026-09-17 却被塞进了"任意层级按名字排除"，于是
# `frontend\dist\**` 被整目录跳过——而 `frontend\dist` 是**唯一会随更新包分发的前端产物**
# （发布脚本显式收录它），`frontend\dist\version.json` 就是界面上那个版本号的来源。
# 后果：升级后后端是新的、前端还是旧的，`version.json` 与后端版本对不上，「有新版本」
# 的提示永远消不掉。所以 `dist` 现在只按根相对排除：根部那份发布产物照旧不覆盖，
# `frontend\dist` 走正常的复制路径。**不要**再给它加任何特例——加了就等于让前端
# 永远升不上去。
$ExcludedAnyDepthNames = @(
    ".git",
    ".venv",
    "node_modules",
    "__pycache__",
    ".pytest_cache",
    "coverage",
    ".env"
)
$ExcludedRootRelative = @(
    "data",
    "runtime",
    "backend/data",
    "dist"
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

<#
找出"该用哪个 Python 去 pip install 后端依赖"。

原先这里写死了 `backend\.venv\Scripts\python.exe`，找不到就打印一句
"it will be created on the next start." 然后什么都不装。桌面安装里根本没有这个 venv
——它用的是打包好的运行时（`%LOCALAPPDATA%\ResumeForge\runtime\python\python.exe`，
见 `desktop\lib\backend-runtime.js`），于是桌面用户升级时依赖一行都没装过：1.0.2 新增的
`pypdfium2` 是顶层 import（`backend\app\api\attachments.py`、`services\pdf_page_images.py`），
缺了它 uvicorn 加载即崩，应用起不来而且没人知道为什么。

候选按"当前是哪种形态"排列，取第一个存在的：
  1. `backend\.venv\Scripts\python.exe`            源码/开发形态（start.cmd 建的）
  2. `%LOCALAPPDATA%\ResumeForge\runtime\python\python.exe`  桌面形态的打包运行时
  3. `<root>\python\python.exe`、`<root>\python-runtime\python.exe`  便携形态兜底

一个都找不到就**抛异常**：静默跳过正是上面那个 bug 的根源，宁可这次更新报失败
（用户能看到失败原因和日志），也不要"更新成功"地留下一棵装不上依赖的树。
`$LocalAppData` 做成参数是为了能在测试里造出假布局，不必碰真实用户目录。
#>
function Resolve-BackendPython {
    param(
        [string]$ProjectRoot,
        [string]$LocalAppData = $env:LOCALAPPDATA
    )

    $candidates = @(
        (Join-Path $ProjectRoot "backend\.venv\Scripts\python.exe")
    )
    if ($LocalAppData) {
        $candidates += (Join-Path $LocalAppData "ResumeForge\runtime\python\python.exe")
    }
    $candidates += @(
        (Join-Path $ProjectRoot "python\python.exe"),
        (Join-Path $ProjectRoot "python-runtime\python.exe")
    )

    foreach ($candidate in $candidates) {
        if (-not $candidate) { continue }
        if (Test-Path -LiteralPath $candidate) {
            return (Resolve-Path -LiteralPath $candidate).ProviderPath
        }
    }

    $tried = $candidates -join "、"
    throw ("找不到后端 Python 解释器：已依次尝试 $tried。桌面版请重新运行 Setup.exe 安装包；" +
        "源码版请先双击 start.cmd 生成 backend\.venv。")
}

<#
这个目录是不是桌面安装里的 `resources\payload`？

桌面形态下更新器被复制到 `安装目录\resources\payload\scripts\` 里执行，程序根是
`resources\payload`（见 `desktop\main.js` 的 payload 布局）。此时 `payload\start.cmd`
只是源码形态的启动器：从它 `Start-Process` 起来的是**另一套**服务（另找端口、另建数据
目录、日志落到 payload 里），用户会看到两个简历通，而真正要重启的桌面应用并不知道自己
应该重启。所以桌面形态下不 spawn 启动器，只提示用户重新打开应用。
#>
function Test-DesktopPayload {
    param([string]$ProjectRoot)

    if (-not $ProjectRoot) { return $false }
    # 规范化分隔符并去掉尾部分隔符，再匹配末两级目录名；`-match` 本身不区分大小写，
    # `(?i)` 只是把意图写在正则里。
    $normalized = $ProjectRoot.Replace("\", "/").TrimEnd("/")
    return [bool]($normalized -match "(?i)/resources/payload$")
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

<#
更新前给用户数据拍一份快照。

程序文件覆盖失败可以重跑；但一旦新版本的数据库迁移在旧数据上出了问题，没有这份
快照就没有回头路——这是更新链上最后一道数据保险。调用点都在"应用已被停掉"之后
（三条覆盖路径都会先停），SQLite 进程干净退出后 WAL 已合并回主库，直接拷文件就是
一致快照。

只拷数据库与其旁文件（backend\data\*.db + datasets\*.db）和轻量 json 指针；浏览器登录态、
既有备份包、采集样例、日志都不属于"要回滚的数据"。保留最近 3 份在 backend\data\pre-update\。
#>
function Backup-UserData {
    if ($DryRun) { return }
    # 真实用户数据在 backend\data（见 backend/app/config.py 的 DATA_DIR）；项目根下的
    # data\ 不存在，读错了就会在这里静默提前 return、从不生成快照。
    $dataRoot = Join-Path $ProjectRoot "backend\data"
    if (-not (Test-Path -LiteralPath $dataRoot)) { return }
    $destination = Join-Path $dataRoot ("pre-update\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    New-Item -ItemType Directory -Force -Path $destination | Out-Null
    $copied = 0
    foreach ($dbFile in @(Get-ChildItem -LiteralPath $dataRoot -Filter "*.db" -File -ErrorAction SilentlyContinue)) {
        Copy-Item -LiteralPath $dbFile.FullName -Destination $destination -Force
        $copied++
        foreach ($sidecarSuffix in @("-wal", "-shm", "-journal")) {
            $sidecar = "$($dbFile.FullName)$sidecarSuffix"
            if (Test-Path -LiteralPath $sidecar) {
                Copy-Item -LiteralPath $sidecar -Destination $destination -Force
            }
        }
    }
    foreach ($jsonFile in @(Get-ChildItem -LiteralPath $dataRoot -Filter "*.json" -File -ErrorAction SilentlyContinue)) {
        Copy-Item -LiteralPath $jsonFile.FullName -Destination $destination -Force
        $copied++
    }
    $datasets = Join-Path $dataRoot "datasets"
    if (Test-Path -LiteralPath $datasets) {
        New-Item -ItemType Directory -Force -Path (Join-Path $destination "datasets") | Out-Null
        foreach ($dbFile in @(Get-ChildItem -LiteralPath $datasets -Filter "*.db" -File -ErrorAction SilentlyContinue)) {
            Copy-Item -LiteralPath $dbFile.FullName -Destination (Join-Path $destination "datasets") -Force
            $copied++
            foreach ($sidecarSuffix in @("-wal", "-shm", "-journal")) {
                $sidecar = "$($dbFile.FullName)$sidecarSuffix"
                if (Test-Path -LiteralPath $sidecar) {
                    Copy-Item -LiteralPath $sidecar -Destination (Join-Path $destination "datasets") -Force
                }
            }
        }
    }
    Write-Host "    Pre-update data snapshot: $destination ($copied files)"
    $preUpdateRoot = Join-Path $dataRoot "pre-update"
    $snapshots = @(Get-ChildItem -LiteralPath $preUpdateRoot -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending)
    foreach ($old in ($snapshots | Select-Object -Skip 3)) {
        Remove-Item -LiteralPath $old.FullName -Recurse -Force
    }
}

<#
更新前给**程序文件**拍一份可回滚的快照（RF-26 §12.5 #6）。

用户数据已有 Backup-UserData；这里管另一半：把"旧树里将被新包覆盖的程序文件"按相对
路径备份到 runtime\pre-update-files\<时间戳>\。覆盖（Copy-ProgramFiles）中途失败时用
Restore-ProgramFiles 还原这些文件——否则留下的是一棵"一半新一半旧"的树，应用起不来，
用户只能整包重装。排除规则与覆盖时完全一致（Test-Excluded），用户数据路径不会进来。
返回备份目录路径；没有会被覆盖的文件（全新目录）或 DryRun 时返回 $null。
#>
function Backup-ProgramFiles {
    param([string]$Source, [string]$Destination)
    if ($DryRun) { return $null }
    $backupRoot = Join-Path $ProjectRoot ("runtime\pre-update-files\" + (Get-Date -Format "yyyyMMdd-HHmmss"))
    $count = 0
    Get-ChildItem -LiteralPath $Source -Recurse -Force -File | ForEach-Object {
        $relative = $_.FullName.Substring($Source.Length).TrimStart("\")
        if (-not $relative -or (Test-Excluded -RelativePath $relative)) { return }
        # 只备份"将被覆盖"的文件：目标树里不存在的（新增文件）无需备份，覆盖失败时
        # 留着也无害。
        if (-not (Test-Path -LiteralPath (Join-Path $Destination $relative))) { return }
        $dest = Join-Path $backupRoot $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
        Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        $count++
    }
    if ($count -eq 0) { return $null }
    Write-Host "    Program file backup: $backupRoot ($count files)"
    # 每份备份可达几十 MB，只留最近 2 份。
    $root = Join-Path $ProjectRoot "runtime\pre-update-files"
    $stale = @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue |
        Sort-Object Name -Descending | Select-Object -Skip 2)
    foreach ($old in $stale) { Remove-Item -LiteralPath $old.FullName -Recurse -Force }
    return $backupRoot
}

<#
把程序文件备份还原回项目根。返回是否还原成功；还原本身失败时如实写日志并返回 $false
——原错误随后仍会抛给 trap 写 failed 状态，绝不谎报成功。
#>
function Restore-ProgramFiles {
    param([string]$BackupRoot)
    if (-not $BackupRoot -or -not (Test-Path -LiteralPath $BackupRoot)) { return $false }
    try {
        Get-ChildItem -LiteralPath $BackupRoot -Recurse -Force -File | ForEach-Object {
            $relative = $_.FullName.Substring($BackupRoot.Length).TrimStart("\")
            $dest = Join-Path $ProjectRoot $relative
            New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
            Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
        }
        Write-Host "    Rolled program files back from: $BackupRoot" -ForegroundColor Yellow
        return $true
    } catch {
        Write-Warning ("Rollback failed; the program files may be half-new. See runtime\update.log: " + $_.Exception.Message)
        return $false
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
        Write-Host "    data, .env, runtime, dist, .venv and node_modules would be kept." -ForegroundColor DarkGray
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
        Backup-UserData

        Write-Step "Copying program files (data, .env and runtime are kept)"
        $programBackup = Backup-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
        try {
            Copy-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
        } catch {
            # 覆盖失败：先把旧文件还原回去（还原不了也如实记录），再把错误抛给 trap
            # 写 failed 状态——绝不留下一棵"一半新一半旧"的树还装作没事。
            Restore-ProgramFiles -BackupRoot $programBackup | Out-Null
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
    Backup-UserData
    Write-Step "Copying program files (data, .env and runtime are kept)"
    $programBackup = Backup-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
    try {
        Copy-ProgramFiles -Source $extracted.FullName -Destination $ProjectRoot
    } catch {
        # 同上：覆盖失败先还原程序文件，再让错误走到 trap 写 failed 状态。
        Restore-ProgramFiles -BackupRoot $programBackup | Out-Null
        throw
    }
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
        Backup-UserData
    }

    $requirements = Join-Path $ProjectRoot "backend\requirements.txt"
    $packageJson = Join-Path $ProjectRoot "frontend\package.json"
    $nodeModules = Join-Path $ProjectRoot "frontend\node_modules"
    try {
        # 只有"没有 requirements.txt"才算没有后端依赖可装——那不是依赖问题（多半是
        # 目录根本不是我们的包）。解释器找不到**不能**算跳过：那正是桌面用户升级后
        # 缺 pypdfium2、后端起不来的原因，必须在这里失败并让用户看到提示。
        if (Test-Path $requirements) {
            $backendPython = $null
            if ($DryRun) {
                # 演练不装任何东西，所以找不到解释器也不该让它失败：用户只是想看流程，
                # 在一台什么都没装的机器上演练是合理用法。真实运行仍然照抛不误。
                try {
                    $backendPython = Resolve-BackendPython -ProjectRoot $ProjectRoot
                } catch {
                    Write-Host "    Would fail to sync backend dependencies: $($_.Exception.Message)" -ForegroundColor Yellow
                }
            } else {
                $backendPython = Resolve-BackendPython -ProjectRoot $ProjectRoot
            }
            if ($backendPython) {
                Write-Step "Syncing backend dependencies"
                Invoke-External -FilePath $backendPython -Arguments @(
                    "-m", "pip", "install", "--disable-pip-version-check", "-r", $requirements
                ) -WorkingDirectory (Join-Path $ProjectRoot "backend")
            }
        } else {
            Write-Host "    backend\requirements.txt not found; skipping the backend dependency sync."
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
    # 桌面形态下没有"用户自己双击的 start.cmd"这回事，不要教用户去点一个他看不到的东西。
    $isDesktopPayload = Test-DesktopPayload -ProjectRoot $ProjectRoot
    if ($isDesktopPayload) {
        Write-Host "Reopen the ResumeForge app. Your data was not touched." -ForegroundColor Green
    } else {
        Write-Host "Start the app again with start.cmd. Your data in data\ was not touched." -ForegroundColor Green
    }
    # 桌面形态下 `-Restart` 没有意义：`resources\payload\start.cmd` 是源码形态的启动器，
    # 拉起它等于另起一套服务（另一个端口、另一个数据目录、日志落在 payload 里），
    # 而真正该被重启的桌面窗口并不会出现。这里只提示用户重新打开应用。
    if ($Restart -and $isDesktopPayload) {
        Write-Step "Restarting ResumeForge"
        Write-Host "    桌面版请重新打开 简历通；更新文件已就位。" -ForegroundColor Yellow
    }
    if ($Restart -and -not $isDesktopPayload) {
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
    #
    # 桌面形态下没人替我们拉起新实例，`Wait-ForTargetVersion` 只会白等满 240 秒再报
    # "没等到新版本"——那明明不是失败，用户照提示重新打开应用就升级完成了。所以桌面
    # 形态按"不需要重启"处理：写 success，文案改成请用户重新打开应用。
    $shouldRestart = [bool]$Restart -and -not $isDesktopPayload
    if ($InstallId) {
        if ($shouldRestart) {
            Write-Step "Verifying the new version is running"
        }
        if (-not $shouldRestart) {
            $successMessage = if ($isDesktopPayload) {
                "文件已更新；请重新打开应用"
            } else {
                "文件已更新；双击 start.cmd 重新打开即可"
            }
            Write-InstallStatus -State "success" -Message $successMessage
        } elseif (Wait-ForTargetVersion -TimeoutSeconds $VerifyTimeoutSeconds) {
            Write-InstallStatus -State "success" -Message "已更新到 $TargetVersion"
        } else {
            Write-InstallStatus -State "failed" `
                -Message "文件已覆盖，但 $VerifyTimeoutSeconds 秒内没等到新版本起来；请查看 runtime\restart.stderr.log"
        }
    }
}
