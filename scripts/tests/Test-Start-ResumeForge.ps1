# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LauncherPath = Join-Path $ProjectRoot "scripts\Start-ResumeForge.ps1"
$RuntimeDirectory = Join-Path ([IO.Path]::GetTempPath()) ("resumeforge-launcher-test-" + [Guid]::NewGuid().ToString("N"))
$MinimumNodeVersion = [Version]"20.19.0"
$NodeBootstrapVersion = "24.19.0"
$NodeBootstrapX64Url = "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-x64.zip"
$NodeBootstrapX64Sha256 = "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73"
$NodeBootstrapArm64Url = "https://nodejs.org/dist/v24.19.0/node-v24.19.0-win-arm64.zip"
$NodeBootstrapArm64Sha256 = "8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f"
$NodeToolsDirectory = Join-Path $RuntimeDirectory "tools"
# Mirrors of the constants the launcher defines. The functions loaded below read
# these from the caller's scope, and the assertions further down pin the
# launcher's own copies so the two cannot drift.
$MinimumPythonVersion = [Version]"3.11"
$MaximumPythonVersion = [Version]"3.13"
$PythonVersionProbe = 'import sys; raise SystemExit(0 if ({0}, {1}) <= sys.version_info[:2] <= ({2}, {3}) else 1)' -f `
    $MinimumPythonVersion.Major, $MinimumPythonVersion.Minor, `
    $MaximumPythonVersion.Major, $MaximumPythonVersion.Minor
$PythonSupportedSelectors = @("-3.12", "-3.13", "-3.11")
$BackendStartTimeoutSeconds = 90
$FrontendStartTimeoutSeconds = 120
$NodeBootstrapMirrorBaseUrls = @(
    "https://mirrors.huaweicloud.com/nodejs",
    "https://cdn.npmmirror.com/binaries/node",
    "https://mirrors.cloud.tencent.com/nodejs-release"
)
$NodeDownloadAttemptTimeoutSeconds = 600
$NodeDownloadTotalBudgetSeconds = 1800

function Assert-LauncherTest {
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
        Write-Warning "Could not move launcher test data to the recycle bin; leaving it in place: $($_.Exception.Message)"
    }
}

$tokens = $null
$parseErrors = $null
$launcherAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $LauncherPath,
    [ref]$tokens,
    [ref]$parseErrors
)
Assert-LauncherTest -Condition ($parseErrors.Count -eq 0) -Message "The launcher has PowerShell syntax errors."
$launcherContent = Get-Content -LiteralPath $LauncherPath -Raw -Encoding utf8
foreach ($requiredSetting in @(
        '$MinimumNodeVersion = [Version]"20.19.0"',
        '$NodeBootstrapVersion = "24.19.0"',
        '$NodeBootstrapX64Sha256 = "57f71ab3652e797d84acddc79c81cc9ff1c6ddb2a1974cdb83f00fee9bff4c73"',
        '$NodeBootstrapArm64Sha256 = "8502f4a50b458d4cc38ed8f2001556c2cd239d464920f74017926ccb1e1c157f"',
        '$MinimumPythonVersion = [Version]"3.11"',
        '$MaximumPythonVersion = [Version]"3.13"',
        '$BackendStartTimeoutSeconds = 90',
        '$FrontendStartTimeoutSeconds = 120',
        '$NodeDownloadTotalBudgetSeconds = 1800'
    )) {
    Assert-LauncherTest `
        -Condition $launcherContent.Contains($requiredSetting) `
        -Message "The launcher bootstrap setting is missing or unexpected: $requiredSetting"
}

# UTF-8 mode must be on before the launcher does any work, because pip 24.x
# decodes a BOM-less requirements file with the locale codec.
#
# The call is matched as a *statement* (any leading whitespace) rather than as
# "a newline immediately followed by Start-ResumeForge": the entry point wraps
# the call in try/catch so a failure prints one clean paragraph instead of a
# PowerShell error record, and that indents the line. Pinning the indentation
# here would make "add a wrapper" look like "removed the call".
$utf8Index = $launcherContent.IndexOf('$env:PYTHONUTF8')
$startCallMatch = [regex]::Match($launcherContent, '(?m)^[ \t]*Start-ResumeForge[ \t]*$')
$startCallIndex = if ($startCallMatch.Success) { $startCallMatch.Index } else { -1 }
Assert-LauncherTest `
    -Condition ($utf8Index -ge 0 -and $startCallIndex -gt $utf8Index) `
    -Message "The launcher must set PYTHONUTF8 before it starts doing work (and must still call Start-ResumeForge), so venv creation, pip and uvicorn all inherit it."

# This is the test that would have caught the GBK failure: CI runs under a UTF-8
# locale, so nothing there ever reproduces it.
foreach ($asciiOnlyName in @("requirements.txt", "requirements-dev.txt")) {
    $asciiOnlyPath = Join-Path $ProjectRoot "backend\$asciiOnlyName"
    $nonAsciiCount = @([IO.File]::ReadAllBytes($asciiOnlyPath) | Where-Object { $_ -gt 0x7F }).Count
    Assert-LauncherTest `
        -Condition ($nonAsciiCount -eq 0) `
        -Message "$asciiOnlyName must stay pure ASCII: pip decodes it with the locale codec (cp936 on Chinese Windows) when the file has no BOM."
}

