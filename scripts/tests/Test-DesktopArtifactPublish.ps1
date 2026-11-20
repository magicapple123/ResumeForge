# SPDX-License-Identifier: Apache-2.0
# Test-DesktopArtifactPublish.ps1 - 发布落盘与完整性校验的守卫。
#
# 为什么值得一条守卫：这一步守的是"安装包能不能被用户装上"，而不是代码风格。
# 仓库所在目录被标成低完整性（Low）时，desktop\out 里的产物会继承 Low 标签，
# 低完整性进程受 no-write-up 约束——用户双击这种安装包，NSIS 准备目标目录就被
# 拒绝。删掉校验、或把它挪到签名之前、或把默认发布目录写回仓库里，症状都只在
# 用户机器上出现（"默认位置也写不进去"），构建日志全绿。所以这几条都钉住：
#   1. 脚本能解析（0 语法错误），三个函数都在；
#   2. -PublishDirectory 有默认值，且默认落在**仓库外**；
#   3. 发布调用位于签名之后（签名会改写 exe 的哈希）；
#   4. 行为：正常发布成功且副本哈希一致、旁文件格式不变；缺旁文件/缺源/
#      目标目录仍是低完整性时都必须 throw（不许静默降级）。
#
# 形态与 Test-PipFailureHint.ps1 / Test-PythonRuntimeGuard.ps1 一致：**不是 Pester**，
# 而是直接跑、失败即 throw 的普通脚本，避免受本机 Pester 3/5 语法差异影响。
#
# 用法：powershell -NoProfile -ExecutionPolicy Bypass -File scripts\tests\Test-DesktopArtifactPublish.ps1

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$buildScript = Join-Path $projectRoot "scripts\Build-Desktop.ps1"

function Assert-GuardTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) { throw $Message }
}

function Write-Check {
    param([string]$Message)
    Write-Host "  ok  $Message"
}

function Write-SkipReason {
    param([string]$Message)
    Write-Host "  skip  $Message"
}

# 从真实脚本里抽出函数定义：这样测的就是构建会用的那一份，不是副本。
# 脚本主体不能 dot-source —— 它会真的开始打包，所以按函数定义逐段加载。
# 加载必须在**脚本作用域**做：放进辅助函数里定义，函数一返回就消失了。
$helperNames = @("Get-IntegrityLabel", "Test-IsLowIntegrityLabel", "Publish-InstallerArtifact")
$parseErrors = $null
$buildAst = [System.Management.Automation.Language.Parser]::ParseFile($buildScript, [ref]$null, [ref]$parseErrors)
Assert-GuardTest ($parseErrors.Count -eq 0) "Build-Desktop.ps1 has $($parseErrors.Count) PowerShell syntax errors."
foreach ($helperName in $helperNames) {
    $definition = $buildAst.FindAll({
            param($node)
            $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $helperName
        }, $true)
    Assert-GuardTest ($definition.Count -eq 1) "Build-Desktop.ps1 must define exactly one function named '$helperName' (found $($definition.Count))."
    Invoke-Expression $definition[0].Extent.Text
}
Write-Check "Build-Desktop.ps1 parses cleanly and defines $($helperNames -join ', ')."

$content = Get-Content -LiteralPath $buildScript -Raw

# --- 静态：参数与调用位置 ---------------------------------------------------
Assert-GuardTest ($content -match '\[string\]\$PublishDirectory') "Build-Desktop.ps1 must expose a -PublishDirectory parameter."
# 断言的是"rf-dist 这个值确实赋给了 $PublishDirectory"，不是"文件里出现过这段字符串"：
# 只查 Contains 的话，把默认值写死到别处、赋值语句改成别的路径，守卫照样绿。
$defaultAssignment = 'Join-Path (Split-Path -Parent $projectRoot) "rf-dist"'
Assert-GuardTest ($content.Contains($defaultAssignment)) "The default -PublishDirectory must be the repo-sibling 'rf-dist' directory (expected to contain: $defaultAssignment)."
Assert-GuardTest ($content -match '\$PublishDirectory\s*=\s*Join-Path \(Split-Path -Parent \$projectRoot\) "rf-dist"') "The 'rf-dist' path must be assigned to `$PublishDirectory; a stray occurrence elsewhere would not take effect."
Write-Check "-PublishDirectory defaults to the repo-sibling rf-dist."

