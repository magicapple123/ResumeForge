# SPDX-License-Identifier: Apache-2.0
# ResumeForge launcher: process probes, health checks and shared lifecycle helpers.

function Test-TcpPortInUse {
    param([int]$Port)

    return $null -ne (Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue |
            Select-Object -First 1)
}

function Invoke-LocalRequest {
    param([string]$Url)

    try {
        return Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    }
    catch {
        return $null
    }
}

function Get-ResumeForgeHealth {
    param([string]$Url)

    # Health payload 里带着 `version`，更新器正是靠它判断"新版本到底起来了没有"——
    # 所以这里返回整个对象，而不只是"健康/不健康"。
    $response = Invoke-LocalRequest "$Url/api/health"
    if ($null -eq $response -or $response.StatusCode -ne 200) {
        return $null
    }

    try {
        return ($response.Content | ConvertFrom-Json)
    }
    catch {
        return $null
    }
}

function Test-ResumeForgeBackend {
    param([string]$Url)

    $health = Get-ResumeForgeHealth -Url $Url
    if ($null -eq $health) {
        return $false
    }
    return $health.status -eq "ok"
}

function Test-ResumeForgeFrontend {
    param([string]$Url)

    # Check the proxied health route as well as the port. A different Vite project
    # can otherwise look healthy while sending ResumeForge requests to the wrong API.
    return Test-ResumeForgeBackend -Url $Url
}

function Get-ResumeForgeProcessPattern {
    param([ValidateSet("backend", "frontend")][string]$Service)

    # The command line that identifies our own process tree. It is recorded at
    # start and re-checked before anything is stopped or replaced, so PID reuse
    # can never hit an unrelated application.
    if ($Service -eq "backend") {
        return "uvicorn\s+app\.main:app"
    }
    return "npm\.cmd.*\brun\s+dev"
}

