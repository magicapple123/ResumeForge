[CmdletBinding()]
param()

<#
真正下载一遍 Windows 侧钉死的运行时，并逐个校验仓库里钉死的 SHA-256。

macOS 有对应的作业（`macos-runtimes`）：那边真的下载便携版 Python 与 Node、逐个校验摘要。
Windows 侧此前**没有对应物**——而"一台什么都没装的电脑上双击 start.cmd 能不能成"，几乎全押在
这几个下载地址与摘要上：摘要抄错一位，用户看到的是"下载后启动失败"，而且每个人的网络环境都
不一样。已有的 `windows-end-to-end` 遮住了这条路径：它用的是 runner 自带的 Python/Node。

这份脚本跑的是启动器**自己的**函数，不是重写一遍：
  * Node：`Install-PortableNodeRuntime`（下载 → 校验 → 解压）——真机走的就是它；
  * Python：下载官方安装包并校验摘要。静默安装那一步不在这里跑，它会改 runner 的环境，
    而且与"下载源还在不在、摘要对不对"无关。
#>

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$LauncherPath = Join-Path $ProjectRoot "scripts\Start-ResumeForge.ps1"

function Assert-DownloadTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

# 只取**顶层**的赋值语句（不在函数体里），逐个求值——这样取得的是启动器里那份真常量，
# 而不是在测试里另抄一份（抄一份就多一个事实来源）。求值失败的直接跳过：有些赋值依赖
# 运行时环境或别的函数，我们不关心它们。
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile(
    $LauncherPath, [ref]$tokens, [ref]$parseErrors)
Assert-DownloadTest -Condition ($parseErrors.Count -eq 0) -Message "启动器有语法错误：$LauncherPath"

$functionRanges = @($ast.FindAll({
            param($node)
            return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
        }, $true) | ForEach-Object {
        [pscustomobject]@{ Start = $_.Extent.StartOffset; End = $_.Extent.EndOffset }
    })

foreach ($node in $ast.FindAll({
            param($inner)
            return $inner -is [System.Management.Automation.Language.AssignmentStatementAst]
        }, $true)) {
    $offset = $node.Extent.StartOffset
    $insideFunction = $false
    foreach ($range in $functionRanges) {
        if ($offset -ge $range.Start -and $offset -lt $range.End) {
            $insideFunction = $true
            break
        }
    }
    if ($insideFunction) { continue }
    try {
        Invoke-Expression $node.Extent.Text | Out-Null
    }
    catch {
        # 与本次校验无关的赋值（占了函数返回值、依赖环境变量等）跳过即可。
        continue
    }
}

foreach ($scriptPath in @(
        (Join-Path $ProjectRoot "scripts\ResumeForge.Python.ps1"),
        (Join-Path $ProjectRoot "scripts\ResumeForge.Node.ps1"),
        (Join-Path $ProjectRoot "scripts\ResumeForge.Common.ps1"),
        (Join-Path $ProjectRoot "scripts\ResumeForge.Process.ps1")
    )) {
    $moduleTokens = $null
    $moduleErrors = $null
    $moduleAst = [System.Management.Automation.Language.Parser]::ParseFile(
        $scriptPath, [ref]$moduleTokens, [ref]$moduleErrors)
    Assert-DownloadTest -Condition ($moduleErrors.Count -eq 0) -Message "启动器模块有语法错误：$scriptPath"
    foreach ($definition in $moduleAst.FindAll({
                param($node)
                return $node -is [System.Management.Automation.Language.FunctionDefinitionAst]
            }, $true)) {
        Invoke-Expression $definition.Extent.Text
    }
}

foreach ($required in @(
        "Install-PortableNodeRuntime", "Get-NodeBootstrapPackage", "Get-NodeBootstrapUrls", "Get-WindowsArchitecture"
    )) {
    Assert-DownloadTest -Condition ($null -ne (Get-Command $required -ErrorAction SilentlyContinue)) `
        -Message "启动器里找不到函数 $required。"
}

foreach ($constant in @(
        "NodeBootstrapVersion", "NodeBootstrapX64Url", "NodeBootstrapArm64Url",
        "NodeBootstrapX64Sha256", "NodeBootstrapArm64Sha256",
        "NodeToolsDirectory", "PythonBootstrapUrl", "PythonBootstrapVersion", "PythonBootstrapSha256"
    )) {
    Assert-DownloadTest -Condition ($null -ne (Get-Variable -Name $constant -ErrorAction SilentlyContinue)) `
        -Message "启动器里找不到常量 `$$constant。"
}

