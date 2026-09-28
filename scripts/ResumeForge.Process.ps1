# ResumeForge launcher: backend/frontend startup orchestration.

<#
端口上有一个**健康**的简历通在应答，但它不是从**这个目录**启动的时，启动器会沿用别人的
进程、跳过自己的依赖安装，而用户看到的是「打开浏览器一片空白、依赖好像没装」——这正是
2026-09-29 用户在一台虚拟机上解压新版本后遇到的形态：机器上还留着上一次运行（另一个目录）
的实例，新解压的这份一行代码都没跑起来。

判断「是不是自己人」只有一份依据：本目录 `runtime\*` 里的进程记录，而且 PID、启动时间、
命令行三者都要对得上（`Get-ProcessRecordMatch` 已经做了这三重校验）。记录不在本目录
（或对不上）就如实报出来，并给出两条可执行的出路。
#>
function Assert-RunningServiceIsOwned {
    param(
        [string]$DisplayName,
        [string]$RecordPath,
        [string]$CommandPattern,
        [string]$Port,
        [string]$PortOption
    )

    if ($null -ne (Get-ProcessRecordMatch -RecordPath $RecordPath -CommandPattern $CommandPattern)) {
        return
    }

    throw ("端口 $Port 上有一个简历通$DisplayName在运行，但它不是从当前目录启动的，所以这次不会沿用它。`n" +
        "当前目录：$ProjectRoot`n" +
        "也就是说：刚解压的这份代码一行都没跑起来——浏览器里看到的可能是另一个位置的简历通，" +
        "也可能是上一次运行留下的残影，那正是「页面一片空白、依赖好像没装」的来源。`n" +
        "怎么办（二选一）：`n" +
        "  1) 关掉占用该端口的程序：先双击**当前目录**的 stop.cmd；它认不出来时，到任务管理器结束占用 $Port 的进程；`n" +
        "  2) 换一个端口启动：start.cmd $PortOption 8010")
}

<#
Vite 的 dev server「健康」只说明它在监听。真正让页面渲染出来的是浏览器随后去取入口模块
（`index.html` 里那个 `type="module"` 的 `/src/main.tsx`）这一步，而 Vite 要现做一次依赖
预打包——几百个包，慢机器上实测几十秒到几分钟（本机冷启动实测单次取入口 >10 秒）。

启动器原本在健康检查通过后立刻打开浏览器，于是这段等待全部落在用户眼前：**一片空白**，
看起来就像启动失败（2026-09-29 用户在虚拟机上反馈的就是这个形态）。这里在开浏览器之前
先把首页与入口各取一遍，把等待挪到「正在准备前端页面」这句话下面；取不到不算失败
（浏览器打开时还会再取一次），只提示一句。
#>
function Invoke-FrontendWarmup {
    param([string]$Url)

    $entry = "/src/main.tsx"
    try {
        $html = [string](Invoke-WebRequest -UseBasicParsing -Uri "$Url/" -TimeoutSec 60).Content
        # 入口以 index.html 为准（改了名字也照样对得上），但 Vite 会往头部插一个
        # /@vite/client 的 HMR 客户端——它同样是 module 脚本，取到它就等于没热身。
        # 所以去掉 /@ 开头的 Vite 内部脚本，取剩下的最后一个。
        $sources = @(
            [regex]::Matches($html, '<script[^>]*type="module"[^>]*src="([^"]+)"') |
            ForEach-Object { $_.Groups[1].Value } |
            Where-Object { $_ -notmatch '^/@' }
        )
        if ($sources.Count -gt 0) { $entry = $sources[-1] }
    }
    catch {
        Write-Warning "取首页失败（不影响启动，浏览器打开时还会再取一次）：$($_.Exception.Message)"
    }

    Write-Host "正在准备前端页面（第一次要把几百个依赖打包好，慢机器上要等一会儿）..."
    try {
        $null = Invoke-WebRequest -UseBasicParsing -Uri "$Url$entry" -TimeoutSec 600
        Write-Host "前端页面已就绪：$entry"
    }
    catch {
        Write-Warning "前端入口 $entry 这次没取到（浏览器打开时还会再取一次）：$($_.Exception.Message)"
    }
}