function Wait-ForCondition {
    param(
        [scriptblock]$Condition,
        [int]$TimeoutSeconds = 30,
        [AllowNull()]
        [System.Diagnostics.Process]$FailFastProcess = $null
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    do {
        if (& $Condition) {
            return $true
        }
        # A dead child will never become healthy. Report it immediately instead
        # of burning the whole timeout: a mis-quoted cmd exits in milliseconds,
        # and that failure should not look like a slow start.
        if ($null -ne $FailFastProcess) {
            try {
                if ($FailFastProcess.HasExited) {
                    return $false
                }
            }
            catch {
                # The handle can be gone; treat it as "not exited" and keep waiting.
            }
        }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)

    return $false
}

function Save-ProcessRecord {
    param(
        [System.Diagnostics.Process]$Process,
        [string]$Path
    )

    # started_at_unix is the value used to detect PID reuse: it survives a JSON
    # round trip intact, whereas an ISO string comes back from ConvertFrom-Json as
    # a DateTime that has lost its UTC designator. started_at stays for humans.
    @{
        process_id      = $Process.Id
        started_at_unix = [DateTimeOffset]::new($Process.StartTime).ToUnixTimeSeconds()
        started_at      = $Process.StartTime.ToUniversalTime().ToString("o")
    } | ConvertTo-Json | Set-Content -LiteralPath $Path -Encoding utf8
}

function Stop-StartedProcess {
    param(
        [AllowNull()]
        [System.Diagnostics.Process]$Process
    )

    if ($null -eq $Process) {
        return
    }

    # Stop-Process kills only the recorded process. For the frontend that is the
    # cmd.exe wrapper, so npm and the Vite/node child survive and keep the port
    # bound. taskkill /T walks the tree, matching what stop.cmd does.
    try {
        if ($Process.HasExited) {
            return
        }
        & taskkill.exe /PID $Process.Id /T /F | Out-Null
    }
    catch {
        Stop-Process -Id $Process.Id -Force -ErrorAction SilentlyContinue
    }
}

function Get-LogTail {
    param(
        [string]$Path,
        [int]$LineCount = 12
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }
    try {
        # The backend runs with PYTHONUTF8=1, so its log is UTF-8. Reading it with
        # the locale codec (the Windows PowerShell default) turns every non-ASCII
        # message into mojibake exactly when it is needed most.
        $lines = @(Get-Content -LiteralPath $Path -Encoding utf8 -Tail $LineCount -ErrorAction Stop)
    }
    catch {
        return @()
    }
    return @($lines | Where-Object { $null -ne $_ -and $_.Trim().Length -gt 0 })
}

function Get-ProcessExitCodeText {
    param([AllowNull()][System.Diagnostics.Process]$Process)

    if ($null -eq $Process) {
        return "unknown"
    }
    try {
        # HasExited can already be true while ExitCode is still null, which used to
        # print "exited with code  before becoming healthy".
        $exitCode = $Process.ExitCode
        if ($null -ne $exitCode) {
            return "$exitCode"
        }
    }
    catch {
        # The handle can be gone by the time the message is built.
    }
    return "unknown"
}

function Format-ServiceStartFailure {
    param(
        [string]$DisplayName,
        [string]$Reason,
        [string]$LogPath
    )

    $message = "$DisplayName $Reason. See $LogPath"
    $tail = @(Get-LogTail -Path $LogPath)
    if ($tail.Count -eq 0) {
        return "$message (it is empty)."
    }
    # Print the tail here: the person double-clicking start.cmd is usually the one
    # who cannot act on a log path, and a bare "See runtime\backend.stderr.log" is
    # what made the first report of an incomplete package impossible to diagnose.
    return "$message. Last $($tail.Count) lines:`n" + ($tail -join "`n")
}

function Get-ProcessRecordField {
    param(
        [object]$Record,
        [string]$Name
    )

    # Read through PSObject instead of member access: a hand-edited or truncated
    # record then yields $null instead of an error under Set-StrictMode.
    $property = $Record.PSObject.Properties[$Name]
    if ($null -eq $property) {
        return $null
    }
    return $property.Value
}

function Get-ProcessRecordMatch {
    param(
        [string]$RecordPath,
        [string]$CommandPattern
    )

    # Returns the recorded process when the record still describes it: same PID,
    # same start time and a matching command line. PID reuse and a stale record
    # both fail here, so nothing unrelated is ever stopped.
    if (-not (Test-Path -LiteralPath $RecordPath)) {
        return $null
    }
    try {
        $record = Get-Content -LiteralPath $RecordPath -Raw -Encoding utf8 | ConvertFrom-Json
        $processId = Get-ProcessRecordField -Record $record -Name "process_id"
        if ($null -eq $processId) {
            return $null
        }
        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -eq $process) {
            return $null
        }
        $cimProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $processId" -ErrorAction Stop
        if ($cimProcess.CommandLine -notmatch $CommandPattern) {
            return $null
        }
        $recordedAtUnix = Get-ProcessRecordField -Record $record -Name "started_at_unix"
        if ($null -ne $recordedAtUnix) {
            # Compared through Unix seconds: the record's ISO string loses its UTC
            # designator on the way back in, which used to make every comparison
            # miss by the local UTC offset.
            $recordedAt = [DateTimeOffset]::FromUnixTimeSeconds([long]$recordedAtUnix).UtcDateTime
            $startedAt = $process.StartTime.ToUniversalTime()
            if ([Math]::Abs(($startedAt - $recordedAt).TotalSeconds) -gt 2) {
                return $null
            }
        }
        else {
            # Records written before the Unix timestamp existed cannot be verified
            # by start time; the command line above still had to match.
            Write-Warning "记录文件 $RecordPath 早于启动时间校验；只按命令行匹配。"
        }
        return $process
    }
    catch {
        return $null
    }
}

<#
stop.cmd 的兜底：停止"没有启动记录、但确实是简历通"的实例。

为什么需要：start.cmd 把 PID / 命令行 / 启动时刻写进 runtime\*.json，stop.cmd 只认这份
记录。可是"记录不存在"不等于"服务没在跑"——上一轮被别的窗口或脚本直接拉起、记录文件被
清理、或者从另一份代码目录启动，都会留下一个没有记录的简历通。用户双击 stop.cmd 的预期
就是"把简历通关掉"，这时静默返回就是"stop.cmd 失效"。

安全边界（比记录校验只多不少，绝不按进程名批量杀）：
1. 进程命令行必须匹配本仓库的启动特征（后端 uvicorn app.main:app；前端 vite + --strictPort，
   该参数是启动器自己传的，普通 vite 项目默认没有）；
2. 该进程监听的端口必须自报 ResumeForge：/api/health 的 name 字段为 ResumeForge；
   前端在后端已退出（代理不可用）时，退回检查首页标题里的 ResumeForge；
3. 只按校验通过的 PID 停整棵进程树；任一条件不满足就不动。
#>
function Get-ResumeForgeFallbackCommandPattern {
    param([ValidateSet("backend", "frontend")][string]$Service)

    if ($Service -eq "backend") {
        return "uvicorn\s+app\.main:app"
    }
    # Windows 启动器用 npm.cmd 拉起 Vite 并显式传 --strictPort；监听端口的是 Vite 自己的
    # node 进程（命令行里不一定还有 npm），所以两个特征都认。
    return "([\\/]vite(\.js)?\s.*--strictPort|npm(\.cmd)?\s.*\brun\s+dev\b)"
}