function Get-VerifiedFile {
    param(
        [string[]]$Urls,
        [string]$ExpectedSha256,
        [string]$DisplayName,
        [string]$Extension
    )

    $temporary = [IO.Path]::GetTempFileName()
    Remove-Item -LiteralPath $temporary -Force -ErrorAction SilentlyContinue
    $target = "$temporary$Extension"
    foreach ($url in $Urls) {
        try {
            Write-Host "下载 $DisplayName：$url"
            Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $target -TimeoutSec 900
        }
        catch {
            Write-Host "  （这个地址没成功：$($_.Exception.Message)）"
            continue
        }
        $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $target).Hash.ToLowerInvariant()
        if ($actual -eq $ExpectedSha256) {
            Write-Host "  摘要校验通过。"
            return $target
        }
        Write-Host "  摘要不匹配（期望 $ExpectedSha256，实际 $actual），继续试下一个地址。"
    }
    throw "$DisplayName 的所有候选地址都没能下到与仓库里钉死的摘要一致的文件。"
}

# ---- Node：走启动器自己的那条路（下载 + 校验 + 解压） --------------------------
$architecture = Get-WindowsArchitecture
Write-Host "架构：$architecture"
Install-PortableNodeRuntime

$package = Get-NodeBootstrapPackage
$portableDirectory = Join-Path $NodeToolsDirectory "node-v$NodeBootstrapVersion-win-$($package.Architecture)"
$nodePath = Join-Path $portableDirectory "node.exe"
$npmPath = Join-Path $portableDirectory "npm.cmd"
Assert-DownloadTest -Condition (Test-Path -LiteralPath $nodePath) -Message "便携版 Node 解压后没有 node.exe。"
Assert-DownloadTest -Condition (Test-Path -LiteralPath $npmPath) -Message "便携版 Node 解压后没有 npm.cmd（空机器上装不了前端依赖）。"
Write-Host "node --version: $(& $nodePath --version)"

# 另一架构的包只能下载 + 校验摘要——但**正是这一条最有价值**：两个架构的摘要都是人工抄进
# 仓库的常量，抄错一位在别处一律表现成"用户下载后启动失败"，而另一个架构的机器不会出现在
# 我们的测试矩阵里（与 macOS 侧那份作业同样的取舍）。
$foreignArchitecture = if ($architecture -eq "AMD64" -or $architecture -eq "X64") { "arm64" } else { "x64" }
$foreignOfficialUrl = if ($foreignArchitecture -eq "x64") { $NodeBootstrapX64Url } else { $NodeBootstrapArm64Url }
$foreignSha256 = if ($foreignArchitecture -eq "x64") { $NodeBootstrapX64Sha256 } else { $NodeBootstrapArm64Sha256 }
Write-Host "校验另一架构（$foreignArchitecture）的便携版 Node.js..."
$foreignArchive = Get-VerifiedFile `
    -Urls (Get-NodeBootstrapUrls -OfficialUrl $foreignOfficialUrl -Architecture $foreignArchitecture) `
    -ExpectedSha256 $foreignSha256 `
    -DisplayName "便携版 Node.js（$foreignArchitecture）" `
    -Extension ".zip"
Remove-Item -LiteralPath $foreignArchive -Force -ErrorAction SilentlyContinue

# ---- Python：下载 + 校验摘要（不安装） ----------------------------------------
Write-Host "校验 Python $PythonBootstrapVersion 官方安装包..."
$installer = Get-VerifiedFile `
    -Urls @($PythonBootstrapUrl) `
    -ExpectedSha256 $PythonBootstrapSha256 `
    -DisplayName "Python $PythonBootstrapVersion 安装包" `
    -Extension ".exe"
$installerLength = (Get-Item -LiteralPath $installer).Length
Assert-DownloadTest -Condition ($installerLength -gt 10MB) `
    -Message "Python 安装包只有 $installerLength 字节，不像一个完整的安装包。"
Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue

Write-Host "Windows 运行时下载与摘要校验全部通过。"