# 锚点必须是**真实签名调用**，不能是注释里的字面量。:378 的
# `# Report task 13: signing is an optional scaffold (scripts/Sign-Windows.ps1).`
# 里也含 "Sign-Windows.ps1"，用 IndexOf 会先命中它（比真实调用早 13 行），于是
# "旁文件挪到真实调用紧前面"这种自然回归形态会被漏判（QA 实验 B 实证）。
$signMatch = [regex]::Match($content, '& powershell[^\n]*-File \$signScript -InstallerPath \$setupPath')
Assert-GuardTest ($signMatch.Success) "The signing invocation (& powershell ... -File `$signScript -InstallerPath `$setupPath) is gone; the ordering assertions have no anchor."
$signIndex = $signMatch.Index
$publishIndex = $content.IndexOf("Publish-InstallerArtifact -SourcePath")
$winBranchIndex = $content.LastIndexOf('if ($Target -eq "win") {')
$sidecarIndex = $content.IndexOf('WriteAllText("$setupPath.sha256"')
Assert-GuardTest ($publishIndex -gt $signIndex) "Publishing must run AFTER signing: signing rewrites the installer, so a hash or label taken earlier describes a file that no longer exists."
Assert-GuardTest ($publishIndex -gt $winBranchIndex) "Publishing must stay inside the win branch (the mac/dir targets have no Windows installer)."

# 旁文件同样必须在签名之后写，而且**只写一次**：签名会改写 exe，签名前算出的摘要
# 描述的是签名前那个文件；桌面更新器按旁文件校验下载，会对这种包报校验和不匹配。
# 这正是本文件存在之前 desktop\out 里的真实状态（侧车 22:55 写、exe 02:08 重建）。
Assert-GuardTest ($sidecarIndex -ge 0) "Build-Desktop.ps1 must still write the .sha256 sidecar; the ordering assertion has no anchor."
Assert-GuardTest ($sidecarIndex -gt $signIndex) "The .sha256 sidecar must be written AFTER signing, from a hash of the final file; otherwise it records the pre-signing digest and the updater rejects the download."
$sidecarWrites = [regex]::Matches($content, 'WriteAllText\("\$setupPath\.sha256"').Count
Assert-GuardTest ($sidecarWrites -eq 1) "The sidecar must be hashed and written exactly once (found $sidecarWrites writes); a second write can leave a stale digest behind."
# 只数 WriteAllText 会漏掉"换一种 API 又写了一遍"：任何写 API 落到 .sha256 路径上都算。
$sidecarWriteApis = [regex]::Matches($content, '(WriteAllText|Set-Content|Add-Content|Out-File)[^\n]*\.sha256').Count
Assert-GuardTest ($sidecarWriteApis -eq 1) "Exactly one statement may write a .sha256 path (found $sidecarWriteApis); a second writer (Set-Content/Out-File alike) reintroduces the stale-digest defect."
Assert-GuardTest ($publishIndex -gt $sidecarIndex) "Publishing must run after the sidecar is written, so the pair it copies is already consistent."

# 摘要必须从**签名后**的文件算出来。只上提 `Get-FileHash` 那一行、把 `WriteAllText` 留在
# 签名之后，就是"算的是签名前的字节、写的是签名后的时机"——正是缺陷本体，而只钉写入
# 位置的守卫会放过它（QA 实验 F 实证：$sha 在 :377、签名 :392、写入 :408 → 全绿假通过）。
# 锚点用正则并断言"恰好命中一次"：IndexOf 在多处命中时会静默取第一处，那正是 P2 那个
# 洞的成因。`.sha256` 的写入只看这个锚点所属的那一处，发布函数里的 Get-FileHash 用的是
# -LiteralPath $SourcePath / $publishedInstaller，不匹配。
$hashHits = [regex]::Matches($content, 'Get-FileHash \$setupPath')
Assert-GuardTest ($hashHits.Count -ge 1) "The sidecar hash computation ('Get-FileHash `$setupPath') is gone; the ordering assertion has no anchor."
Assert-GuardTest ($hashHits.Count -eq 1) "The 'Get-FileHash `$setupPath' anchor is ambiguous (found $($hashHits.Count)); IndexOf-style lookups silently take the first hit, which is how the anchor ended up on a comment before."
$hashIndex = $hashHits[0].Index
Assert-GuardTest ($hashIndex -gt $signIndex) "The sidecar digest must be computed from the post-signing file: a hash hoisted above signing records the pre-signing bytes."
Assert-GuardTest ($sidecarIndex -gt $hashIndex) "The sidecar must be written after the digest is computed."