# A launcher script that contains any non-ASCII byte MUST carry a UTF-8 BOM.
#
# This is the rule behind "keep the launcher pure ASCII": Windows PowerShell 5.1
# (which is what start.cmd invokes) decodes a BOM-less file with the ANSI code
# page, so on a Chinese Windows the UTF-8 bytes of a Chinese string are read as
# GBK. Comments then turn into mojibake, and **strings break the parse outright**
# - measured: dropping the BOM from ResumeForge.Process.ps1 makes PS 5.1 report
# 33 syntax errors. A BOM makes 5.1 read the file as UTF-8 and everything works.
#
# So the invariant is not "ASCII only" but "non-ASCII implies BOM". Checking the
# bytes catches what a syntax check cannot: PowerShell 7 parses a BOM-less file
# perfectly, so this defect is invisible to every pwsh-based check and to CI.
#
# Recurse: `scripts/tests/*.ps1` are invoked by pwsh in CI rather than by
# start.cmd, so today they are lower risk, but they are still PowerShell files
# maintained in this repo and a Chinese comment added without a BOM would land
# silently. Sweeping them costs nothing. Measured 2026-09-22: Build-Demo.ps1 was
# the only offender (2316 non-ASCII bytes, no BOM) and this check is what caught
# it - but only after a push, because the local run predated the stray edit.
$launcherSources = @(Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts") -Filter "*.ps1" -File -Recurse)
foreach ($source in $launcherSources) {
    $bytes = [IO.File]::ReadAllBytes($source.FullName)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    $nonAscii = @($bytes | Where-Object { $_ -gt 0x7F }).Count
    Assert-LauncherTest `
        -Condition ($nonAscii -eq 0 -or $hasBom) `
        -Message "$($source.Name) contains $nonAscii non-ASCII byte(s) but has no UTF-8 BOM: PowerShell 5.1 (what start.cmd runs) would decode it with the ANSI code page and fail to parse. Add a BOM, or keep the file pure ASCII."
    # The BOM itself is not ASCII, so it must not be the only reason the check above passes.
    Assert-LauncherTest `
        -Condition ($nonAscii -eq 0 -or $nonAscii -gt 3) `
        -Message "$($source.Name) looks like a BOM-only file."
}

# Shell scripts obey the opposite rule from PowerShell files: they must be plain
# LF and must not carry a BOM. A single CR makes the kernel read the interpreter
# as "/bin/bash\r", so macOS answers "bad interpreter" and the launcher never
# runs -- while looking completely fine on Windows. That asymmetry is why this
# check exists next to the BOM one: the machine most likely to introduce CRLF is
# the one where nothing breaks.
$shellScriptPaths = @(
    Get-ChildItem -LiteralPath $ProjectRoot -Filter "*.command" -File
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts") -Filter "*.sh" -File -Recurse
)
Assert-LauncherTest `
    -Condition ($shellScriptPaths.Count -ge 4) `
    -Message "Expected to find the macOS entry points and shell libraries (found $($shellScriptPaths.Count))."
foreach ($shellScript in $shellScriptPaths) {
    $shellBytes = [IO.File]::ReadAllBytes($shellScript.FullName)
    $hasCarriageReturn = $false
    foreach ($shellByte in $shellBytes) {
        if ($shellByte -eq 0x0D) { $hasCarriageReturn = $true; break }
    }
    Assert-LauncherTest `
        -Condition (-not $hasCarriageReturn) `
        -Message "$($shellScript.Name) contains a CR byte. Shell scripts must be pure LF: on macOS a CRLF shebang fails with 'bad interpreter', and Windows cannot see the difference."
    $hasShellBom = $shellBytes.Length -ge 3 -and $shellBytes[0] -eq 0xEF -and $shellBytes[1] -eq 0xBB -and $shellBytes[2] -eq 0xBF
    Assert-LauncherTest `
        -Condition (-not $hasShellBom) `
        -Message "$($shellScript.Name) starts with a UTF-8 BOM. A BOM before the shebang breaks execution on macOS and Linux; shell scripts must stay BOM-less."
}

# start.cmd must forward its arguments; the launcher's own port-conflict message
# tells the user to pass -BackendPort, which is impossible without this.
$startCmdContent = Get-Content -LiteralPath (Join-Path $ProjectRoot "start.cmd") -Raw
Assert-LauncherTest `
    -Condition ($startCmdContent -match 'Start-ResumeForge\.ps1"\s+%\*') `
    -Message "start.cmd must forward its arguments with %*."

# Load function definitions without executing the launcher's service startup.
# Helpers now live in focused dot-sourced modules; parse each module directly so
# this characterization test remains independent from network/process startup.
$launcherScriptPaths = @($LauncherPath) + @(
    Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "scripts") -Filter "ResumeForge.*.ps1" -File |
        Select-Object -ExpandProperty FullName
)
$functionDefinitions = @()
foreach ($scriptPath in $launcherScriptPaths) {
    $scriptTokens = $null
    $scriptErrors = $null
    $scriptAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $scriptPath,
        [ref]$scriptTokens,
        [ref]$scriptErrors
    )
    Assert-LauncherTest `
        -Condition ($scriptErrors.Count -eq 0) `
        -Message "Launcher module has PowerShell syntax errors: $scriptPath"
    $functionDefinitions += $scriptAst.FindAll(
        {
            param($node)
            return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        },
        $true
    )
}
foreach ($functionDefinition in $functionDefinitions) {
    Invoke-Expression $functionDefinition.Extent.Text
}

New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null
$oldNodePath = Join-Path $RuntimeDirectory "node-old.cmd"
$minimumNodePath = Join-Path $RuntimeDirectory "node-minimum.cmd"
$mockNpmPath = Join-Path $RuntimeDirectory "npm.cmd"
Set-Content -LiteralPath $oldNodePath -Value "@echo v20.18.0" -Encoding ascii
Set-Content -LiteralPath $minimumNodePath -Value "@echo v20.19.0" -Encoding ascii
Set-Content -LiteralPath $mockNpmPath -Value "@echo 11.0.0" -Encoding ascii

