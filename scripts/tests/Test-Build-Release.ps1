# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Packages the current HEAD for real and inspects the result. The point of this
# test is the failure a user reported once: a hand-made zip shipped without
# backend\app\data, so the backend died at import time on a fresh machine.

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$BuildScriptPath = Join-Path $ProjectRoot "scripts\Build-Release.ps1"
$PreflightPath = Join-Path $ProjectRoot "backend\app\preflight.py"
$ConfigPath = Join-Path $ProjectRoot "backend\app\config.py"
$RuntimeDirectory = Join-Path ([IO.Path]::GetTempPath()) ("resumeforge-release-test-" + [Guid]::NewGuid().ToString("N"))

# The maintainer's database and configuration, local runtimes and caches must
# never be packaged. backend/.env.example is the documented exception: it is
# tracked on purpose.
$ForbiddenInArchive = @(
    "^backend/data/",
    "^backend/\.venv/",
    "^frontend/node_modules/",
    "^runtime/",
    "(^|/)\.env(\.|$)",
    "(^|/)__pycache__/",
    # One dependency tree, one lockfile (npm -> pnpm, 2026-11-16). A package
    # carrying both lets pnpm-lock.yaml win while the stale npm resolution
    # travels along, which is exactly the state the migration removed.
    "(^|/)package-lock\.json$"
)
# .env.example ships on purpose (backend/ and frontend/ both have one).
# frontend/.env.demo also ships on purpose: it is the demo build-mode switch
# (VITE_DEMO_MODE=1), tracked for reproducibility, not user configuration.
# Kept in sync with $AllowedPathPattern in Build-Release.ps1 - the test exists to
# pin what that script does, so a change to one without the other is a defect.
$AllowedInArchive = "(^|/)\.env\.example$|^frontend/\.env\.demo$"

function Assert-ReleaseTest {
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
        Write-Warning "Could not move release test data to the recycle bin; leaving it in place: $($_.Exception.Message)"
    }
}