# 已知边界（不打算再收）：这里认的是"对 .sha256 路径的直接字面量写入"。变量间接写入
# （`$p = "$setupPath.sha256"; [IO.File]::AppendAllText($p, ...)`）看不见——静态文本检查
# 的固有上限，靠代码评审兜底；真要那样写，请顺手把守卫一起改。
Write-Check "Signing, then the digest from the final file, then the single sidecar write, then publishing."

# Build-Desktop.ps1 必须保持**纯 ASCII**：Test-PythonRuntimeGuard.ps1:141-144 把它
# 与另外三个构建脚本一起钉住了（PS 5.1 无 BOM 时按 locale 码页解码，中文会让脚本
# 直接语法错）。这条同时意味着新加的注释与错误文案只能用英文——想写中文注释就得
# 先松那条闸门，而闸门不该为了注释让步。
$bytes = [System.IO.File]::ReadAllBytes($buildScript)
$nonAsciiBytes = ($bytes | Where-Object { $_ -gt 0x7F }).Count
Assert-GuardTest ($nonAsciiBytes -eq 0) "Build-Desktop.ps1 must stay pure ASCII (found $nonAsciiBytes non-ASCII bytes); Test-PythonRuntimeGuard.ps1 pins this."
Write-Check "Build-Desktop.ps1 is still pure ASCII ($($bytes.Length) bytes)."

# --- 行为用例 ---------------------------------------------------------------
$sandbox = Join-Path ([System.IO.Path]::GetTempPath()) ("rf-publish-test-" + [guid]::NewGuid().ToString("N"))
$sourceDir = Join-Path $sandbox "source"
$publishDir = Join-Path $sandbox "published"
$artifactName = "ResumeForge-Setup-9.9.9.exe"
$fixturePath = Join-Path $sourceDir $artifactName