function Test-ResumeForgeHealthPayload {
    param([AllowNull()][object]$Health)

    # 只看两个字段：status 必须是 ok，name 必须是 ResumeForge。别的应用即使返回 200 也
    # 不会通过这里。
    if ($null -eq $Health) {
        return $false
    }
    $status = Get-ProcessRecordField -Record $Health -Name "status"
    $name = Get-ProcessRecordField -Record $Health -Name "name"
    return ($status -eq "ok") -and ($name -eq "ResumeForge")
}

function Get-ResumeForgeProcessAncestorChain {
    param([int]$ProcessId)

    # 从监听端口的进程往上找，最多 8 层：前端监听的是 node(Vite)，记录的是 npm.cmd 包装层，
    # 停整棵树要从匹配到的最外层祖先动手，否则 Vite/esbuild 子进程会留下、端口仍被占。
    $chain = @()
    $current = $ProcessId
    for ($depth = 0; $depth -lt 8 -and $current -gt 4; $depth += 1) {
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $current" -ErrorAction SilentlyContinue
        if ($null -eq $processInfo) {
            break
        }
        $chain += $processInfo
        $current = [int]$processInfo.ParentProcessId
    }
    return $chain
}

function Test-ResumeForgeFallbackIdentity {
    param(
        [ValidateSet("backend", "frontend")][string]$Service,
        [int]$Port
    )

    $baseUrl = "http://127.0.0.1:$Port"
    if (Test-ResumeForgeHealthPayload -Health (Get-ResumeForgeHealth -Url $baseUrl)) {
        return $true
    }
    if ($Service -eq "frontend") {
        # 后端已经退出时 Vite 代理的健康检查必然失败；此时页面本身仍是简历通。
        try {
            $page = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/" -TimeoutSec 2
            if ([string]$page.Content -match "ResumeForge|简历通") {
                return $true
            }
        }
        catch {
            return $false
        }
    }
    return $false
}