try {
    Assert-LauncherTest `
        -Condition (-not (Test-NodeRuntimeCandidate -NodePath $oldNodePath -NpmPath $mockNpmPath)) `
        -Message "Node.js below 20.19.0 must be rejected."

    Assert-LauncherTest `
        -Condition (Test-NodeRuntimeCandidate -NodePath $minimumNodePath -NpmPath $mockNpmPath) `
        -Message "Node.js 20.19.0 with npm must be accepted."

    function Get-WindowsArchitecture { return "AMD64" }
    $x64Package = Get-NodeBootstrapPackage
    Assert-LauncherTest `
        -Condition ($x64Package.Architecture -eq "x64" -and $x64Package.Sha256 -eq $NodeBootstrapX64Sha256) `
        -Message "The x64 Node.js bootstrap package is incorrect."

    function Get-WindowsArchitecture { return "ARM64" }
    $arm64Package = Get-NodeBootstrapPackage
    Assert-LauncherTest `
        -Condition ($arm64Package.Architecture -eq "arm64" -and $arm64Package.Sha256 -eq $NodeBootstrapArm64Sha256) `
        -Message "The ARM64 Node.js bootstrap package is incorrect."

    $script:wingetCalled = $false
    function Refresh-ProcessPath {}
    function Find-SystemNodeRuntime {
        return [pscustomobject]@{
            NodePath = "existing-node.exe"
            NpmPath  = "existing-npm.cmd"
            Version  = [Version]"24.19.0"
        }
    }
    function Try-InstallNodeWithWinget {
        $script:wingetCalled = $true
        return $true
    }
    $existingRuntime = Ensure-NodeRuntime
    Assert-LauncherTest `
        -Condition ($existingRuntime.NodePath -eq "existing-node.exe" -and -not $script:wingetCalled) `
        -Message "An existing compatible Node.js runtime must be reused without installation."

    $script:portableInstalled = $false
    function Find-SystemNodeRuntime {
        if (-not $script:portableInstalled) {
            return $null
        }
        return [pscustomobject]@{
            NodePath = "portable-node.exe"
            NpmPath  = "portable-npm.cmd"
            Version  = [Version]"24.19.0"
        }
    }
    function Try-InstallNodeWithWinget { return $false }
    function Install-PortableNodeRuntime { $script:portableInstalled = $true }
    $portableRuntime = Ensure-NodeRuntime
    Assert-LauncherTest `
        -Condition ($portableRuntime.NodePath -eq "portable-node.exe" -and $script:portableInstalled) `
        -Message "A missing Node.js runtime must use the portable fallback when winget is unavailable."

    # --- Python version window and interpreter selection ---

    # A venv built outside the window can never install the pins, so it must not
    # be reused. Driven by a crafted pyvenv.cfg, so no interpreter is needed.
    $staleVenvConfig = Join-Path $RuntimeDirectory "pyvenv-314.cfg"
    Set-Content -LiteralPath $staleVenvConfig -Encoding ascii -Value @("home = C:\Python314", "version = 3.14.7")
    Assert-LauncherTest `
        -Condition (-not (Test-VenvVersionSupported -ConfigPath $staleVenvConfig)) `
        -Message "A virtual environment built by Python 3.14 must be treated as unusable."
    Set-Content -LiteralPath $staleVenvConfig -Encoding ascii -Value @("home = D:\Python\Python312", "version = 3.12.2")
    Assert-LauncherTest `
        -Condition (Test-VenvVersionSupported -ConfigPath $staleVenvConfig) `
        -Message "A Python 3.12 virtual environment must be reusable."
    Set-Content -LiteralPath $staleVenvConfig -Encoding ascii -Value @("home = C:\Python313")
    Assert-LauncherTest `
        -Condition (-not (Test-VenvVersionSupported -ConfigPath $staleVenvConfig)) `
        -Message "A pyvenv.cfg without a version line must be treated as unusable."

    # The probe must agree with whatever interpreter runs it.
    $hostPython = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($null -ne $hostPython -and $hostPython.Source -notmatch "\\WindowsApps\\") {
        $reportedVersion = & $hostPython.Source -c "import sys; print('%d.%d' % sys.version_info[:2])"
        & $hostPython.Source -c $PythonVersionProbe *> $null
        $expectedAccepted = $reportedVersion -in @("3.11", "3.12", "3.13")
        Assert-LauncherTest `
            -Condition (($LASTEXITCODE -eq 0) -eq $expectedAccepted) `
            -Message "The Python version probe disagrees with the interpreter it ran on ($reportedVersion)."
    }

    $script:probedSelectors = @()
    function Get-Command {
        param($Name, $ErrorAction)
        if ($Name -eq "py.exe") { return [pscustomobject]@{ Source = "C:\Windows\py.exe" } }
        return $null
    }
    function Test-PythonCandidate {
        param([string]$Path, [string[]]$PrefixArguments = @())
        $selector = ($PrefixArguments -join " ")
        $script:probedSelectors += $selector
        return $selector -eq "-3.12"
    }
    $selectedPython = Find-SystemPython
    Assert-LauncherTest `
        -Condition (($selectedPython.PrefixArguments -join " ") -eq "-3.12") `
        -Message "A supported interpreter must be selected from the launcher."
    Assert-LauncherTest `
        -Condition ($script:probedSelectors[0] -eq "-3.12" -and $script:probedSelectors.Count -eq 1) `
        -Message "Probing must start at 3.12 and stop at the first supported runtime."

    # --- launching npm.cmd from a path that contains spaces ---

    # The frontend used to go through a hand-written "cmd /s /c ""<path>" args"
    # line. Start-Process joins -ArgumentList with spaces and adds no quoting
    # while cmd /s /c strips the outer quotes, so a Node install under
    # "C:\Program Files\nodejs" (the official MSI default) never started. The
    # launcher now hands npm.cmd to Start-Process directly and lets PowerShell
    # build the cmd.exe wrapper, so this runs the same shape against a stub in a
    # directory with a space in its name.
    $spacedDirectory = Join-Path $RuntimeDirectory "program files node"
    New-Item -ItemType Directory -Path $spacedDirectory -Force | Out-Null
    $stubNpmPath = Join-Path $spacedDirectory "npm.cmd"
    $stubMarkerPath = Join-Path $RuntimeDirectory "stub-arguments.txt"
    Set-Content -LiteralPath $stubNpmPath -Encoding ascii -Value @(
        "@echo off",
        "echo %* > `"$stubMarkerPath`"",
        "exit /b 0"
    )

    $stubOutputPath = Join-Path $RuntimeDirectory "stub.stdout.log"
    $stubErrorPath = Join-Path $RuntimeDirectory "stub.stderr.log"
    $spacedProcess = Start-Process -FilePath $stubNpmPath `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "5173", "--strictPort") `
        -WorkingDirectory $RuntimeDirectory -WindowStyle Hidden -Wait -PassThru `
        -RedirectStandardOutput $stubOutputPath -RedirectStandardError $stubErrorPath
    Assert-LauncherTest `
        -Condition ($spacedProcess.ExitCode -eq 0) `
        -Message "npm.cmd could not be started from a path containing a space (exit $($spacedProcess.ExitCode))."
    Assert-LauncherTest `
        -Condition (Test-Path -LiteralPath $stubMarkerPath) `
        -Message "The npm.cmd stub never ran, so the command line was misparsed."
    Assert-LauncherTest `
        -Condition ((Get-Content -LiteralPath $stubMarkerPath -Raw) -match "run dev -- --host 127\.0\.0\.1 --port 5173 --strictPort") `
        -Message "Arguments were mangled on the way to npm.cmd."

    # stop.cmd finds the frontend by matching the recorded command line, so the
    # wrapper PowerShell builds must still contain the npm.cmd invocation. Use
    # the same spaced npm.cmd stub, kept alive long enough to be inspected, and
    # stop it before asserting so a failure cannot strand the process tree.
    Set-Content -LiteralPath $stubNpmPath -Encoding ascii -Value @("@echo off", "ping -n 60 127.0.0.1 > nul")
    $longStubProcess = Start-Process -FilePath $stubNpmPath -ArgumentList @("run", "dev") `
        -WorkingDirectory $RuntimeDirectory -WindowStyle Hidden -PassThru `
        -RedirectStandardOutput (Join-Path $RuntimeDirectory "tree.stdout.log") `
        -RedirectStandardError (Join-Path $RuntimeDirectory "tree.stderr.log")
    Start-Sleep -Seconds 2
    $stubRecord = Get-CimInstance Win32_Process -Filter "ProcessId = $($longStubProcess.Id)"
    $stubProcessName = $stubRecord.Name
    $stubCommandLine = $stubRecord.CommandLine
    Stop-StartedProcess -Process $longStubProcess
    Start-Sleep -Milliseconds 800

    Assert-LauncherTest `
        -Condition ($stubProcessName -eq "cmd.exe") `
        -Message "The recorded frontend process must stay cmd.exe, or stop.cmd will not recognise it."
    Assert-LauncherTest `
        -Condition ($stubCommandLine -match "npm\.cmd.*\brun\s+dev") `
        -Message "stop.cmd identifies the frontend by matching its command line; that match broke."

    # --- Node download candidates ---

    function Get-WindowsArchitecture { return "AMD64" }
    $x64Package = Get-NodeBootstrapPackage
    Assert-LauncherTest `
        -Condition ($x64Package.Urls.Count -ge 2) `
        -Message "A mirror list plus the official fallback is expected."
    Assert-LauncherTest `
        -Condition ($x64Package.Urls[-1] -eq $NodeBootstrapX64Url) `
        -Message "nodejs.org must remain the last download candidate."
    Assert-LauncherTest `
        -Condition ($x64Package.Urls[0] -notmatch "nodejs\.org") `
        -Message "A domestic mirror must be tried before nodejs.org."
    Assert-LauncherTest `
        -Condition (@($x64Package.Urls | Where-Object { $_ -notmatch "^https://" }).Count -eq 0) `
        -Message "Every download candidate must use https."
    Assert-LauncherTest `
        -Condition (@($x64Package.Urls | Where-Object { $_ -notmatch "node-v24\.19\.0-win-x64\.zip$" }).Count -eq 0) `
        -Message "Every candidate must point at the archive the pinned SHA-256 covers."

    # --- wait/stop behaviour ---

    $exitedProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "exit 0") -WindowStyle Hidden -Wait -PassThru
    $waitWatch = [Diagnostics.Stopwatch]::StartNew()
    $waitResult = Wait-ForCondition -Condition { $false } -TimeoutSeconds 30 -FailFastProcess $exitedProcess
    $waitWatch.Stop()
    Assert-LauncherTest `
        -Condition (-not $waitResult -and $waitWatch.Elapsed.TotalSeconds -lt 5) `
        -Message "Wait-ForCondition must stop as soon as the child has exited (took $($waitWatch.Elapsed.TotalSeconds) s)."

    $liveProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "ping -n 30 127.0.0.1 > nul") -WindowStyle Hidden -PassThru
    $waitWatch.Restart()
    $timeoutResult = Wait-ForCondition -Condition { $false } -TimeoutSeconds 5 -FailFastProcess $liveProcess
    $waitWatch.Stop()
    Assert-LauncherTest `
        -Condition (-not $timeoutResult -and $waitWatch.Elapsed.TotalSeconds -ge 4.5) `
        -Message "The TimeoutSeconds parameter must be honoured."

    $treeStubPath = Join-Path $RuntimeDirectory "tree.cmd"
    Set-Content -LiteralPath $treeStubPath -Encoding ascii -Value @(
        "@echo off",
        "start /b cmd.exe /c `"ping -n 300 127.0.0.1 > nul`"",
        "ping -n 300 127.0.0.1 > nul"
    )
    $treeProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/s", "/c", $treeStubPath) -WindowStyle Hidden -PassThru
    Start-Sleep -Seconds 3
    $treeChildren = @(Get-CimInstance Win32_Process -Filter "ParentProcessId = $($treeProcess.Id)")
    Stop-StartedProcess -Process $treeProcess
    Stop-StartedProcess -Process $liveProcess
    Start-Sleep -Milliseconds 1500
    $treeSurvivors = @($treeChildren | Where-Object { $null -ne (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue) })
    Assert-LauncherTest `
        -Condition ($treeSurvivors.Count -eq 0) `
        -Message "Stop-StartedProcess left the cmd tree running; the port would stay bound."

    # --- identifying our own processes ---

    Assert-LauncherTest `
        -Condition ("uvicorn app.main:app --host 127.0.0.1 --port 8005" -match (Get-ResumeForgeProcessPattern -Service "backend")) `
        -Message "The backend pattern must match the command line the launcher starts."
    Assert-LauncherTest `
        -Condition ("cmd.exe /d /s /c `"C:\Program Files\nodejs\npm.cmd`" run dev -- --host 127.0.0.1" -match (Get-ResumeForgeProcessPattern -Service "frontend")) `
        -Message "The frontend pattern must match the cmd.exe wrapper PowerShell builds around npm.cmd."

    # --- stop.cmd 兜底：没有启动记录时也要能停掉"确实是简历通"的实例（2026-10-26） ---
    #
    # 记录缺失并不等于服务没在跑：实际出现过"后端在 8005 上跑着、runtime\backend.json
    # 不存在，双击 stop.cmd 静默退出"的形态。兜底只认两个条件：命令行匹配本仓库启动特征
    # + 监听端口自报 ResumeForge，任一不符就不动。下面同时钉住正例与反例。

    $fallbackBackendPattern = Get-ResumeForgeFallbackCommandPattern -Service "backend"
    $fallbackFrontendPattern = Get-ResumeForgeFallbackCommandPattern -Service "frontend"
    Assert-LauncherTest `
        -Condition ("python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8005" -match $fallbackBackendPattern) `
        -Message "兜底的后端特征必须匹配启动器真实命令行。"
    Assert-LauncherTest `
        -Condition ("node C:\site\node_modules\vite\bin\vite.js --host 127.0.0.1 --port 5173 --strictPort" -match $fallbackFrontendPattern) `
        -Message "兜底的前端特征必须匹配 Vite 自己的命令行。"
    Assert-LauncherTest `
        -Condition (-not ("python -m http.server 8000" -match $fallbackBackendPattern)) `
        -Message "兜底不能把任意 Python 进程当成简历通后端。"
    Assert-LauncherTest `
        -Condition (-not ("node C:\site\node_modules\vite\bin\vite.js --port 5173" -match $fallbackFrontendPattern)) `
        -Message "没有 --strictPort 的普通 Vite 项目不能被当成本仓库前端。"
    Assert-LauncherTest `
        -Condition (-not (Test-ResumeForgeHealthPayload -Health ([pscustomobject]@{ status = "ok"; name = "OtherApp" }))) `
        -Message "健康检查的 name 不是 ResumeForge 时兜底必须拒绝动手。"
    Assert-LauncherTest `
        -Condition (Test-ResumeForgeHealthPayload -Health ([pscustomobject]@{ status = "ok"; name = "ResumeForge" })) `
        -Message "健康检查明确自报 ResumeForge 时必须认出来。"

    Assert-LauncherTest `
        -Condition (Test-ResumeForgeFallbackOwnedByProject -ProcessChain @(
            [pscustomobject]@{ ExecutablePath = "C:\x\python.exe"; CommandLine = "" },
            [pscustomobject]@{ ExecutablePath = ""; CommandLine = (Join-Path $ProjectRoot "backend\app\main.py") }
        ) -ProjectRoot $ProjectRoot) `
        -Message "健康检查不可用时，进程来自当前项目目录必须被认作本目录的简历通。"
    Assert-LauncherTest `
        -Condition (-not (Test-ResumeForgeFallbackOwnedByProject -ProcessChain @(
            [pscustomobject]@{ ExecutablePath = "C:\x\python.exe"; CommandLine = "D:\other\site\uvicorn app.main:app" }
        ) -ProjectRoot $ProjectRoot)) `
        -Message "其它目录的进程不能被认成本目录的简历通（否则会误停别人）。"
    $stopScriptContent = Get-Content -LiteralPath (Join-Path $ProjectRoot "scripts\Stop-ResumeForge.ps1") -Raw -Encoding utf8
    Assert-LauncherTest `
        -Condition ($stopScriptContent -match 'Stop-UnrecordedResumeForgeService -Service "backend"' -and
            $stopScriptContent -match 'Stop-UnrecordedResumeForgeService -Service "frontend"') `
        -Message "stop.cmd 必须在记录缺失/过期时调用兜底识别（否则无记录实例停不掉）。"
    Assert-LauncherTest `
        -Condition ($stopScriptContent -match "SkipBackend" -and $stopScriptContent.Contains('-ProjectRoot $ProjectRoot')) `
        -Message "兜底也必须尊重 --skip-backend（应用内退出时不能把后端一起停掉）。"

    # 真实进程正例：能通过健康校验、命令行带后端特征、但没有启动记录的"假简历通"。
    $fakeServerPath = Join-Path $RuntimeDirectory "fake-resumeforge-server.ps1"
    $fakeServerScript = @'