function Start-ResumeForge {
    if ($BackendPort -eq $FrontendPort) {
        throw "后端端口与前端端口不能相同：两者都是 $BackendPort。请用 -BackendPort / -FrontendPort 指定不同的端口。"
    }

    foreach ($directory in @($BackendDirectory, $FrontendDirectory)) {
        if (-not (Test-Path -LiteralPath $directory)) {
            throw "找不到项目目录：$directory。请确认解压出来的文件夹没有被移动或删除。"
        }
    }

    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

    # Named once and reused by the redirects and by the failure messages, so the
    # path a user is told to look at is always the file the process writes.
    $backendStandardOutputPath = Join-Path $RuntimeDirectory "backend.stdout.log"
    $backendLogPath = Join-Path $RuntimeDirectory "backend.stderr.log"
    $frontendStandardOutputPath = Join-Path $RuntimeDirectory "frontend.stdout.log"
    $frontendLogPath = Join-Path $RuntimeDirectory "frontend.stderr.log"

    $startedBackend = $null
    $startedFrontend = $null

    try {
        $backendRecordPattern = Get-ResumeForgeProcessPattern -Service "backend"
        $backendRunning = Test-ResumeForgeBackend -Url $BackendUrl
        if (-not $backendRunning -and (Test-TcpPortInUse -Port $BackendPort)) {
            # A leftover backend of ours can hold the port while failing the health
            # check (it crashed, or the process was replaced mid-flight). Stop that
            # one and start clean instead of telling the user to hunt it down.
            if ($null -eq (Get-ProcessRecordMatch -RecordPath $BackendPidPath -CommandPattern $backendRecordPattern)) {
                throw ("端口 $BackendPort 已被别的程序占用（不是简历通自己的后端，所以不会去动它）。`n" +
                "怎么办（二选一）：`n" +
                "  1) 关掉占用该端口的程序；`n" +
                "  2) 换一个端口启动：start.cmd -BackendPort 8010")
            }
            Write-Warning "上一次运行留下的简历通后端正占着端口 $BackendPort，先停掉它再启动一个新的。"
            Stop-RecordedProcess -DisplayName "backend" -RecordPath $BackendPidPath -CommandPattern $backendRecordPattern
            Start-Sleep -Milliseconds 800
        }

        if ($backendRunning) {
            Assert-RunningServiceIsOwned -DisplayName "后端" -RecordPath $BackendPidPath `
                -CommandPattern $backendRecordPattern -Port $BackendPort -PortOption "-BackendPort"
            Write-Host "后端已经在运行：$BackendUrl"
        }
        else {
            $pythonExecutable = Join-Path $BackendDirectory ".venv\Scripts\python.exe"
            $venvConfigPath = Join-Path $BackendDirectory ".venv\pyvenv.cfg"
            if ((Test-Path -LiteralPath $pythonExecutable) -and
                -not (Test-VenvVersionSupported -ConfigPath $venvConfigPath)) {
                # A venv built by an out-of-window interpreter can never install
                # the pinned wheels, so reusing it makes every run fail the same
                # way. Move it aside rather than delete: the project keeps
                # derived artifacts recoverable, and a rename is free on the
                # same volume. runtime/ is git-ignored.
                $staleVenvPath = Join-Path $RuntimeDirectory ("venv-unsupported-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
                Write-Warning "backend\.venv 是用不受支持的 Python 版本建的，已移到 $staleVenvPath 并重建（原目录没有被删除，需要时可手动找回）。"
                Move-Item -LiteralPath (Join-Path $BackendDirectory ".venv") -Destination $staleVenvPath
            }
            if (-not (Test-Path -LiteralPath $pythonExecutable)) {
                $systemPython = Ensure-SystemPython

                Write-Host "首次运行：正在创建 Python 虚拟环境（这一步只做一次）..."
                $venvArguments = @($systemPython.PrefixArguments) + @(
                    "-m",
                    "venv",
                    (Join-Path $BackendDirectory ".venv")
                )
                & $systemPython.Path @venvArguments
                if ($LASTEXITCODE -ne 0) {
                    throw ("创建 Python 虚拟环境失败。`n" +
                    "怎么办：`n" +
                    "  1) 确认 backend 目录可写（没有被设为只读、也没有被安全软件锁定）；`n" +
                    "  2) 删掉 backend\.venv 后重新双击 start.cmd；`n" +
                    "  3) 仍失败：手动执行 backend\.venv\Scripts\python.exe 所在目录的创建命令，或到 GitHub Issues 反馈并附上上面的报错。")
                }
            }

            if (-not (Test-Path -LiteralPath $pythonExecutable)) {
                throw ("没有找到后端的 Python 环境：$pythonExecutable`n" +
                    "怎么办：删掉 backend\.venv 目录后重新双击 start.cmd，让它重建一次。")
            }

            # Ask the interpreter to import the packages instead of looking for
            # four directory names: a venv that lost pydantic, or whose wheels
            # were built for another interpreter, otherwise passes the check and
            # then dies at import time with only "did not start" to show for it.
            #
            # This probe is expected to fail on a fresh venv, and Python writes
            # the ImportError traceback to stderr. With ErrorActionPreference
            # set to Stop, PowerShell raises a terminating NativeCommandError for
            # any stderr output from a native command, so the preference has to
            # be relaxed for the duration: the exit code is the signal here.
            $probePreference = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                & $pythonExecutable -c "import fastapi, uvicorn, sqlalchemy, alembic, pydantic, pydantic_settings, PIL, pypdf, fpdf, websocket, docx, multipart" 2>&1 | Out-Null
                $dependencyProbeExitCode = $LASTEXITCODE
            }
            finally {
                $ErrorActionPreference = $probePreference
            }
            if ($dependencyProbeExitCode -ne 0) {
                Write-Host "首次运行：正在安装后端依赖（约 40 个包，第一次要几分钟）..."
                & $pythonExecutable -m pip install `
                    --timeout 300 `
                    --retries 10 `
                    -r (Join-Path $BackendDirectory "requirements.txt")
                if ($LASTEXITCODE -ne 0) {
                    throw ("后端依赖安装失败。`n" +
                        "最常见的原因是网络：默认走官方 PyPI，国内经常很慢或直接超时。`n" +
                        "怎么办（按顺序试）：`n" +
                        "  1) 换国内镜像重装（最有效）：`n" +
                        "     backend\.venv\Scripts\python.exe -m pip install -i https://mirrors.aliyun.com/pypi/simple -r backend\requirements.txt`n" +
                        "  2) 需要代理时，先在 PowerShell 里设好 `$env:HTTP_PROXY / `$env:HTTPS_PROXY 再重试；`n" +
                        "  3) 确认能打开 https://mirrors.aliyun.com/pypi/simple/（打不开就是网络被拦了）；`n" +
                        "  4) 仍失败：把上面 pip 的报错原文发到 GitHub Issues。")
                }
            }

            # PYTHONUTF8 is set once at the top of Start-ResumeForge.ps1 so that
            # venv creation, pip and the backend all inherit it.
            $startedBackend = Start-Process -FilePath $pythonExecutable `
                -ArgumentList @("-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$BackendPort", "--log-level", "warning") `
                -WorkingDirectory $BackendDirectory `
                -WindowStyle Hidden `
                -RedirectStandardOutput $backendStandardOutputPath `
                -RedirectStandardError $backendLogPath `
                -PassThru
            Save-ProcessRecord -Process $startedBackend -Path $BackendPidPath

            if (-not (Wait-ForCondition -Condition { Test-ResumeForgeBackend -Url $BackendUrl } `
                    -TimeoutSeconds $BackendStartTimeoutSeconds -FailFastProcess $startedBackend)) {
                if ($startedBackend.HasExited) {
                    throw (Format-ServiceStartFailure -DisplayName "Backend" `
                            -Reason "exited with code $(Get-ProcessExitCodeText -Process $startedBackend) before becoming healthy" `
                            -LogPath $backendLogPath)
                }
                throw (Format-ServiceStartFailure -DisplayName "Backend" `
                        -Reason "did not start within $BackendStartTimeoutSeconds seconds" `
                        -LogPath $backendLogPath)
            }
            Write-Host "后端已启动：$BackendUrl"
        }

        $frontendRecordPattern = Get-ResumeForgeProcessPattern -Service "frontend"
        $frontendRunning = Test-ResumeForgeFrontend -Url $FrontendUrl
        if (-not $frontendRunning -and (Test-TcpPortInUse -Port $FrontendPort)) {
            # Same as the backend above: our own leftover Vite process fails the
            # proxied health check once its backend is gone, and it is ours to stop.
            if ($null -eq (Get-ProcessRecordMatch -RecordPath $FrontendPidPath -CommandPattern $frontendRecordPattern)) {
                throw ("端口 $FrontendPort 被另一个前端占用，而且它连的不是本次的后端（所以不会去动它）。`n" +
                "怎么办（二选一）：`n" +
                "  1) 关掉占用该端口的程序；`n" +
                "  2) 换一个端口启动：start.cmd -FrontendPort 5180")
            }
            Write-Warning "上一次运行留下的简历通前端正占着端口 $FrontendPort，先停掉它再启动一个新的。"
            Stop-RecordedProcess -DisplayName "frontend" -RecordPath $FrontendPidPath -CommandPattern $frontendRecordPattern
            Start-Sleep -Milliseconds 800
        }

        if ($frontendRunning) {
            Assert-RunningServiceIsOwned -DisplayName "前端" -RecordPath $FrontendPidPath `
                -CommandPattern $frontendRecordPattern -Port $FrontendPort -PortOption "-FrontendPort"
            Write-Host "前端已经在运行：$FrontendUrl"
        }
        else {
            $nodeRuntime = Ensure-NodeRuntime
            $npmPath = $nodeRuntime.NpmPath

            $viteCommandPath = Join-Path $FrontendDirectory "node_modules\.bin\vite.cmd"
            if (-not (Test-Path -LiteralPath $viteCommandPath -PathType Leaf)) {
                Write-Host "首次运行：正在安装前端依赖（几百个包，第一次要几分钟）..."
                Push-Location -LiteralPath $FrontendDirectory
                try {
                    $packageLockPath = Join-Path $FrontendDirectory "package-lock.json"
                    if (Test-Path -LiteralPath $packageLockPath) {
                        # npm ci resolves package-lock.json relative to the current
                        # directory; the launcher itself may be started elsewhere.
                        & $npmPath ci `
                            --fetch-timeout=1800000 `
                            --fetch-retries=5 `
                            --fetch-retry-mintimeout=20000 `
                            --fetch-retry-maxtimeout=120000
                    }
                    else {
                        # Older source archives may omit the lockfile. Bootstrap
                        # once with npm install instead of failing with EUSAGE.
                        Write-Warning "没有找到 frontend/package-lock.json，改用 npm install 现场生成一份（这样装出来的版本可能与发布时不同）。"
                        & $npmPath install `
                            --no-audit `
                            --no-fund `
                            --fetch-timeout=1800000 `
                            --fetch-retries=5 `
                            --fetch-retry-mintimeout=20000 `
                            --fetch-retry-maxtimeout=120000
                    }
                    if ($LASTEXITCODE -ne 0) {
                        throw ("前端依赖安装失败。`n" +
                    "可能原因：网络不通、npm 镜像不可达、或磁盘空间不足。`n" +
                    "怎么办：`n" +
                    "  1) 手动重试看完整报错：在 frontend 目录执行 `n" +
                    "     npm install --registry=https://registry.npmmirror.com`n" +
                    "  2) 空间不足时先清理磁盘（node_modules 需要约 400 MB）；`n" +
                    "  3) 需要代理时先设好 `$env:HTTP_PROXY / `$env:HTTPS_PROXY；`n" +
                    "  4) 仍失败：把上面 npm 的报错原文发到 GitHub Issues。")
                    }
                }
                finally {
                    Pop-Location
                }
            }

            # This process-local override keeps the Vite proxy bound to the backend
            # started above without changing a user's tracked or local .env files.
            $env:VITE_BACKEND_URL = $BackendUrl
            # Hand npm.cmd to Start-Process as the program. PowerShell wraps a
            # .cmd in cmd.exe itself and, unlike a hand-written
            # "cmd /c ""<path>" args" line, does the quoting correctly: a path
            # containing spaces used to arrive unquoted and cmd tried to run
            # "C:\Program". The recorded process is still cmd.exe, so stop.cmd
            # keeps recognising it.
            $startedFrontend = Start-Process -FilePath $npmPath `
                -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", "$FrontendPort", "--strictPort") `
                -WorkingDirectory $FrontendDirectory `
                -WindowStyle Hidden `
                -RedirectStandardOutput $frontendStandardOutputPath `
                -RedirectStandardError $frontendLogPath `
                -PassThru
            Save-ProcessRecord -Process $startedFrontend -Path $FrontendPidPath

            if (-not (Wait-ForCondition -Condition { Test-ResumeForgeFrontend -Url $FrontendUrl } `
                    -TimeoutSeconds $FrontendStartTimeoutSeconds -FailFastProcess $startedFrontend)) {
                if ($startedFrontend.HasExited) {
                    throw (Format-ServiceStartFailure -DisplayName "Frontend" `
                            -Reason "exited with code $(Get-ProcessExitCodeText -Process $startedFrontend) before becoming healthy" `
                            -LogPath $frontendLogPath)
                }
                throw (Format-ServiceStartFailure -DisplayName "Frontend" `
                        -Reason "did not start within $FrontendStartTimeoutSeconds seconds" `
                        -LogPath $frontendLogPath)
            }
            Write-Host "前端已启动：$FrontendUrl"
            Invoke-FrontendWarmup -Url $FrontendUrl
        }

        if (-not $NoBrowser) {
            # A machine without a default-browser association makes this throw,
            # and the catch below would then tear down the services we just
            # started. Failing to open a window is not a reason to stop the app.
            try {
                Start-Process $FrontendUrl
            }
            catch {
                Write-Warning "没能自动打开浏览器，请手动访问 $FrontendUrl"
            }
        }

        Write-Host "`n简历通已就绪。要关闭服务，双击 stop.cmd。"
    }
    catch {
        Stop-StartedProcess -Process $startedFrontend
        Stop-StartedProcess -Process $startedBackend
        if ($null -ne $startedFrontend) { Remove-Item -LiteralPath $FrontendPidPath -Force -ErrorAction SilentlyContinue }
        if ($null -ne $startedBackend) { Remove-Item -LiteralPath $BackendPidPath -Force -ErrorAction SilentlyContinue }
        throw
    }
}