try {
    New-Item -ItemType Directory -Force $sourceDir | Out-Null
    # 2048 字节的假安装包：哈希校验只关心文件内容，不需要真的 190 MB。
    $fixtureBytes = New-Object byte[] 2048
    for ($i = 0; $i -lt $fixtureBytes.Length; $i++) { $fixtureBytes[$i] = [byte]($i % 251) }
    [System.IO.File]::WriteAllBytes($fixturePath, $fixtureBytes)
    $fixtureHash = (Get-FileHash -LiteralPath $fixturePath -Algorithm SHA256).Hash.ToLowerInvariant()
    # 故意写一个过期摘要：签名会改写 exe，而旁文件是签名之前写的，发布副本必须被修正。
    [System.IO.File]::WriteAllText("$fixturePath.sha256", (("0" * 64) + "  $artifactName`n"), [System.Text.Encoding]::ASCII)

    $published = Publish-InstallerArtifact -SourcePath $fixturePath -PublishDirectory $publishDir
    Assert-GuardTest (Test-Path -LiteralPath $published.InstallerPath -PathType Leaf) "Publish must copy the installer into PublishDirectory."
    Assert-GuardTest (Test-Path -LiteralPath $published.SidecarPath -PathType Leaf) "Publish must copy the .sha256 sidecar alongside the installer."
    $publishedHash = (Get-FileHash -LiteralPath $published.InstallerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-GuardTest ($publishedHash -eq $fixtureHash) "The published copy's sha256 must equal the source's."
    Assert-GuardTest ($published.Sha256 -eq $fixtureHash) "The returned object must report the verified hash."

    # 旁文件格式是 CI 与桌面更新器共同认的契约：`<hex>` + 两个空格 + 文件名、ASCII、LF。
    $sidecarText = [System.IO.File]::ReadAllText($published.SidecarPath)
    Assert-GuardTest ($sidecarText -eq "$fixtureHash  $artifactName`n") "The published sidecar must be '<hex>  <name>' + LF carrying the actual hash; got '$sidecarText'."
    Write-Check "Publishing copies both files, verifies the hash and rewrites a stale sidecar."

    # 缺源安装包 -> throw
    $threw = $false
    try {
        Publish-InstallerArtifact -SourcePath (Join-Path $sandbox "missing.exe") -PublishDirectory $publishDir | Out-Null
    } catch {
        $threw = $true
    }
    Assert-GuardTest $threw "Publishing a missing installer must throw."
    Write-Check "A missing source installer is rejected."

    # 缺 .sha256 旁文件 -> throw（桌面更新器无法校验）
    $noSidecar = Join-Path $sourceDir "ResumeForge-Setup-8.8.8.exe"
    [System.IO.File]::WriteAllBytes($noSidecar, (New-Object byte[] 16))
    $threw = $false
    try {
        Publish-InstallerArtifact -SourcePath $noSidecar -PublishDirectory $publishDir | Out-Null
    } catch {
        $threw = $true
    }
    Assert-GuardTest $threw "Publishing without a .sha256 sidecar must throw (the desktop updater cannot verify it)."
    Write-Check "An installer without its sidecar is rejected."

    # 低完整性目标目录 -> throw。只在真能找到 Low 标签目录的机器上断言，否则明说跳过
    # （仓库被标 Low 的那台机器上这条会真的跑）。
    $lowParent = $null
    foreach ($candidate in @((Join-Path $projectRoot "desktop\out"), $projectRoot)) {
        if (-not (Test-Path -LiteralPath $candidate -PathType Container)) { continue }
        if (Test-IsLowIntegrityLabel -Label (Get-IntegrityLabel -Path $candidate)) {
            $lowParent = $candidate
            break
        }
    }

    # 注意：这段用"被测函数自己"探测环境，判定一旦坏掉就会静默走进 skip 分支，
    # 所以下面的纯谓词矩阵是兜底（反证实测：改坏判定后变红的是矩阵那条断言）。
    if ($null -eq $lowParent) {
        Write-SkipReason "no low-integrity directory found in this checkout; the low-label guard was not exercised on this machine."
    }
    else {
        $lowTarget = Join-Path $lowParent (".rf-publish-test-" + [guid]::NewGuid().ToString("N"))
        try {
            $threw = $false
            $failureMessage = ""
            try {
                Publish-InstallerArtifact -SourcePath $fixturePath -PublishDirectory $lowTarget | Out-Null
            } catch {
                $threw = $true
                $failureMessage = $_.Exception.Message
            }
            Assert-GuardTest $threw "Publishing into a low-integrity directory must throw; users cannot install such an artifact."
            Assert-GuardTest ($failureMessage.Contains("low-integrity")) "The low-integrity failure must name the cause; got '$failureMessage'."
            Write-Check "A low-integrity PublishDirectory is rejected with an explanatory message."
        } finally {
            if (Test-Path -LiteralPath $lowTarget) { Remove-Item -LiteralPath $lowTarget -Recurse -Force | Out-Null }
        }
    }
} finally {
    if (Test-Path -LiteralPath $sandbox) { Remove-Item -LiteralPath $sandbox -Recurse -Force | Out-Null }
}

# --- 纯谓词矩阵 -------------------------------------------------------------
Assert-GuardTest (Test-IsLowIntegrityLabel -Label "Low") "Label 'Low' must be treated as low."
Assert-GuardTest (Test-IsLowIntegrityLabel -Label "low") "Label matching must be case-insensitive."
foreach ($label in @("Medium", "High", "", $null)) {
    Assert-GuardTest (-not (Test-IsLowIntegrityLabel -Label $label)) "Label '$label' must NOT be treated as low (a false positive would block every build)."
}
Write-Check "Test-IsLowIntegrityLabel accepts only 'Low'."

Write-Host "Test-DesktopArtifactPublish.ps1: all checks passed."