function Test-ResumeForgeFallbackOwnedByProject {
    param(
        [object[]]$ProcessChain,
        [string]$ProjectRoot
    )

    # 健康检查的补充证据：进程本身（或它的父进程）来自当前项目目录。
    # 用途是停掉"刚启动、健康检查还没就绪"或"卡死到不响应健康检查"的简历通；
    # 判定很保守——可执行文件路径或命令行里出现当前项目根的绝对路径才算，
    # 另一个目录的简历通不会被误认。
    if ([string]::IsNullOrWhiteSpace($ProjectRoot) -or $null -eq $ProcessChain) {
        return $false
    }
    $normalizedRoot = $ProjectRoot.TrimEnd("\", "/").ToLowerInvariant().Replace("/", "\")
    if ($normalizedRoot.Length -lt 3) {
        return $false
    }
    foreach ($processInfo in $ProcessChain) {
        foreach ($field in @("ExecutablePath", "CommandLine")) {
            $value = [string](Get-ProcessRecordField -Record $processInfo -Name $field)
            if ([string]::IsNullOrWhiteSpace($value)) {
                continue
            }
            $normalizedValue = $value.ToLowerInvariant().Replace("/", "\")
            if ($normalizedValue.Contains($normalizedRoot)) {
                return $true
            }
        }
    }
    return $false
}

function Stop-UnrecordedResumeForgeService {
    param(
        [Parameter(Mandatory = $true)][ValidateSet("backend", "frontend")][string]$Service,
        # 只用于测试：把扫描范围收窄到指定端口，避免测试机上的其它实例被卷进来。
        [int[]]$Ports = @(),
        # 当前项目根：健康检查暂时不可用时，用"进程来自当前目录"作为补充证据。
        [string]$ProjectRoot = "",
        # 刚启动的实例可能端口已监听但健康检查还没就绪：先等一会儿再判定。
        [int]$IdentityWaitSeconds = 5
    )

    $pattern = Get-ResumeForgeFallbackCommandPattern -Service $Service
    $displayName = if ($Service -eq "backend") { "后端" } else { "前端" }
    $listeners = @()
    try {
        $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop)
    }
    catch {
        # 老系统没有 Get-NetTCPConnection：兜底不可用，交给记录的既有路径。
        return $false
    }
    if ($Ports.Count -gt 0) {
        $listeners = @($listeners | Where-Object { $Ports -contains [int]$_.LocalPort })
    }

    $seen = @{}
    $stoppedAny = $false
    foreach ($listener in $listeners) {
        $listeningProcessId = [int]$listener.OwningProcess
        $port = [int]$listener.LocalPort
        if ($listeningProcessId -le 4) {
            continue
        }
        $scanKey = "$listeningProcessId|$port"
        if ($seen.ContainsKey($scanKey)) {
            continue
        }
        $seen[$scanKey] = $true

        # 先看监听进程自己的命令行（一次 CIM 查询）；不匹配就跳过，避免对每个本地
        # 监听端口都做 8 层祖先查询（本机监听项一多，stop 会明显变慢）。
        $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $listeningProcessId" -ErrorAction SilentlyContinue
        if ($null -eq $processInfo) {
            continue
        }
        if ([string]$processInfo.CommandLine -notmatch $pattern) {
            continue
        }

        $chain = @(Get-ResumeForgeProcessAncestorChain -ProcessId $listeningProcessId)
        # 刚启动的实例端口已监听、健康检查可能还没就绪；短暂等待后再判定身份，
        # 避免用户恰好在启动的那几秒点 stop 时"什么都没发现"。
        $identity = Test-ResumeForgeFallbackIdentity -Service $Service -Port $port
        $waitSeconds = [Math]::Max(0, $IdentityWaitSeconds)
        $deadline = (Get-Date).AddSeconds($waitSeconds)
        while (-not $identity -and (Get-Date) -lt $deadline) {
            Start-Sleep -Milliseconds 500
            $identity = Test-ResumeForgeFallbackIdentity -Service $Service -Port $port
        }
        if (-not $identity) {
            # 健康检查不可用（启动中/卡死）：只有当进程确实来自当前目录时才继续。
            if (-not (Test-ResumeForgeFallbackOwnedByProject -ProcessChain $chain -ProjectRoot $ProjectRoot)) {
                continue
            }
            Write-Host "端口 $port 上的简历通暂时没有响应健康检查，但进程来自当前目录：按未记录实例停止。"
        }

        $killTarget = $listeningProcessId
        if ($Service -eq "frontend") {
            # 监听端口的是 Vite 的 node 子进程；往上找到匹配到的最外层祖先（npm / sh
            # 包装层）再整树停，否则子进程会留下、端口仍被占。
            $matched = @($chain | Where-Object { [string]$_.CommandLine -match $pattern })
            if ($matched.Count -gt 0) {
                $killTarget = [int]$matched[$matched.Count - 1].ProcessId
            }
        }
        if ($killTarget -eq $PID) {
            continue
        }
        try {
            & taskkill.exe /PID $killTarget /T /F | Out-Null
        }
        catch {
            continue
        }
        if ($LASTEXITCODE -eq 0) {
            Write-Host "已停止未记录的简历通$displayName（端口 $port，PID $killTarget；没有启动记录，按命令行与健康检查识别）。"
            $stoppedAny = $true
        }
    }
    return $stoppedAny
}

function Stop-RecordedProcess {
    param(
        [string]$DisplayName,
        [string]$RecordPath,
        [string]$CommandPattern
    )

    if (-not (Test-Path -LiteralPath $RecordPath)) {
        return "missing"
    }

    $removeRecord = $false
    try {
        $record = Get-Content -LiteralPath $RecordPath -Raw -Encoding utf8 | ConvertFrom-Json
        $processId = Get-ProcessRecordField -Record $record -Name "process_id"
        $runningProcess = if ($null -ne $processId) {
            Get-Process -Id $processId -ErrorAction SilentlyContinue
        }
        else {
            $null
        }
        if ($null -eq $runningProcess) {
            Write-Host "已清理 $DisplayName 的过期记录。"
            $removeRecord = $true
            return "not-running"
        }

        if ($null -eq (Get-ProcessRecordMatch -RecordPath $RecordPath -CommandPattern $CommandPattern)) {
            Write-Warning "没有停止 ${DisplayName}：记录与当前进程对不上（可能是上一次运行留下的）。"
            return "stale"
        }

        & taskkill.exe /PID $processId /T /F | Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "taskkill 返回了退出码 $LASTEXITCODE"
        }
        $removeRecord = $true
        Write-Host "已停止 $DisplayName。"
        return "stopped"
    }
    catch {
        Write-Warning "无法停止 ${DisplayName}：$($_.Exception.Message)"
        return "failed"
    }
    finally {
        if ($removeRecord) {
            Remove-Item -LiteralPath $RecordPath -Force -ErrorAction SilentlyContinue
        }
    }
}