function Read-ZipEntryText {
    param([System.IO.Compression.ZipArchiveEntry]$Entry)

    $stream = $Entry.Open()
    try {
        $reader = New-Object System.IO.StreamReader($stream, [System.Text.Encoding]::UTF8)
        try {
            return $reader.ReadToEnd()
        }
        finally {
            $reader.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Get-ScriptArrayValues {
    # Reads an array-valued variable out of a script without running it.
    param(
        [System.Management.Automation.Language.ScriptBlockAst]$Ast,
        [string]$Name
    )

    $assignment = $Ast.FindAll(
        {
            param($node)
            return $node -is [System.Management.Automation.Language.AssignmentStatementAst] -and
                $node.Left.Extent.Text -eq $Name
        },
        $true
    ) | Select-Object -First 1
    if ($null -eq $assignment) {
        return @()
    }
    return @($assignment.Right.FindAll(
            { param($node) $node -is [System.Management.Automation.Language.StringConstantExpressionAst] },
            $true
        ) | ForEach-Object { $_.Value })
}

function Read-TextFileAsUtf8 {
    param([string]$Path)

    # Windows PowerShell 5.1 decodes text files with the locale codec, which
    # mangles the Chinese comments in these sources.
    return [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($Path))
}

try {
    New-Item -ItemType Directory -Path $RuntimeDirectory -Force | Out-Null

    $tokens = $null
    $parseErrors = $null
    $buildAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $BuildScriptPath,
        [ref]$tokens,
        [ref]$parseErrors
    )
    Assert-ReleaseTest `
        -Condition ($parseErrors.Count -eq 0) `
        -Message "Build-Release.ps1 has PowerShell syntax errors."

    # The script is read by Windows PowerShell 5.1, which decodes a BOM-less file
    # with the locale codec (cp936 on Chinese Windows). Chinese text inside would
    # come out as mojibake, or break parsing. Keep it ASCII.
    $nonAsciiBytes = @([System.IO.File]::ReadAllBytes($BuildScriptPath) | Where-Object { $_ -gt 0x7F }).Count
    Assert-ReleaseTest `
        -Condition ($nonAsciiBytes -eq 0) `
        -Message "Build-Release.ps1 must stay pure ASCII (found $nonAsciiBytes non-ASCII bytes)."

    # --- desktop AppImage artifact naming ---
    #
    # AppImage is a Linux-only format, so the artifact name must not repeat a
    # "-linux-" segment: the AppImage directory expects names like
    # "App-1.0-x86_64.AppImage" and flags the extra segment as a WARNING rather
    # than an error, so such a regression could sit there unnoticed. The .sha256
    # sidecar glob in build-desktop-linux.sh must match the same name -- a rename
    # that misses it silently drops every sidecar.
    $desktopBuilderPath = Join-Path $ProjectRoot "desktop/electron-builder.yml"
    $desktopBuilderContent = Read-TextFileAsUtf8 -Path $desktopBuilderPath
    $linuxArtifactNames = @(
        [regex]::Matches($desktopBuilderContent, '(?m)^\s*artifactName:\s*(\S+)\s*$') |
            ForEach-Object { $_.Groups[1].Value } |
            Where-Object { $_ -match '-linux-' }
    )
    Assert-ReleaseTest -Condition ($linuxArtifactNames.Count -eq 0) -Message "desktop/electron-builder.yml artifactName must not carry a '-linux-' segment; the AppImage is ResumeForge-<version>-<arch>.AppImage (offending: $($linuxArtifactNames -join ', '))."
    $linuxBuildScriptContent = Read-TextFileAsUtf8 -Path (Join-Path $ProjectRoot "scripts/build-desktop-linux.sh")
    Assert-ReleaseTest -Condition ($linuxBuildScriptContent -match 'ResumeForge-"\$VERSION"-\*\.AppImage') -Message "scripts/build-desktop-linux.sh must glob ResumeForge-<version>-<arch>.AppImage; a stale pattern silently drops the .sha256 sidecars."

    # --- macOS microphone usage declaration (I-08) ---
    #
    # macOS 的麦克风是 TCC 级别的系统权限：第一次 getUserMedia 时系统弹窗里那句说明就是
    # Info.plist 的 NSMicrophoneUsageDescription，缺这个键时系统直接拒绝授权（Electron
    # 文档，严重时进程退出）。这个缺陷**只在 mac 上可见**——Windows/Linux 全绿，用户装完
    # 才发现录不了音。维护者没有 Mac，所以这条闸门只能钉住"声明在不在、值是不是空的、
    # 有没有写进 mac: 段的 extendInfo"；真机行为（plutil 能读到、弹窗文案正常）未验证。
    #
    # 三件事分开断言，因为三处失败方式各不相同：
    #   * 键写在 win:/linux: 下 → 永远进不了 Info.plist（mac 段才是 Info.plist 的来源）；
    #   * 写成 `>-` 折叠块 → 断言读到的"值"会变成 `>-` 本身，等于闸门放空；
    #   * 值留空 → 系统弹窗里没有理由，用户看到的就是"被拒绝"。
    $builderLines = $desktopBuilderContent -split "`r?`n"
    $macStart = -1
    for ($lineIndex = 0; $lineIndex -lt $builderLines.Count; $lineIndex++) {
        if ($builderLines[$lineIndex] -match '^mac:\s*$') {
            $macStart = $lineIndex
            break
        }
    }
    Assert-ReleaseTest `
        -Condition ($macStart -ge 0) `
        -Message "desktop/electron-builder.yml has no top-level 'mac:' section."
    $macBlockLines = @()
    for ($lineIndex = $macStart + 1; $lineIndex -lt $builderLines.Count; $lineIndex++) {
        # 顶格的下一行就是下一个顶层键（dmg: / linux: 等）。
        if ($builderLines[$lineIndex] -match '^\S') { break }
        $macBlockLines += $builderLines[$lineIndex]
    }
    $macBlock = $macBlockLines -join "`n"
    # 只认**代码行**：注释里提到这个键不算声明，否则"在 mac 段写一句注释"就能让闸门放空，
    # 而真正的键仍然缺失。`extendInfo:` 上方那段解释性注释正好先提到键名，用整段 `IndexOf`
    # 比先后顺序会判反（2026-11-16 实测：idxMic 265 < idxExt 639，闸门对着正确的文件报红）。
    $macCode = @($macBlockLines | Where-Object { $_ -notmatch '^\s*#' }) -join "`n"
    $extendInfoIndex = $macCode.IndexOf("extendInfo:")
    $micUsageIndex = $macCode.IndexOf("NSMicrophoneUsageDescription")
    Assert-ReleaseTest `
        -Condition ($extendInfoIndex -ge 0 -and $micUsageIndex -gt $extendInfoIndex) `
        -Message "desktop/electron-builder.yml must declare NSMicrophoneUsageDescription under mac.extendInfo; declared anywhere else it never reaches Info.plist and macOS denies the first microphone request."
    $micUsage = [regex]::Match(
        $macCode,
        '(?m)^\s+NSMicrophoneUsageDescription:\s*[''"]?(?<value>[^''"\r\n]*)'
    )
    Assert-ReleaseTest `
        -Condition ($micUsage.Success) `
        -Message "desktop/electron-builder.yml mac.extendInfo is missing NSMicrophoneUsageDescription."
    $micUsageValue = $micUsage.Groups["value"].Value.Trim()
    Assert-ReleaseTest `
        -Condition ($micUsageValue.Length -gt 0) `
        -Message "desktop/electron-builder.yml NSMicrophoneUsageDescription must carry a non-empty reason; an empty value leaves macOS with nothing to show and the request gets denied."

    # --- the packaging run itself ---
    # A thrown error inside the build script propagates and fails this test; the
    # presence of the archive below is the positive signal.
    & $BuildScriptPath -OutputDirectory $RuntimeDirectory

    $archive = Get-ChildItem -LiteralPath $RuntimeDirectory -Filter "ResumeForge-*.zip" -File |
        Sort-Object Name |
        Select-Object -First 1
    Assert-ReleaseTest -Condition ($null -ne $archive) -Message "The build script produced no archive."

    $configContent = Read-TextFileAsUtf8 -Path $ConfigPath
    $version = [regex]::Match($configContent, 'app_version:\s*str\s*=\s*"([^"]+)"').Groups[1].Value
    Assert-ReleaseTest -Condition (-not [string]::IsNullOrWhiteSpace($version)) -Message "Could not read app_version."
    # `-all` 是**契约**，不是命名口味：应用内更新的挑包逻辑（0.14.2 及更早）按文件名排序
    # 取第一个 `.zip`，`-all.zip` 排在 `-macos.zip` / `-windows.zip` 前面，老用户因此能
    # 拿到一个装得上的包。改回不带后缀的名字（`ResumeForge-<版本>.zip`）会让它排到最后，
    # 0.14.2 用户的应用内更新重新变成"一点就报错"。
    Assert-ReleaseTest `
        -Condition ($archive.Name -eq "ResumeForge-$version-all.zip") `
        -Message "The all-platform archive must be named ResumeForge-<version>-all.zip so older in-app updaters pick it (got $($archive.Name))."

    $prefix = "ResumeForge-$version/"
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::OpenRead($archive.FullName)
    try {
        $fileEntries = @($zip.Entries | Where-Object { $_.Name -ne "" })
        $entries = @($fileEntries | ForEach-Object { $_.FullName })

        Assert-ReleaseTest `
            -Condition (@($entries | Where-Object { -not $_.StartsWith($prefix) }).Count -eq 0) `
            -Message "Every archive entry must live under $prefix so extraction creates one folder."
        $relativePaths = @($entries | ForEach-Object { $_.Substring($prefix.Length) })

        # Exactly the tracked tree PLUS the injected frontend\dist (RF-09 plan A:
        # the launcher serves the built frontend from the backend, so the release
        # carries the build output even though git does not track it). This is
        # what a hand-made zip got wrong.
        $trackedFiles = @(& git -C $ProjectRoot ls-tree -r --name-only HEAD)
        Assert-ReleaseTest -Condition ($trackedFiles.Count -gt 0) -Message "git ls-tree returned nothing."
        $distPaths = @($relativePaths | Where-Object { $_.StartsWith("frontend/dist/") })
        Assert-ReleaseTest `
            -Condition ($distPaths.Count -ge 3) `
            -Message "The archive must carry the injected frontend\dist assets (got $($distPaths.Count) entries)."
        $nonDistPaths = @($relativePaths | Where-Object { -not $_.StartsWith("frontend/dist/") })
        Assert-ReleaseTest `
            -Condition ($nonDistPaths.Count -eq $trackedFiles.Count) `
            -Message "Outside frontend\dist, the archive must hold exactly the tracked files: $($nonDistPaths.Count) in the zip vs $($trackedFiles.Count) in git."
        $trackedSet = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
        foreach ($trackedFile in $trackedFiles) {
            [void]$trackedSet.Add($trackedFile)
        }
        $unexpected = @($nonDistPaths | Where-Object { -not $trackedSet.Contains($_) })
        Assert-ReleaseTest `
            -Condition ($unexpected.Count -eq 0) `
            -Message "The archive contains untracked files outside frontend\dist: $($unexpected -join ', ')"

        # The injected assets must be complete and version-paired: index.html is
        # what the backend's SPA fallback serves, version.json is what the backend
        # compares against app_version at startup, and assets/ carries the hashed
        # entry modules the page actually loads.
        foreach ($required in @(
                "frontend/dist/index.html",
                "frontend/dist/version.json"
            )) {
            Assert-ReleaseTest `
                -Condition ($relativePaths -contains $required) `
                -Message "The archive is missing $required."
        }
        $distVersionEntry = $fileEntries | Where-Object { $_.FullName -eq "${prefix}frontend/dist/version.json" } | Select-Object -First 1
        Assert-ReleaseTest -Condition ($null -ne $distVersionEntry) -Message "frontend/dist/version.json is missing from the archive."
        $distVersionText = Read-ZipEntryText -Entry $distVersionEntry
        $distVersion = $null
        try {
            $distVersion = ($distVersionText | ConvertFrom-Json).version
        }
        catch {
            Assert-ReleaseTest -Condition $false -Message "frontend/dist/version.json inside the archive is not valid JSON: $distVersionText"
        }
        Assert-ReleaseTest `
            -Condition ($distVersion -eq $version) `
            -Message "frontend/dist/version.json inside the archive says '$distVersion' but the packaged version is '$version'."

        foreach ($required in @(
                "backend/app/data/skills.json",
                "backend/app/preflight.py",
                "backend/app/prompts/resume_generate_user.md",
                "backend/migrations/versions/0001_baseline_v2.py"
            )) {
            Assert-ReleaseTest `
                -Condition ($relativePaths -contains $required) `
                -Message "The archive is missing $required."
        }

        foreach ($forbidden in $ForbiddenInArchive) {
            $leaked = @($relativePaths | Where-Object { $_ -notmatch $AllowedInArchive -and $_ -match $forbidden })
            Assert-ReleaseTest `
                -Condition ($leaked.Count -eq 0) `
                -Message "Personal data or caches leaked into the archive: $($leaked -join ', ')"
        }

        # .gitattributes asks for CRLF in .cmd; a zip built with LF-only batch files
        # can misbehave in cmd.exe, and that is invisible until a user runs it.
        $startCmdEntry = $fileEntries | Where-Object { $_.FullName -eq "${prefix}start.cmd" } | Select-Object -First 1
        Assert-ReleaseTest -Condition ($null -ne $startCmdEntry) -Message "start.cmd is missing from the archive."
        $startCmdText = Read-ZipEntryText -Entry $startCmdEntry
        Assert-ReleaseTest `
            -Condition (-not ($startCmdText -match "(?<!\r)\n")) `
            -Message "start.cmd inside the archive must use CRLF line endings."

        # macOS entry points. The rule is the exact opposite of .cmd's and just as
        # fatal: a CR before the newline makes the kernel read the interpreter as
        # "/bin/bash\r", so macOS answers "bad interpreter" and the release is
        # unusable on a Mac -- while looking perfectly fine on Windows.
        foreach ($macShellPath in @(
                "start.command",
                "stop.command",
                "update.command",
                "scripts/macos/start.sh",
                "scripts/macos/stop.sh",
                "scripts/macos/update.sh",
                "scripts/macos/lib/common.sh",
                "scripts/macos/lib/python.sh",
                "scripts/macos/lib/node.sh"
            )) {
            $macEntry = $fileEntries | Where-Object { $_.FullName -eq "${prefix}$macShellPath" } | Select-Object -First 1
            Assert-ReleaseTest `
                -Condition ($null -ne $macEntry) `
                -Message "$macShellPath is missing from the archive; the same zip has to start on macOS too."
            $macEntryText = Read-ZipEntryText -Entry $macEntry
            Assert-ReleaseTest `
                -Condition (-not ($macEntryText -match "\r")) `
                -Message "$macShellPath inside the archive must use LF line endings."
        }

        # Finder only runs a double-clicked .command when the executable bit is
        # set, and for a Mac user the archive is the only thing they get -- the
        # bit has to travel inside the zip entry. git archive writes whatever mode
        # the tree records, so a missing chmod in the repository surfaces here
        # rather than as "nothing happens when I double-click" on someone's Mac.
        foreach ($macEntryPoint in @("start.command", "stop.command", "update.command")) {
            $macEntry = $fileEntries | Where-Object { $_.FullName -eq "${prefix}$macEntryPoint" } | Select-Object -First 1
            Assert-ReleaseTest -Condition ($null -ne $macEntry) -Message "$macEntryPoint is missing from the archive."
            $unixMode = ($macEntry.ExternalAttributes -shr 16) -band 0x1FF
            Assert-ReleaseTest `
                -Condition (($unixMode -band 0x49) -eq 0x49) `
                -Message "$macEntryPoint must carry the executable bit inside the archive (mode 0$([Convert]::ToString($unixMode, 8))); Finder refuses to run it on macOS otherwise."
        }
    }
    finally {
        $zip.Dispose()
    }

    # --- the packaging checklist must cover everything the app insists on ---
    #
    # Direction matters: every resource backend\app\preflight.py refuses to start
    # without has to be required by the packager, or a package could ship while the
    # app rejects it. The reverse does not hold -- the packager also checks code
    # entry points, which the app cannot report on because it fails before preflight
    # would speak.
    $buildRequiredFiles = Get-ScriptArrayValues -Ast $buildAst -Name '$RequiredFiles'
    $buildRequiredPrefixes = Get-ScriptArrayValues -Ast $buildAst -Name '$RequiredPrefixes'
    Assert-ReleaseTest `
        -Condition ($buildRequiredFiles.Count -ge 10 -and $buildRequiredPrefixes.Count -ge 3) `
        -Message "Could not read the required-path lists from Build-Release.ps1."
    $preflightContent = Read-TextFileAsUtf8 -Path $PreflightPath
    $preflightPaths = @(
        [regex]::Matches($preflightContent, '"((?:app/|alembic|migrations/versions)[^"]*)"') |
            ForEach-Object { $_.Groups[1].Value } |
            Select-Object -Unique
    )
    Assert-ReleaseTest `
        -Condition ($preflightPaths.Count -ge 5) `
        -Message "Could not read the required-resource list from backend/app/preflight.py."
    $requiredByPackager = @($buildRequiredFiles) + @($buildRequiredPrefixes)
    foreach ($preflightPath in $preflightPaths) {
        $expected = "backend/$preflightPath"
        $covered = ($requiredByPackager -contains $expected) -or ($requiredByPackager -contains "$expected/")
        Assert-ReleaseTest `
            -Condition $covered `
            -Message "Build-Release.ps1 does not require '$expected', but the app refuses to start without it."
    }

    # The production dependency lock cannot be covered by the loop above: it is
    # deliberately NOT a preflight requirement (the app boots fine without it --
    # only the installers read it), so preflight never names it. It is still
    # load-bearing for a *fresh install*: scripts/{macos,linux}/start.sh and the
    # Windows first run install from it with --require-hashes and fail closed when
    # it is missing, so a package that ships without it is a package that cannot be
    # installed. Pin it from the AST here, and pin that it appears exactly once --
    # a duplicated entry would mean the list was edited in a hurry.
    $runtimeLockRelative = "backend/requirements.runtime.lock.txt"
    $lockEntries = @($buildRequiredFiles | Where-Object { $_ -eq $runtimeLockRelative })
    Assert-ReleaseTest `
        -Condition ($lockEntries.Count -eq 1) `
        -Message "Build-Release.ps1 must list '$runtimeLockRelative' exactly once in `$RequiredFiles (found $($lockEntries.Count)); every first-run installer installs from that lock and fails closed without it."

    # The inverse of the $RequiredFiles checks above: a path that must NEVER ship.
    # Pinning it from the AST matters because $ForbiddenPatterns is what makes the
    # packager *delete* a bad archive instead of publishing it -- deleting the
    # entry would leave every other assertion green while the gate quietly stopped
    # guarding. The runtime loop further up already exercises it on a real archive;
    # this one keeps the entry itself from disappearing.
    $buildForbidden = Get-ScriptArrayValues -Ast $buildAst -Name '$ForbiddenPatterns'
    $packageLockPatterns = @($buildForbidden | Where-Object { $_ -match 'package-lock' })
    Assert-ReleaseTest `
        -Condition ($packageLockPatterns.Count -eq 1) `
        -Message "Build-Release.ps1 must keep a package-lock.json entry in `$ForbiddenPatterns (found $($packageLockPatterns.Count)); npm and pnpm lockfiles must never ship together."

    # --- the three per-platform archives the website serves ---
    #
    # The site's download buttons hand out -Platform windows / macos / linux
    # archives instead of sending people to GitHub. A pruning bug there is the
    # worst kind: the user picked "macOS", unzipped, and found only start.cmd.
    # So every pruned archive is really built here and checked from the inside.
    # 三平台对称：选了哪个平台，解压出来就该能双击哪个文件，且不该看见另外两套。
    $ownLaunchersByPlatform = @{
        windows = @("start.cmd", "stop.cmd", "uninstall.cmd")
        macos   = @("start.command", "stop.command", "update.command", "scripts/macos/start.sh")
        # Linux 的入口是 bash 脚本（AppImage 只是第四种进法，zip 必须能独立跑）。
        # 注意 $PlatformLaunchers["linux"] 只把 scripts/linux/{start,stop}.sh 列为必需，
        # 但 scripts/linux/update.sh 确实随包发出，这里一并钉住。
        linux   = @("start.sh", "stop.sh", "update.sh", "scripts/linux/start.sh", "scripts/linux/update.sh")
    }
    $otherLaunchersByPlatform = @{
        windows = @("start.command", "stop.command", "update.command", "scripts/macos/start.sh", "start.sh", "stop.sh", "update.sh", "scripts/linux/start.sh")
        macos   = @("start.cmd", "stop.cmd", "update.cmd", "uninstall.cmd", "scripts/Start-ResumeForge.ps1", "start.sh", "stop.sh", "update.sh", "scripts/linux/start.sh")
        linux   = @("start.cmd", "stop.cmd", "update.cmd", "uninstall.cmd", "scripts/Start-ResumeForge.ps1", "start.command", "stop.command", "update.command", "scripts/macos/start.sh")
    }
    foreach ($platform in @("windows", "macos", "linux")) {
        & $BuildScriptPath -OutputDirectory $RuntimeDirectory -Platform $platform
        $platformArchive = Get-ChildItem -LiteralPath $RuntimeDirectory -Filter "ResumeForge-*$platform.zip" -File |
            Select-Object -First 1
        Assert-ReleaseTest `
            -Condition ($null -ne $platformArchive) `
            -Message "The build script produced no $platform archive."
        Assert-ReleaseTest `
            -Condition ($platformArchive.Name -eq "ResumeForge-$version-$platform.zip") `
            -Message "The $platform archive must be named after the version and platform (got $($platformArchive.Name))."

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $platformZip = [System.IO.Compression.ZipFile]::OpenRead($platformArchive.FullName)
        try {
            $platformPaths = @(
                $platformZip.Entries |
                    Where-Object { $_.Name -ne "" } |
                    ForEach-Object { $_.FullName.Substring($prefix.Length) }
            )
            # 自己的启动器必须在：选了哪个平台，解压出来就该能双击哪个文件。
            $ownLaunchers = $ownLaunchersByPlatform[$platform]
            foreach ($launcher in $ownLaunchers) {
                Assert-ReleaseTest `
                    -Condition ($platformPaths -contains $launcher) `
                    -Message "The $platform archive is missing its own launcher: $launcher."
            }
            # 别人的启动器必须不在：留着它等于把"该双击哪个文件"的困惑原样发给用户。
            $otherLaunchers = $otherLaunchersByPlatform[$platform]
            foreach ($launcher in $otherLaunchers) {
                Assert-ReleaseTest `
                    -Condition ($platformPaths -notcontains $launcher) `
                    -Message "The $platform archive must not carry the other platform's launcher: $launcher."
            }
            # 应用本体在两个包里都必须完整：平台拆分只动启动器，绝不能顺手裁掉代码
            # 或前端生产资产（没有 dist 的包在 auto 模式下会退回 dev，等于要求用户联网装 Node）。
            foreach ($required in @("backend/app/main.py", "backend/app/data/skills.json", "frontend/index.html", "frontend/dist/index.html", "frontend/dist/version.json")) {
                Assert-ReleaseTest `
                    -Condition ($platformPaths -contains $required) `
                    -Message "The $platform archive is missing $required; platform pruning must never touch the app itself."
            }
        }
        finally {
            $platformZip.Dispose()
        }
    }

    # --- -IncludeDesktop: the desktop installer rides inside the archive ---
    #
    # CI has no desktop\node_modules, so a real electron-builder run cannot be
    # part of this test. The -DesktopSetupPath hook lets us still verify the
    # whole contract: the fixture exe is injected under desktop/, the required
    # list grows accordingly, and a bad combination is rejected before any
    # build work happens.
    $paramNames = @($buildAst.ParamBlock.Parameters | ForEach-Object { $_.Name.VariablePath.UserPath })
    Assert-ReleaseTest `
        -Condition ($paramNames -contains "IncludeDesktop" -and $paramNames -contains "DesktopSetupPath") `
        -Message "Build-Release.ps1 must expose -IncludeDesktop and -DesktopSetupPath."

    $rejectedByPlatform = $false
    try {
        & $BuildScriptPath -Platform macos -IncludeDesktop -OutputDirectory $RuntimeDirectory 2>$null | Out-Null
    }
    catch {
        $rejectedByPlatform = ($_.Exception.Message -match "not supported with -Platform macos")
    }
    Assert-ReleaseTest `
        -Condition $rejectedByPlatform `
        -Message "-IncludeDesktop must be rejected with -Platform macos (no mac desktop target is wired)."

    $rejectedByRef = $false
    try {
        & $BuildScriptPath -Ref "0000000-not-a-ref" -IncludeDesktop -OutputDirectory $RuntimeDirectory 2>$null | Out-Null
    }
    catch {
        $rejectedByRef = ($_.Exception.Message -match "requires -Ref HEAD")
    }
    Assert-ReleaseTest `
        -Condition $rejectedByRef `
        -Message "-IncludeDesktop must be rejected with a ref other than HEAD (Build-Desktop assembles its payload from HEAD)."

    $fixtureSetup = Join-Path $RuntimeDirectory "ResumeForge-Setup-$version.exe"
    $fixtureBytes = New-Object byte[] 2048
    $fixtureBytes[0] = 0x4D
    $fixtureBytes[1] = 0x5A  # 'MZ', so the fixture is at least exe-shaped
    [IO.File]::WriteAllBytes($fixtureSetup, $fixtureBytes)
    & $BuildScriptPath -OutputDirectory $RuntimeDirectory -Platform windows -IncludeDesktop -DesktopSetupPath $fixtureSetup

    $windowsDesktopArchive = Join-Path $RuntimeDirectory "ResumeForge-$version-windows.zip"
    Assert-ReleaseTest `
        -Condition (Test-Path -LiteralPath $windowsDesktopArchive -PathType Leaf) `
        -Message "The -IncludeDesktop windows run produced no archive."
    $desktopZip = [System.IO.Compression.ZipFile]::OpenRead($windowsDesktopArchive)
    try {
        $setupZipEntry = $desktopZip.Entries |
            Where-Object { $_.FullName -eq "${prefix}desktop/ResumeForge-Setup-$version.exe" } |
            Select-Object -First 1
        Assert-ReleaseTest `
            -Condition ($null -ne $setupZipEntry) `
            -Message "The archive must carry the injected desktop installer under ${prefix}desktop/."
        Assert-ReleaseTest `
            -Condition ($setupZipEntry.Length -eq $fixtureBytes.Length) `
            -Message "The injected desktop installer must be byte-identical to the built exe (got $($setupZipEntry.Length) bytes, expected $($fixtureBytes.Length))."
    }
    finally {
        $desktopZip.Dispose()
    }

    # The default runs stay desktop-free: the plain archive is what older
    # in-app updaters parse and what the tracked-tree assertion pins, so an
    # unconditional injection would be a silent contract break.
    $allArchivePath = Join-Path $RuntimeDirectory "ResumeForge-$version-all.zip"
    $allZip = [System.IO.Compression.ZipFile]::OpenRead($allArchivePath)
    try {
        $desktopLeak = @($allZip.Entries | Where-Object { $_.FullName -like "*desktop/ResumeForge-Setup-*" })
        Assert-ReleaseTest `
            -Condition ($desktopLeak.Count -eq 0) `
            -Message "Without -IncludeDesktop the archive must not carry a desktop installer."
    }
    finally {
        $allZip.Dispose()
    }

    Write-Host "Release packaging tests passed."
}
finally {
    Send-TestDirectoryToRecycleBin -Path $RuntimeDirectory
}
