# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

<#
更新器（`scripts\Update-ResumeForge.ps1`）的守卫测试。

它此前**一处测试都没有**，而 2026-10-01 的审计在这条链路上找出四个真问题，其中两个
（`backend/app/data` 永远不更新、先覆盖再停进程）本可以靠这里的用例拦住：

1. 排除规则必须**按相对路径**判断：`backend/app/data/` 是受跟踪的程序资源（要复制），
   而 `backend/data/` 是用户数据（绝不能碰）。按"名字叫 data"判断会把前者一起跳过。
2. 覆盖程序文件之前必须先停掉正在运行的应用，否则文件锁会让复制中途失败，留下一棵
   一半新一半旧的树。
3. 解压出来的目录必须真的是我们的包（含 `start.cmd`），否则会"成功"地什么都不覆盖。
4. 更新状态必须**在解压之前**就写好：后端靠它确认更新器真的起来了，收不到就不退出应用。
#>

$ErrorActionPreference = "Stop"
# Compress-Archive / Expand-Archive 的进度条在 CI 日志里会刷满整页（还会被 2>&1 抓成
# 几千个字符），关掉它不影响任何断言。
$ProgressPreference = "SilentlyContinue"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$UpdaterPath = Join-Path $ProjectRoot "scripts\Update-ResumeForge.ps1"
$TestDirectory = Join-Path ([IO.Path]::GetTempPath()) ("resumeforge-updater-test-" + [Guid]::NewGuid().ToString("N"))

# 更新器里的函数会从调用方作用域读这些量（正常运行时来自脚本自身）。
$Repository = "magicapple123/ResumeForge"

