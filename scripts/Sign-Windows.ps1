# SPDX-License-Identifier: Apache-2.0
# Sign-Windows.ps1 - optional Authenticode signing for the Windows installer.
#
# 报告任务 13/14 的 Windows 侧脚手架：签名是**可选**的，缺证书时必须保持
# "未签名但构建成功"。原因很直接：维护者本机与 CI 都没有代码签名证书，
# 如果缺证书就让构建失败，那么每次本地打包和每次 CI 都会红，签名这件事反而
# 更难被保留下来。
#
# 证书来源二选一（优先级从高到低）：
#   RF_WIN_CERT_BASE64     pfx 的 base64（CI secret 的常见形态，避免文件落盘）
#   RF_WIN_CERT_PATH       pfx 文件路径，配合 RF_WIN_CERT_PASSWORD
#
# 用法：
#   pwsh -File scripts\Sign-Windows.ps1 -InstallerPath desktop\out\ResumeForge-Setup-1.0.0.exe
#
# 退出码：0 = 已签名，或"没有证书所以跳过"；非 0 = 配置了证书但签名失败。
# 最后一种必须失败：一个"以为签好了"的未签名安装包，比明确未签名危险得多。

param(
    [Parameter(Mandatory = $true)][string]$InstallerPath
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $InstallerPath -PathType Leaf)) {
    throw "找不到要签名的安装包：$InstallerPath"
}

$certBase64 = $env:RF_WIN_CERT_BASE64
$certPath = $env:RF_WIN_CERT_PATH
$certPassword = $env:RF_WIN_CERT_PASSWORD

if ([string]::IsNullOrWhiteSpace($certBase64) -and [string]::IsNullOrWhiteSpace($certPath)) {
    Write-Host "未配置 Windows 代码签名证书（RF_WIN_CERT_BASE64 / RF_WIN_CERT_PATH），产物为未签名包。"
    Write-Host "SmartScreen 会提示“未知发布者”，对外分发前请配置证书后重新构建。"
    exit 0
}

# signtool 随 Windows SDK 安装，不在 PATH 上：先查 PATH，再按已知的 SDK 布局找。
function Find-SignTool {
    $onPath = Get-Command "signtool.exe" -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }

    $roots = @(
        (Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"),
        (Join-Path $env:ProgramFiles "Windows Kits\10\bin")
    )
    foreach ($root in $roots) {
        if ([string]::IsNullOrWhiteSpace($root) -or -not (Test-Path $root)) { continue }
        # 取版本号最大的那个（目录名形如 10.0.22621.0）；x64 优先，其次 x86。
        $candidates = Get-ChildItem $root -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name -Descending
        foreach ($versionDir in $candidates) {
            foreach ($archDir in @("x64", "x86")) {
                $candidate = Join-Path $versionDir.FullName "$archDir\signtool.exe"
                if (Test-Path $candidate) { return $candidate }
            }
        }
    }
    return $null
}

$signTool = Find-SignTool

# pfx 的临时文件必须在 finally 里删掉：无论是签名成功、失败还是中途抛错，
# 私钥都不能留在磁盘上（哪怕只是临时目录）。
$tempPfx = $null
try {
    $pfxToUse = $null
    $passwordToUse = $certPassword

    if (-not [string]::IsNullOrWhiteSpace($certBase64)) {
        $tempPfx = Join-Path ([System.IO.Path]::GetTempPath()) ("rf-sign-" + [guid]::NewGuid().ToString("N") + ".pfx")
        [System.IO.File]::WriteAllBytes($tempPfx, [System.Convert]::FromBase64String($certBase64))
        $pfxToUse = $tempPfx
    }
    else {
        if (-not (Test-Path -LiteralPath $certPath -PathType Leaf)) {
            throw "RF_WIN_CERT_PATH 指向的文件不存在：$certPath"
        }
        $pfxToUse = $certPath
    }

    if (-not $signTool) {
        throw "找不到 signtool.exe（安装 Windows SDK，或把它的目录加到 PATH）。"
    }

    Write-Host "=== 代码签名：$InstallerPath ==="
    # /fd SHA256 + /td SHA256：SHA-1 已被淘汰，新版 Windows 会直接拒收。
    # /tr 是 RFC3161 时间戳：没有它，证书过期后旧安装包会立刻失去有效性。
    $arguments = @(
        "sign",
        "/fd", "SHA256",
        "/tr", "http://timestamp.digicert.com",
        "/td", "SHA256",
        "/f", $pfxToUse
    )
    if (-not [string]::IsNullOrWhiteSpace($passwordToUse)) {
        $arguments += @("/p", $passwordToUse)
    }
    $arguments += $InstallerPath

    & $signTool @arguments
    if ($LASTEXITCODE -ne 0) {
        throw "signtool sign 失败，退出码 $LASTEXITCODE（证书密码错误、证书已过期或时间戳服务不可达）。"
    }

    # 复核：签名存在且证书链可信。这一步抓的是"signtool 返回 0 但签名没进文件"
    # 这类静默失败。
    & $signTool verify /pa /v $InstallerPath
    if ($LASTEXITCODE -ne 0) {
        throw "signtool verify 失败，退出码 $LASTEXITCODE（签名无效或证书链不可信）。"
    }
    Write-Host "签名完成并通过校验。"
    exit 0
}
finally {
    if ($tempPfx -and (Test-Path -LiteralPath $tempPfx)) {
        Remove-Item -LiteralPath $tempPfx -Force -ErrorAction SilentlyContinue
    }
}