param([int]$Port, [string]$HealthName, [string]$Marker, [string]$DataDir)
$null = $Marker
$null = $DataDir
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
$listener.Start()
while ($true) {
    $client = $listener.AcceptTcpClient()
    try {
        $stream = $client.GetStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $null = $reader.ReadLine()
        while ($true) { $line = $reader.ReadLine(); if ($null -eq $line -or $line -eq "") { break } }
        $body = '{"status":"ok","name":"' + $HealthName + '"}'
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($body)
        $header = "HTTP/1.1 200 OK" + [char]13 + [char]10 + "Content-Type: application/json" + [char]13 + [char]10 + "Content-Length: $($bytes.Length)" + [char]13 + [char]10 + "Connection: close" + [char]13 + [char]10 + [char]13 + [char]10
        $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
        $stream.Write($headerBytes, 0, $headerBytes.Length)
        $stream.Write($bytes, 0, $bytes.Length)
        $stream.Flush()
    }
    finally { $client.Close() }
}
'@
    Set-Content -LiteralPath $fakeServerPath -Encoding utf8 -Value $fakeServerScript

    $getFreePort = {
        $probe = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
        $probe.Start()
        $freePort = ([System.Net.IPEndPoint]$probe.LocalEndpoint).Port
        $probe.Stop()
        return $freePort
    }
    $fakePort = & $getFreePort
    $fakeProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $fakeServerPath,
        "-Port", "$fakePort", "-HealthName", "ResumeForge", "-Marker", "uvicorn app.main:app"
    ) -WindowStyle Hidden -PassThru
    $fakeReady = Wait-ForCondition -Condition { Test-TcpPortInUse -Port $fakePort } -TimeoutSeconds 15
    Assert-LauncherTest -Condition $fakeReady -Message "测试用假简历通服务没有按时监听端口 $fakePort。"
    $fallbackStopped = Stop-UnrecordedResumeForgeService -Service "backend" -Ports @($fakePort)
    $fakeGone = Wait-ForCondition -Condition {
        $fakeProcess.HasExited -or -not (Test-TcpPortInUse -Port $fakePort)
    } -TimeoutSeconds 15
    Assert-LauncherTest `
        -Condition ($fallbackStopped -and $fakeGone) `
        -Message "没有启动记录但命令行+健康检查都匹配的简历通后端必须被兜底停掉。"
    Stop-StartedProcess -Process $fakeProcess

    # 正例（启动中/卡死形态）：健康检查自报别的名字、但进程来自当前目录 → 仍要停。
    # 覆盖用户实际遇到的时序：端口已被拉起、健康检查还没就绪时点 stop，旧实现会"什么都没发现"。
    $startingPort = & $getFreePort
    $startingProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $fakeServerPath,
        "-Port", "$startingPort", "-HealthName", "OtherApp", "-Marker", "uvicorn app.main:app",
        "-DataDir", ('"' + (Join-Path $ProjectRoot "backend") + '"')
    ) -WindowStyle Hidden -PassThru
    $null = Wait-ForCondition -Condition { Test-TcpPortInUse -Port $startingPort } -TimeoutSeconds 15
    $startingStopped = Stop-UnrecordedResumeForgeService -Service "backend" -Ports @($startingPort) -ProjectRoot $ProjectRoot -IdentityWaitSeconds 1
    $startingGone = Wait-ForCondition -Condition {
        $startingProcess.HasExited -or -not (Test-TcpPortInUse -Port $startingPort)
    } -TimeoutSeconds 15
    Assert-LauncherTest `
        -Condition ($startingStopped -and $startingGone) `
        -Message "健康检查暂时不可用但进程来自当前目录时，兜底仍必须停掉它（启动窗口内 stop 不能失效）。"
    Stop-StartedProcess -Process $startingProcess
    # 反例：命令行带同样特征、但健康检查自报别的应用 → 一个进程都不能动。
    $otherHealthPort = & $getFreePort
    $otherHealthProcess = Start-Process -FilePath "powershell.exe" -ArgumentList @(
        "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $fakeServerPath,
        "-Port", "$otherHealthPort", "-HealthName", "OtherApp", "-Marker", "uvicorn app.main:app"
    ) -WindowStyle Hidden -PassThru
    $null = Wait-ForCondition -Condition { Test-TcpPortInUse -Port $otherHealthPort } -TimeoutSeconds 15
    $otherStopped = Stop-UnrecordedResumeForgeService -Service "backend" -Ports @($otherHealthPort)
    $otherAlive = $null -ne (Get-Process -Id $otherHealthProcess.Id -ErrorAction SilentlyContinue)
    Assert-LauncherTest `
        -Condition (-not $otherStopped -and $otherAlive) `
        -Message "健康检查不是 ResumeForge 时兜底绝不能停任何进程（误杀风险）。"
    Stop-StartedProcess -Process $otherHealthProcess


    # --- failure messages must carry the cause ---

    # A real report: an incomplete zip made the backend die at import time, and the
    # only output was "Backend exited with code  before becoming healthy. See
    # runtime\backend.stderr.log." -- a blank exit code and no cause to act on.
    $failureLogPath = Join-Path $RuntimeDirectory "backend.stderr.log"
    Set-Content -LiteralPath $failureLogPath -Encoding utf8 -Value @(
        "",
        "INFO:     Started server process",
        "",
        "RuntimeError: incomplete installation"
    )
    $tail = @(Get-LogTail -Path $failureLogPath)
    Assert-LauncherTest `
        -Condition ($tail.Count -eq 2) `
        -Message "Get-LogTail must drop blank lines (got $($tail.Count))."
    Assert-LauncherTest `
        -Condition ($tail[-1] -like "*incomplete installation*") `
        -Message "Get-LogTail must keep the last line."
    $limitedTail = @(Get-LogTail -Path $failureLogPath -LineCount 1)
    Assert-LauncherTest `
        -Condition ($limitedTail.Count -eq 1 -and $limitedTail[0] -like "*incomplete installation*") `
        -Message "Get-LogTail must honour LineCount."
    Assert-LauncherTest `
        -Condition (@(Get-LogTail -Path (Join-Path $RuntimeDirectory "no-such.log")).Count -eq 0) `
        -Message "A missing log file must yield an empty tail instead of an error."

    $exitedStub = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "exit 7") -WindowStyle Hidden -Wait -PassThru
    Assert-LauncherTest `
        -Condition ((Get-ProcessExitCodeText -Process $exitedStub) -eq "7") `
        -Message "Get-ProcessExitCodeText must report the real exit code."

    $liveStub = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "ping -n 30 127.0.0.1 > nul") -WindowStyle Hidden -PassThru
    $liveExitCodeText = Get-ProcessExitCodeText -Process $liveStub
    $failureMessage = Format-ServiceStartFailure `
        -DisplayName "Backend" `
        -Reason "exited with code $liveExitCodeText before becoming healthy" `
        -LogPath $failureLogPath
    Stop-StartedProcess -Process $liveStub
    Assert-LauncherTest `
        -Condition ($liveExitCodeText -eq "unknown") `
        -Message "A process that has not exited has no exit code; the text must not be empty."
    Assert-LauncherTest `
        -Condition ($failureMessage.Contains($failureLogPath) -and $failureMessage -like "*incomplete installation*") `
        -Message "The failure message must name the log and print its tail."

    # --- only our own recorded processes are ever stopped ---

    $stubRecordPath = Join-Path $RuntimeDirectory "recorded-stub.json"
    $stubProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "ping -n 60 127.0.0.1 > nul") -WindowStyle Hidden -PassThru
    Save-ProcessRecord -Process $stubProcess -Path $stubRecordPath
    # cmd.exe cannot carry the real uvicorn command line, so match on its own.
    $cmdPattern = "cmd\.exe"
    Assert-LauncherTest `
        -Condition ($null -ne (Get-ProcessRecordMatch -RecordPath $stubRecordPath -CommandPattern $cmdPattern)) `
        -Message "A record written for a live process must match it."
    Assert-LauncherTest `
        -Condition ($null -eq (Get-ProcessRecordMatch -RecordPath $stubRecordPath -CommandPattern "uvicorn")) `
        -Message "A record must not match when the command line disagrees."

    Stop-RecordedProcess -DisplayName "stub backend" -RecordPath $stubRecordPath -CommandPattern $cmdPattern
    Assert-LauncherTest `
        -Condition (-not (Test-Path -LiteralPath $stubRecordPath)) `
        -Message "Stop-RecordedProcess must remove the record it acted on."
    Assert-LauncherTest `
        -Condition ($null -eq (Get-Process -Id $stubProcess.Id -ErrorAction SilentlyContinue)) `
        -Message "Stop-RecordedProcess must stop the recorded process."

    # PID reuse: same PID, different start time. Refusing here is the property that
    # keeps the launcher from killing an unrelated application.
    $reusedProcess = Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", "ping -n 60 127.0.0.1 > nul") -WindowStyle Hidden -PassThru
    $reusedRecordPath = Join-Path $RuntimeDirectory "reused-stub.json"
    Save-ProcessRecord -Process $reusedProcess -Path $reusedRecordPath
    $reusedRecord = Get-Content -LiteralPath $reusedRecordPath -Raw -Encoding utf8 | ConvertFrom-Json
    $reusedRecord.started_at_unix = [long]$reusedRecord.started_at_unix - 3600
    $reusedRecord | ConvertTo-Json | Set-Content -LiteralPath $reusedRecordPath -Encoding utf8
    Assert-LauncherTest `
        -Condition ($null -eq (Get-ProcessRecordMatch -RecordPath $reusedRecordPath -CommandPattern $cmdPattern)) `
        -Message "A record whose start time does not match the process must be rejected."
    Stop-RecordedProcess -DisplayName "reused stub" -RecordPath $reusedRecordPath -CommandPattern $cmdPattern
    Assert-LauncherTest `
        -Condition ($null -ne (Get-Process -Id $reusedProcess.Id -ErrorAction SilentlyContinue)) `
        -Message "A mismatched record must never stop the process it points at."
    Stop-StartedProcess -Process $reusedProcess
    Remove-Item -LiteralPath $reusedRecordPath -Force -ErrorAction SilentlyContinue

    # 热启动判定只决定"要不要多打两句提示"，说反了的后果是对着正在装依赖的用户
    # 说"这次不需要重新安装"。两个标记缺一不可。
    $warmBackend = Join-Path $RuntimeDirectory "warm-backend"
    $warmFrontend = Join-Path $RuntimeDirectory "warm-frontend"
    New-Item -ItemType Directory -Path (Join-Path $warmBackend ".venv\Scripts") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $warmFrontend "node_modules\.bin") -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $warmBackend ".venv\Scripts\python.exe") -Value "" -Encoding ascii
    Set-Content -LiteralPath (Join-Path $warmFrontend "node_modules\.bin\vite.cmd") -Value "" -Encoding ascii

    Assert-LauncherTest `
        -Condition (Test-WarmStart -BackendDirectory $warmBackend -FrontendDirectory $warmFrontend) `
        -Message "venv 与 node_modules 都在时必须判定为热启动。"

    $coldBackend = Join-Path $RuntimeDirectory "cold-backend"
    New-Item -ItemType Directory -Path $coldBackend -Force | Out-Null
    Assert-LauncherTest `
        -Condition (-not (Test-WarmStart -BackendDirectory $coldBackend -FrontendDirectory $warmFrontend)) `
        -Message "缺 venv 时必须判定为冷启动（依赖这次要现装）。"

    $coldFrontend = Join-Path $RuntimeDirectory "cold-frontend"
    New-Item -ItemType Directory -Path $coldFrontend -Force | Out-Null
    Assert-LauncherTest `
        -Condition (-not (Test-WarmStart -BackendDirectory $warmBackend -FrontendDirectory $coldFrontend)) `
        -Message "缺 node_modules 时必须判定为冷启动：这次还要跑一遍 npm ci。"

    # --- frontend-mode（RF-09 方案 A）---

    # auto = 有 dist 走后端同源（不起 Node）、没有退回 dev；dev 强制 Vite；
    # production 缺 dist 直接报错（维护者决策：不产出"纯 dev 包"降级）。
    $distFrontend = Join-Path $RuntimeDirectory "dist-frontend"
    New-Item -ItemType Directory -Path (Join-Path $distFrontend "dist") -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $distFrontend "dist\index.html") -Value "<html></html>" -Encoding ascii
    $bareFrontend = Join-Path $RuntimeDirectory "bare-frontend"
    New-Item -ItemType Directory -Path $bareFrontend -Force | Out-Null

    Assert-LauncherTest `
        -Condition (Resolve-FrontendMode -Mode "auto" -FrontendDirectory $distFrontend) `
        -Message "auto 模式下有 dist 必须走后端同源静态。"
    Assert-LauncherTest `
        -Condition (-not (Resolve-FrontendMode -Mode "auto" -FrontendDirectory $bareFrontend)) `
        -Message "auto 模式下没有 dist 必须退回 dev。"
    Assert-LauncherTest `
        -Condition (-not (Resolve-FrontendMode -Mode "dev" -FrontendDirectory $distFrontend)) `
        -Message "dev 模式即使有 dist 也要起 Vite。"
    Assert-LauncherTest `
        -Condition (Resolve-FrontendMode -Mode "production" -FrontendDirectory $distFrontend) `
        -Message "production 模式下有 dist 走后端同源静态。"
    $productionError = $null
    try {
        Resolve-FrontendMode -Mode "production" -FrontendDirectory $bareFrontend | Out-Null
    }
    catch {
        $productionError = $_.Exception.Message
    }
    Assert-LauncherTest `
        -Condition ($null -ne $productionError -and $productionError -match "npm run build") `
        -Message "production 模式缺 dist 必须明确报错（不降级到 dev），报错里要有可照做的步骤。"

    # backend\.env 的可选覆盖：参数优先由 Start-ResumeForge.ps1 的
    # PSBoundParameters 判断保证，这里钉 .env 的读取与校验本身。
    $envFixturePath = Join-Path $RuntimeDirectory "backend.env"
    Set-Content -LiteralPath $envFixturePath -Encoding ascii -Value @("DATABASE_URL=sqlite:///x.db", "FRONTEND_MODE=production")
    Assert-LauncherTest `
        -Condition ((Get-FrontendModeFromEnv -Path $envFixturePath) -eq "production") `
        -Message ".env 里的 FRONTEND_MODE 必须能被读到。"
    Set-Content -LiteralPath $envFixturePath -Encoding ascii -Value @("# 注释 FRONTEND_MODE=dev", "FRONTEND_MODE=`"dev`"")
    Assert-LauncherTest `
        -Condition ((Get-FrontendModeFromEnv -Path $envFixturePath) -eq "dev") `
        -Message "FRONTEND_MODE 带引号时必须被剥掉，注释行必须被忽略。"
    Assert-LauncherTest `
        -Condition ($null -eq (Get-FrontendModeFromEnv -Path (Join-Path $RuntimeDirectory "no-such.env"))) `
        -Message ".env 不存在时必须返回 null 而不是报错。"
    Set-Content -LiteralPath $envFixturePath -Encoding ascii -Value @("FRONTEND_MODE=staging")
    $envModeError = $null
    try {
        Get-FrontendModeFromEnv -Path $envFixturePath | Out-Null
    }
    catch {
        $envModeError = $_.Exception.Message
    }
    Assert-LauncherTest `
        -Condition ($null -ne $envModeError -and $envModeError -match "auto / dev / production") `
        -Message "FRONTEND_MODE 取值无效必须报错而不是静默忽略。"

    # 停止链面对"没有 node 进程"必须安静成功：升级用户（旧版有 vite、新版没有）
    # 两个方向都不能让 stop.cmd 变红。记录缺失时它应当直接返回。
    $missingRecordError = $null
    $missingRecordStatus = $null
    try {
        $missingRecordStatus = Stop-RecordedProcess -DisplayName "frontend" -RecordPath (Join-Path $RuntimeDirectory "missing-record.json") -CommandPattern "npm"
    }
    catch {
        $missingRecordError = $_.Exception.Message
    }
    Assert-LauncherTest `
        -Condition ($null -eq $missingRecordError) `
        -Message "没有运行记录时 Stop-RecordedProcess 必须安静成功（升级路径上 stop.cmd 不能报错）。"
    Assert-LauncherTest `
        -Condition ($missingRecordStatus -eq "missing") `
        -Message "没有记录时必须返回 missing 状态，stop.cmd 才能据此决定是否走无记录兜底。"

    # 记录指向已退出的进程：清理记录并返回 not-running，随后同样允许走兜底。
    $deadRecordPath = Join-Path $RuntimeDirectory "dead-backend.json"
    Set-Content -LiteralPath $deadRecordPath -Encoding utf8 -Value '{"process_id": 999999, "started_at_unix": 1}'
    $deadRecordStatus = Stop-RecordedProcess -DisplayName "backend" -RecordPath $deadRecordPath -CommandPattern "uvicorn"
    Assert-LauncherTest `
        -Condition ($deadRecordStatus -eq "not-running" -and -not (Test-Path -LiteralPath $deadRecordPath)) `
        -Message "记录指向已死进程时必须返回 not-running 并删除过期记录。"

    # ---- 一台什么都没装的电脑：引导分支 -----------------------------------------
    # 覆盖参与判断的函数，断言"找不到 Python / Node 时"走的是哪条路。**真下载**由
    # windows-runtimes 作业负责（它会真的下 portable Node 与 Python 安装包并校验摘要）；
    # 这里管的是**决定装哪个**的逻辑，以及失败时那句"怎么办"是否还在。
    #
    # 特意放在文件末尾：这些 function 覆盖会影响后面所有代码，前面那些用例不该受它们影响。
    function Refresh-ProcessPath { }
    $script:bootstrapCalls = @()

    function Find-SystemPython { return $null }
    function Try-InstallPythonWithWinget { return $false }
    function Install-PythonWithOfficialInstaller { $script:bootstrapCalls += "python-official" }

    $pythonFailure = $null
    try {
        Ensure-SystemPython | Out-Null
    }
    catch {
        $pythonFailure = $_.Exception.Message
    }
    Assert-LauncherTest `
        -Condition ($script:bootstrapCalls -contains "python-official") `
        -Message "找不到 Python 且 winget 不可用时，必须落到官方安装包那条路。"
    Assert-LauncherTest `
        -Condition ($null -ne $pythonFailure -and $pythonFailure -match "怎么办") `
        -Message "Python 引导失败时必须给出可照做的步骤（原文里那句「怎么办」）。"

    # winget 装完但当前进程还是找不到（新装的解释器要新进程才看得到）时，不能就此放弃，
    # 要继续落到官方安装包；这条路径真机上出现过。
    $script:bootstrapCalls = @()
    function Try-InstallPythonWithWinget { return $true }
    try {
        Ensure-SystemPython | Out-Null
    }
    catch {
        # 预期仍然失败（Find-SystemPython 被覆盖成永远找不到）。
    }
    Assert-LauncherTest `
        -Condition ($script:bootstrapCalls -contains "python-official") `
        -Message "winget 报告成功但找不到 Python 时，必须改用官方安装包。"

    function Find-SystemNodeRuntime { return $null }
    function Try-InstallNodeWithWinget { return $false }
    function Install-PortableNodeRuntime { $script:bootstrapCalls += "node-portable" }

    $nodeFailure = $null
    try {
        Ensure-NodeRuntime | Out-Null
    }
    catch {
        $nodeFailure = $_.Exception.Message
    }
    Assert-LauncherTest `
        -Condition ($script:bootstrapCalls -contains "node-portable") `
        -Message "找不到 Node.js 且 winget 不可用时，必须落到便携版运行时那条路。"
    Assert-LauncherTest `
        -Condition ($null -ne $nodeFailure -and $nodeFailure -match "怎么办") `
        -Message "Node.js 引导失败时必须给出可照做的步骤（原文里那句「怎么办」）。"

    Write-Host "Windows launcher tests passed."
}
finally {
    Send-TestDirectoryToRecycleBin -Path $RuntimeDirectory
}