function Assert-UpdaterTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Get-FirstCommandOffset {
    param(
        [System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [string]$Name
    )

    # 只看**函数体之外**的调用。函数定义本身也是 CommandAst 的容器：
    # `Copy-ProgramFiles` 递归调用自己，那一次在文件里排得很靠前，会把"第一次调用"
    # 定位到定义体里去，于是顺序断言看起来永远不成立。
    $functionRanges = @($Ast.FindAll({
                param($node)
                return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
            }, $true) | ForEach-Object {
            [pscustomobject]@{ Start = $_.Extent.StartOffset; End = $_.Extent.EndOffset }
        })

    $commands = @($Ast.FindAll({
                param($node)
                return $node -is [System.Management.Automation.Language.CommandAst] -and
                    $node.GetCommandName() -eq $Name
            }, $true) | Where-Object {
            $offset = $_.Extent.StartOffset
            $insideFunction = $false
            foreach ($range in $functionRanges) {
                if ($offset -ge $range.Start -and $offset -lt $range.End) {
                    $insideFunction = $true
                    break
                }
            }
            return -not $insideFunction
        })
    if ($commands.Count -eq 0) { return -1 }
    return ($commands | Sort-Object { $_.Extent.StartOffset } | Select-Object -First 1).Extent.StartOffset
}

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($UpdaterPath, [ref]$tokens, [ref]$parseErrors)
Assert-UpdaterTest -Condition ($parseErrors.Count -eq 0) -Message "更新器脚本有语法错误：$UpdaterPath"

# 把两条排除规则**原样**取出来执行，而不是在测试里另抄一份：抄一份就等于多了一个
# 事实来源，改了脚本忘了改测试时，测试会一边倒地通过。
foreach ($name in @("ExcludedAnyDepthNames", "ExcludedRootRelative")) {
    $assignment = @($ast.FindAll({
                param($node)
                return $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                    $node.Left.Extent.Text -eq "`$$name"
            }, $true)) | Select-Object -First 1
    Assert-UpdaterTest -Condition ($null -ne $assignment) -Message "更新器里找不到 `$$name 的赋值。"
    Set-Variable -Name $name -Value (Invoke-Expression $assignment.Right.Extent.Text)
}

foreach ($functionDefinition in $ast.FindAll({
            param($node)
            return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        }, $true)) {
    Invoke-Expression $functionDefinition.Extent.Text
}

foreach ($required in @("Test-Excluded", "Copy-ProgramFiles", "Resolve-ExtractedPackage", "Write-InstallStatus", "Backup-UserData", "Resolve-BackendPython", "Test-DesktopPayload")) {
    Assert-UpdaterTest -Condition ($null -ne (Get-Command $required -ErrorAction SilentlyContinue)) `
        -Message "更新器里找不到函数 $required。"
}

New-Item -ItemType Directory -Path $TestDirectory -Force | Out-Null

try {
    # ---- 1. 排除规则：按相对路径，不按名字 -------------------------------------
    # 左边是相对项目根的路径，右边是"应当被跳过吗"。
    $exclusionExpectations = [ordered]@{
        # 受跟踪的程序资源：**必须复制**。这正是本次修掉的那个 bug。
        "backend/app/data/skills.json"        = $false
        "backend/app/data/ats_keywords.json"  = $false
        # 前缀陷阱：`backend/database.py` 不属于 `backend/data`。
        "backend/database.py"                 = $false
        "backend/dataset_registry.py"         = $false
        # 用户数据与本地运行时：绝不能碰。
        "backend/data/app.db"                 = $true
        "backend/data/backups/2026.db"        = $true
        "backend/data/browser-profile/x"      = $true
        "data/legacy.txt"                     = $true
        "runtime/update-downloads/a.zip"      = $true
        "runtime/backend.json"                = $true
        # 本地环境与缓存：任何深度都跳过。
        ".env"                                = $true
        "backend/.env"                        = $true
        "frontend/node_modules/.bin/vite.cmd" = $true
        "backend/.venv/Scripts/python.exe"    = $true
        "backend/app/__pycache__/x.pyc"       = $true
        ".git/config"                         = $true
        # `frontend/dist` 是**唯一随更新包分发的前端产物**，必须复制：它曾被
        # "任意层级按名字排除 dist" 整目录跳过，升级后前端还是旧版、version.json 与
        # 后端版本对不上（2026-10-02 定位）。这里的期望以前写反了，等于把 bug 固化成
        # 正确行为——所以这三条要一起盯住。
        "frontend/dist/index.html"            = $false
        "frontend/dist/version.json"          = $false
        "frontend/dist/assets/index-abc123.js" = $false
        # 仓库根部的发布产物目录照旧不能覆盖（那些 zip/exe 是用户下载的安装包，
        # 被更新包里的旧版本盖掉就是降级）。
        "dist/ResumeForge-1.0.2.zip"          = $true
        "dist/ResumeForge-Setup-1.0.2.exe"    = $true
        # `.env` 是按整段名比的，所以这两个示例文件照样要复制。
        ".env.example"                        = $false
        "frontend/.env.demo"                  = $false
        "backend/app/main.py"                 = $false
    }

    foreach ($entry in $exclusionExpectations.GetEnumerator()) {
        $actual = [bool](Test-Excluded -RelativePath $entry.Key)
        Assert-UpdaterTest -Condition ($actual -eq $entry.Value) `
            -Message "Test-Excluded('$($entry.Key)') 应为 $($entry.Value)，实际是 $actual。"
    }

    # 大小写与分隔符都不该影响判断（Windows 与 macOS 的默认文件系统都不区分大小写）。
    Assert-UpdaterTest -Condition (Test-Excluded -RelativePath "backend\Data\App.db") `
        -Message "反斜杠与大小写不该让排除规则失效。"

    # ---- 2. 真复制一遍：程序文件进去，用户数据留在原地 ---------------------------
    $source = Join-Path $TestDirectory "source\ResumeForge-99.0.0"
    $destination = Join-Path $TestDirectory "destination"
    foreach ($relative in @(
            "backend\app\data",
            "backend\data",
            "runtime",
            "frontend\node_modules\.bin",
            "frontend\dist",
            "dist"
        )) {
        New-Item -ItemType Directory -Path (Join-Path $source $relative) -Force | Out-Null
    }
    foreach ($relative in @(
            "start.cmd",
            "backend\app\main.py",
            "backend\app\data\skills.json",
            "backend\database.py",
            "backend\data\app.db",
            "runtime\backend.json",
            ".env",
            ".env.example",
            "frontend\node_modules\.bin\vite.cmd",
            "frontend\dist\index.html",
            "frontend\dist\version.json",
            "dist\ResumeForge-1.0.2.zip"
        )) {
        Set-Content -LiteralPath (Join-Path $source $relative) -Value "x" -Encoding ascii
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    Copy-ProgramFiles -Source $source -Destination $destination

    $mustBeCopied = @(
        "start.cmd",
        "backend\app\main.py",
        "backend\app\data\skills.json",  # ← 本次修的那个：新版本的必需资源必须能到用户机器上
        "backend\database.py",
        ".env.example",
        # 前端产物：升级后界面得跟着变，否则 version.json 与后端对不上。
        "frontend\dist\index.html",
        "frontend\dist\version.json"
    )
    foreach ($relative in $mustBeCopied) {
        Assert-UpdaterTest -Condition (Test-Path -LiteralPath (Join-Path $destination $relative)) `
            -Message "程序文件 $relative 应当被复制过去，但没有。"
    }

    $mustNotBeCopied = @(
        "backend\data\app.db",
        "runtime\backend.json",
        ".env",
        "frontend\node_modules\.bin\vite.cmd",
        # 根部的发布产物不能被更新包里的旧版本盖掉。
        "dist\ResumeForge-1.0.2.zip"
    )
    foreach ($relative in $mustNotBeCopied) {
        Assert-UpdaterTest -Condition (-not (Test-Path -LiteralPath (Join-Path $destination $relative))) `
            -Message "用户数据/本地环境 $relative 绝不能被复制，但它被复制了。"
    }

    # ---- 2.5 后端解释器定位 -------------------------------------------------------
    # 桌面安装**没有** backend\.venv（用的是 %LOCALAPPDATA%\ResumeForge\runtime\python
    # 下打包的运行时），而原先只认 venv、找不到就打印"下次启动会创建"然后什么都不装。
    # 2026-10-02 的 1.0.2 就是这样：新增的 pypdfium2 是顶层 import，老用户机器上缺它，
    # uvicorn 一加载就崩，应用起不来。所以三种形态各钉一条，缺解释器必须抛错。
    function Assert-UpdaterSamePath {
        param(
            [string]$Actual,
            [string]$Expected,
            [string]$Message
        )
        $left = [IO.Path]::GetFullPath($Actual)
        $right = [IO.Path]::GetFullPath($Expected)
        Assert-UpdaterTest -Condition ($left -eq $right) -Message "$Message（期望 $right，实际 $left）"
    }

    # 假的 LOCALAPPDATA：桌面形态的运行时放这里。显式传参而不是靠 $env:LOCALAPPDATA，
    # 否则这台机器上真实存在的运行时会让用例"碰运气通过"。
    $fakeLocalAppData = Join-Path $TestDirectory "fake-localappdata"
    $fakeDesktopRuntime = Join-Path $fakeLocalAppData "ResumeForge\runtime\python"
    New-Item -ItemType Directory -Path $fakeDesktopRuntime -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $fakeDesktopRuntime "python.exe") -Value "x" -Encoding ascii

    $fakeSourceRoot = Join-Path $TestDirectory "fake-source-root"
    $fakeVenvPython = Join-Path $fakeSourceRoot "backend\.venv\Scripts\python.exe"
    New-Item -ItemType Directory -Path (Split-Path -Parent $fakeVenvPython) -Force | Out-Null
    Set-Content -LiteralPath $fakeVenvPython -Value "x" -Encoding ascii

    # 源码形态：有 venv 就用 venv——即使桌面运行时也存在（venv 才是这套代码的依赖所在）。
    $resolvedPython = Resolve-BackendPython -ProjectRoot $fakeSourceRoot -LocalAppData $fakeLocalAppData
    Assert-UpdaterSamePath -Actual $resolvedPython -Expected $fakeVenvPython `
        -Message "有 backend\.venv 时必须优先用它（而不是 LOCALAPPDATA 里的运行时）。"

    # 桌面形态：没有 venv，必须回落到 LOCALAPPDATA 下打包的运行时。
    $fakeDesktopRoot = Join-Path $TestDirectory "fake-desktop-root"
    New-Item -ItemType Directory -Path $fakeDesktopRoot -Force | Out-Null
    $resolvedPython = Resolve-BackendPython -ProjectRoot $fakeDesktopRoot -LocalAppData $fakeLocalAppData
    Assert-UpdaterSamePath -Actual $resolvedPython -Expected (Join-Path $fakeDesktopRuntime "python.exe") `
        -Message "没有 venv 时必须回落到桌面形态的打包运行时（否则依赖一行都装不上）。"

    # 便携形态兜底：项目根下自带的 python。
    $fakePortableRoot = Join-Path $TestDirectory "fake-portable-root"
    $fakePortablePython = Join-Path $fakePortableRoot "python\python.exe"
    New-Item -ItemType Directory -Path (Split-Path -Parent $fakePortablePython) -Force | Out-Null
    Set-Content -LiteralPath $fakePortablePython -Value "x" -Encoding ascii
    $emptyLocalAppData = Join-Path $TestDirectory "fake-localappdata-empty"
    New-Item -ItemType Directory -Path $emptyLocalAppData -Force | Out-Null
    $resolvedPython = Resolve-BackendPython -ProjectRoot $fakePortableRoot -LocalAppData $emptyLocalAppData
    Assert-UpdaterSamePath -Actual $resolvedPython -Expected $fakePortablePython `
        -Message "项目根下的 python\python.exe 应当作为便携形态的兜底。"

    # 一个都没有：必须抛错，**不能**静默跳过。静默跳过就是"更新成功但应用起不来"。
    $fakeBareRoot = Join-Path $TestDirectory "fake-bare-root"
    New-Item -ItemType Directory -Path $fakeBareRoot -Force | Out-Null
    $resolveThrew = $false
    $resolveMessage = ""
    try {
        Resolve-BackendPython -ProjectRoot $fakeBareRoot -LocalAppData $emptyLocalAppData | Out-Null
    }
    catch {
        $resolveThrew = $true
        $resolveMessage = $_.Exception.Message
    }
    Assert-UpdaterTest -Condition $resolveThrew `
        -Message "找不到任何解释器时必须抛错：静默跳过正是桌面用户缺依赖、后端起不来的原因。"
    Assert-UpdaterTest -Condition ($resolveMessage -match "Python 解释器") `
        -Message "解释器缺失的报错要说清原因（应含「Python 解释器」）：$resolveMessage"

    # ---- 2.6 桌面形态的重启分流 ---------------------------------------------------
    # 桌面安装里程序根是 安装目录\resources\payload，`payload\start.cmd` 是源码形态的
    # 启动器：spawn 它等于另起一套服务（另一个端口/数据目录），该被重启的桌面窗口
    # 反而不会出现。先钉住"这个目录算不算桌面形态"。
    Assert-UpdaterTest -Condition (Test-DesktopPayload -ProjectRoot "C:\Program Files\ResumeForge\resources\payload") `
        -Message "resources\payload 必须被认作桌面形态。"
    Assert-UpdaterTest -Condition (Test-DesktopPayload -ProjectRoot "C:\Users\me\AppData\Local\Programs\ResumeForge\resources\payload\") `
        -Message "带尾分隔符的 resources\payload 也必须被认作桌面形态。"
    Assert-UpdaterTest -Condition (Test-DesktopPayload -ProjectRoot "C:\ResumeForge\RESOURCES\PAYLOAD") `
        -Message "判定必须不区分大小写（Windows 默认文件系统就是这样）。"
    foreach ($notPayload in @("C:\ResumeForge", "C:\ResumeForge\resources", "C:\ResumeForge\payload", "")) {
        Assert-UpdaterTest -Condition (-not (Test-DesktopPayload -ProjectRoot $notPayload)) `
            -Message "源码形态（'$notPayload'）不能被误判成桌面形态，否则 -Restart 会被跳过。"
    }

    # ---- 2.7 端到端：桌面形态下 -Restart 绝不 spawn payload\start.cmd --------------
    # 函数级用例只能证明"这个目录会被认作桌面形态"，证明不了调用点真的照它走。
    # 这里在临时目录里搭一棵假的桌面 payload（`<app>\resources\payload`），拿一个
    # 只含 start.cmd 的真 zip 走完整个 -ArchivePath 分支，再检查 start.cmd 有没有被执行。
    # 全程只碰 $env:TEMP，不下载、不装依赖（-SkipDependencies）。
    $desktopPayload = Join-Path $TestDirectory "desktop-app\resources\payload"
    New-Item -ItemType Directory -Path $desktopPayload -Force | Out-Null
    # 更新器运行时要 dot-source 同目录的 ResumeForge.Common.ps1，所以把 scripts 整份拷过去。
    Copy-Item -LiteralPath (Split-Path -Parent $UpdaterPath) `
        -Destination (Join-Path $desktopPayload "scripts") -Recurse -Force
    $desktopUpdater = Join-Path $desktopPayload "scripts\Update-ResumeForge.ps1"
    $spawnMarker = Join-Path $desktopPayload "spawned.txt"
    $packageBuild = Join-Path $TestDirectory "package-build\ResumeForge-99.0.0"
    New-Item -ItemType Directory -Path $packageBuild -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $packageBuild "start.cmd") -Encoding ascii -Value @"
@echo off
echo spawned>"$spawnMarker"
"@
    Set-Content -LiteralPath (Join-Path $packageBuild "app-marker.txt") -Value "new" -Encoding ascii
    $payloadZip = Join-Path $TestDirectory "update-package.zip"
    Compress-Archive -LiteralPath $packageBuild -DestinationPath $payloadZip -Force

    # 用 Start-Process + 重定向而不是 `&`：子进程里 Expand-Archive 的进度条会直接写到
    # 控制台，把 CI 日志刷满；重定向到文件既收得干净，失败时也还能把内容贴进断言消息。
    $desktopStdout = Join-Path $TestDirectory "desktop-update.stdout.log"
    $desktopStderr = Join-Path $TestDirectory "desktop-update.stderr.log"
    $desktopProcess = Start-Process -FilePath "powershell" -PassThru -Wait -WindowStyle Hidden `
        -ArgumentList @(
            "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$desktopUpdater`"",
            "-ArchivePath", "`"$payloadZip`"", "-SkipDependencies", "-Restart",
            "-InstallId", "test-desktop-install", "-TargetVersion", "99.0.0"
        ) `
        -RedirectStandardOutput $desktopStdout -RedirectStandardError $desktopStderr
    $desktopOutput = @(
        (Get-Content -LiteralPath $desktopStdout -Raw -ErrorAction SilentlyContinue),
        (Get-Content -LiteralPath $desktopStderr -Raw -ErrorAction SilentlyContinue)
    )
    $desktopExit = $desktopProcess.ExitCode
    Assert-UpdaterTest -Condition ($desktopExit -eq 0) `
        -Message "桌面形态的更新必须能跑通（退出码 $desktopExit）：$($desktopOutput -join ' / ')"
    # 先证明它真的走到了覆盖那一步，否则下面那条"没 spawn"会平凡通过。
    Assert-UpdaterTest -Condition (Test-Path -LiteralPath (Join-Path $desktopPayload "app-marker.txt")) `
        -Message "更新包里的程序文件应当被复制到桌面 payload 根（否则这条用例没验到东西）。"
    Assert-UpdaterTest -Condition (-not (Test-Path -LiteralPath $spawnMarker)) `
        -Message "桌面形态下绝不能 spawn payload\start.cmd：那是源码形态的启动器，等于另起一套服务。"
    $desktopStatusPath = Join-Path $desktopPayload "runtime\update-status.json"
    Assert-UpdaterTest -Condition (Test-Path -LiteralPath $desktopStatusPath) `
        -Message "桌面形态的更新也要写状态文件（应用靠它告诉用户重开）。"
    $desktopStatus = Get-Content -LiteralPath $desktopStatusPath -Raw -Encoding utf8 | ConvertFrom-Json
    Assert-UpdaterTest -Condition ($desktopStatus.state -eq "success") `
        -Message "桌面形态没人替我们拉起新实例，状态应当是 success（实际 $($desktopStatus.state)）。"
    Assert-UpdaterTest -Condition ([string]$desktopStatus.message -match "重新打开应用") `
        -Message "桌面形态的提示必须让用户重新打开应用（实际：$($desktopStatus.message)）。"

    # ---- 3. 解压出来的必须是我们的包 -------------------------------------------
    $notAPackage = Join-Path $TestDirectory "staging-not-a-package\__MACOSX"
    New-Item -ItemType Directory -Path $notAPackage -Force | Out-Null
    $threw = $false
    try {
        Resolve-ExtractedPackage -Staging (Split-Path -Parent $notAPackage) | Out-Null
    }
    catch {
        $threw = $true
    }
    Assert-UpdaterTest -Condition $threw -Message "解压目录里没有 start.cmd 时必须报错，不能当成更新包。"

    $realPackage = Join-Path $TestDirectory "staging-package\ResumeForge-99.0.0"
    New-Item -ItemType Directory -Path $realPackage -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $realPackage "start.cmd") -Value "@echo off" -Encoding ascii
    $resolved = Resolve-ExtractedPackage -Staging (Split-Path -Parent $realPackage)
    Assert-UpdaterTest -Condition ($resolved.Name -eq "ResumeForge-99.0.0") `
        -Message "含 start.cmd 的目录应当被认作更新包。"

    # ---- 3.5 更新前数据快照 -----------------------------------------------------
    # 三条覆盖路径都会先停应用再快照：SQLite 干净退出后直接拷文件就是一致快照。
    # 只拷 .db 与旁文件（-wal / -shm / -journal）、轻量 json 指针；保留最近 3 份，
    # 最旧的轮转删除。快照按真实数据布局铺在 backend/data/（backend/app/config.py
    # 的 DATA_DIR）——此前测试自造假根 <root>/data，与实现一起错了三年没人报警。
    $realProjectRoot = $ProjectRoot
    $realDryRun = $DryRun
    $ProjectRoot = Join-Path $TestDirectory "fake-root"
    $DryRun = $false
    $fakeDataRoot = Join-Path $ProjectRoot "backend\data"
    New-Item -ItemType Directory -Path (Join-Path $fakeDataRoot "datasets") -Force | Out-Null
    foreach ($name in @(
            "resume_forge.db", "resume_forge.db-wal", "resume_forge.db-shm", "resume_forge.db-journal",
            "active.json"
        )) {
        Set-Content -LiteralPath (Join-Path $fakeDataRoot $name) -Value "x" -Encoding ascii
    }
    Set-Content -LiteralPath (Join-Path $fakeDataRoot "datasets\extra.db") -Value "x" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $fakeDataRoot "datasets\extra.db-wal") -Value "x" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $fakeDataRoot "datasets\extra.db-journal") -Value "x" -Encoding ascii

    Backup-UserData
    $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $fakeDataRoot "pre-update") -Directory)
    Assert-UpdaterTest -Condition ($snapshots.Count -eq 1) `
        -Message "第一次快照应当恰好生成一份 pre-update 目录（实际 $($snapshots.Count)）。"
    foreach ($relative in @(
            "resume_forge.db", "resume_forge.db-wal", "resume_forge.db-shm", "resume_forge.db-journal",
            "active.json", "datasets\extra.db", "datasets\extra.db-wal", "datasets\extra.db-journal"
        )) {
        Assert-UpdaterTest -Condition (Test-Path -LiteralPath (Join-Path $snapshots[0].FullName $relative)) `
            -Message "数据快照必须包含 $relative。"
    }

    # 再铺 3 份旧快照：下一次快照后只保留最近 3 份，最旧的被轮转删除。
    foreach ($index in 1..3) {
        New-Item -ItemType Directory -Path (Join-Path $fakeDataRoot ("pre-update\2026010" + $index + "-000000")) -Force | Out-Null
    }
    Backup-UserData
    $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $fakeDataRoot "pre-update") -Directory)
    Assert-UpdaterTest -Condition ($snapshots.Count -eq 3) `
        -Message "快照轮转后应当只保留 3 份（实际 $($snapshots.Count)）。"
    Assert-UpdaterTest -Condition (-not (Test-Path -LiteralPath (Join-Path $fakeDataRoot "pre-update\20260101-000000"))) `
        -Message "最旧的快照应当被轮转删除。"

    # 演练模式绝不写快照。
    $DryRun = $true
    Backup-UserData
    $snapshots = @(Get-ChildItem -LiteralPath (Join-Path $fakeDataRoot "pre-update") -Directory)
    Assert-UpdaterTest -Condition ($snapshots.Count -eq 3) -Message "DryRun 下不该再生成快照。"
    $DryRun = $realDryRun
    $ProjectRoot = $realProjectRoot

    # ---- 4. 顺序不变量（源码级） -----------------------------------------------
    # 先停应用再覆盖程序文件：反过来的话文件锁会让复制中途失败。
    $stopOffset = Get-FirstCommandOffset -Ast $ast -Name "Stop-RunningApplication"
    $copyOffset = Get-FirstCommandOffset -Ast $ast -Name "Copy-ProgramFiles"
    Assert-UpdaterTest -Condition ($stopOffset -ge 0 -and $copyOffset -ge 0) `
        -Message "更新器里找不到 Stop-RunningApplication / Copy-ProgramFiles 的调用。"
    Assert-UpdaterTest -Condition ($stopOffset -lt $copyOffset) `
        -Message "覆盖程序文件之前必须先停掉正在运行的应用（现在是先复制后停）。"

    # 数据快照必须落在覆盖程序文件之前：它是"新版本迁移弄坏数据"时的最后一道保险。
    $backupOffset = Get-FirstCommandOffset -Ast $ast -Name "Backup-UserData"
    Assert-UpdaterTest -Condition ($backupOffset -ge 0) `
        -Message "更新器里找不到 Backup-UserData 的调用。"
    Assert-UpdaterTest -Condition ($backupOffset -lt $copyOffset) `
        -Message "覆盖程序文件之前必须先拍数据快照（现在 Copy-ProgramFiles 在 Backup-UserData 之前）。"

    # 状态文件要在解压之前写好：后端轮询它确认更新器起来了，收不到就不退出应用。
    $statusOffset = Get-FirstCommandOffset -Ast $ast -Name "Write-InstallStatus"
    $extractOffset = Get-FirstCommandOffset -Ast $ast -Name "Expand-Archive"
    Assert-UpdaterTest -Condition ($statusOffset -ge 0 -and $extractOffset -ge 0) `
        -Message "更新器里找不到 Write-InstallStatus / Expand-Archive 的调用。"
    Assert-UpdaterTest -Condition ($statusOffset -lt $extractOffset) `
        -Message "更新状态必须在解压之前写，否则后端等不到握手就不退出。"

    # ---- 5. 状态文件内容 --------------------------------------------------------
    $StatusPath = Join-Path $TestDirectory "runtime\update-status.json"
    $InstallId = "test-install-id"
    $TargetVersion = "99.0.0"
    $script:FromVersion = "0.14.2"
    $script:InstallStartedAt = 1759276800
    $Restart = $true

    Write-InstallStatus -State "installing" -Message "正在覆盖程序文件"

    $payload = Get-Content -LiteralPath $StatusPath -Raw -Encoding utf8 | ConvertFrom-Json
    Assert-UpdaterTest -Condition ($payload.install_id -eq $InstallId) -Message "状态文件里必须带 install_id（后端靠它握手）。"
    Assert-UpdaterTest -Condition ($payload.state -eq "installing") -Message "状态文件的 state 不对。"
    Assert-UpdaterTest -Condition ($payload.target_version -eq $TargetVersion) -Message "状态文件里必须带目标版本。"
    Assert-UpdaterTest -Condition ($payload.from_version -eq "0.14.2") -Message "状态文件里必须带原版本。"
    Assert-UpdaterTest -Condition ($payload.restart -eq $true) -Message "状态文件里必须记录是否要重启。"

    # 手动双击 update.cmd 时没有 install_id，不该凭空写出一个状态文件。
    Remove-Item -LiteralPath $StatusPath -Force
    $InstallId = ""
    Write-InstallStatus -State "installing"
    Assert-UpdaterTest -Condition (-not (Test-Path -LiteralPath $StatusPath)) `
        -Message "没有 -InstallId 时不该写状态文件（手动更新不需要握手）。"

    # ---- 6. 干跑一遍：脚本主体必须能从头走到尾 -----------------------------------
    # 这一条是升级彩排逼出来的。`$FromVersion = Get-InstalledVersion` 曾经写在文件顶部，
    # 而那个函数定义在后面——PowerShell 从上往下执行，于是脚本一上来就死在"无法将
    # Get-InstalledVersion 识别为 cmdlet"，连 trap 里那句也一起失效（它同样调用了还没定义
    # 的函数），用户拿到的是一条与真实故障无关的报错。
    #
    # 上面那些用例**看不见这种错**：它们是按 AST 把函数逐个取出来执行的，从来没有真正
    # 从头跑一遍这个脚本。`-DryRun` 不下载、不解压、不复制、也不写状态文件，所以对着
    # 真实仓库跑是安全的；单独起一个进程还能避免它把 $ErrorActionPreference 之类带进来。
    $dryRunOutput = & powershell -NoProfile -ExecutionPolicy Bypass -File $UpdaterPath -DryRun 2>&1
    $dryRunExit = $LASTEXITCODE
    Assert-UpdaterTest -Condition ($dryRunExit -eq 0) `
        -Message "更新器 -DryRun 必须能跑通（退出码 $dryRunExit）：$($dryRunOutput -join ' / ')"
    Assert-UpdaterTest -Condition (($dryRunOutput -join "`n") -notmatch "无法将|not recognized") `
        -Message "更新器 -DryRun 的输出里有「命令找不到」字样，多半又有函数在定义之前被调用了：$($dryRunOutput -join ' / ')"

    Write-Host "Windows updater tests passed."
}
finally {
    if (Test-Path -LiteralPath $TestDirectory) {
        Remove-Item -LiteralPath $TestDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
}
