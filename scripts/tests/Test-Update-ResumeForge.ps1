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

foreach ($required in @("Test-Excluded", "Copy-ProgramFiles", "Resolve-ExtractedPackage", "Write-InstallStatus", "Backup-UserData")) {
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
        "frontend/dist/index.html"            = $true
        ".git/config"                         = $true
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
            "frontend\node_modules\.bin"
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
            "frontend\node_modules\.bin\vite.cmd"
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
        ".env.example"
    )
    foreach ($relative in $mustBeCopied) {
        Assert-UpdaterTest -Condition (Test-Path -LiteralPath (Join-Path $destination $relative)) `
            -Message "程序文件 $relative 应当被复制过去，但没有。"
    }

    $mustNotBeCopied = @(
        "backend\data\app.db",
        "runtime\backend.json",
        ".env",
        "frontend\node_modules\.bin\vite.cmd"
    )
    foreach ($relative in $mustNotBeCopied) {
        Assert-UpdaterTest -Condition (-not (Test-Path -LiteralPath (Join-Path $destination $relative))) `
            -Message "用户数据/本地环境 $relative 绝不能被复制，但它被复制了。"
    }

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
