# SPDX-License-Identifier: Apache-2.0
# Test-PipFailureHint.ps1 - 依赖安装失败分类（T06）。
#
# 为什么值得一条守卫：分类错不会崩，只会让用户按错的方案折腾（把哈希不匹配当网络问题
# 反复重试、或把代理问题当镜像问题换源）。这里直接喂 pip 的真实输出片段，断言类别。
#
# 形态与 Test-PythonRuntimeGuard.ps1 一致：**不是 Pester**，而是直接跑、失败即 throw 的
# 普通脚本（CI 里那一行直接调用它）。这样不受本机 Pester 3/5 的语法差异影响。

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "..\PipFailureHint.ps1")

function Assert-GuardTest {
    param(
        [bool]$Condition,
        [string]$Message
    )

    if (-not $Condition) {
        throw $Message
    }
}

function Assert-Hint {
    param(
        [string]$Name,
        [string]$Output,
        [string]$Category,
        [string]$ActionPattern = ""
    )

    $hint = Get-PipFailureHint -Output $Output
    Assert-GuardTest ($hint.Category -eq $Category) `
        "$Name : 期望类别 $Category，实际 $($hint.Category)（Matched=$($hint.Matched)）"
    if ($ActionPattern) {
        Assert-GuardTest ($hint.Action -match $ActionPattern) `
            "$Name : 动作里应包含 '$ActionPattern'，实际 '$($hint.Action)'"
    }
    Assert-GuardTest (-not [string]::IsNullOrWhiteSpace($hint.Headline)) "$Name : Headline 不能为空"
}

# 1) 哈希不匹配必须优先于网络特征：同一次输出里既有 Retrying 又有 hash mismatch。
$hashOutput = @"
Looking in indexes: https://pypi.org/simple
WARNING: Retrying (Retry(total=4, connect=None)) after connection broken by 'ReadTimeoutError'
ERROR: THESE PACKAGES DO NOT MATCH THE HASHES FROM THE REQUIREMENTS FILE.
    pydantic==2.9.2 from https://files.pythonhosted.org/...:
        Expected sha256 abc
             Got        def
"@
Assert-Hint -Name "hash_mismatch" -Output $hashOutput -Category "hash_mismatch" -ActionPattern "不要绕过校验"

# 2) 代理拒绝：动作必须指向代理，而不是换镜像。
Assert-Hint -Name "proxy" `
    -Output "ERROR: Could not install packages due to an OSError: ProxyError('Cannot connect to proxy.', OSError(0, 'Error'))" `
    -Category "proxy" -ActionPattern "HTTP_PROXY"

# 3) 镜像缺版本：提示换回官方源。
Assert-Hint -Name "mirror" `
    -Output "ERROR: Could not find a version that satisfies the requirement foo==1.2.3 (from versions: none)" `
    -Category "mirror" -ActionPattern "官方源"

# 4) 磁盘满：不能冒充网络问题。
Assert-Hint -Name "disk" -Output "OSError: [Errno 28] No space left on device" -Category "disk"

# 5) 权限：Windows 与 POSIX 两种写法都认。
Assert-Hint -Name "permission-posix" -Output "Permission denied: '/opt/app/backend/.venv/lib'" -Category "permission"
Assert-Hint -Name "permission-win" -Output "ERROR: Could not install packages due to an OSError: [WinError 5] 拒绝访问。" -Category "permission"

# 6) 通用网络：超时 / DNS / 证书。
Assert-Hint -Name "timeout" -Output "Read timed out. (read timeout=300)" -Category "network"
Assert-Hint -Name "dns" -Output "Temporary failure in name resolution" -Category "network"

# 7) 没匹配到：落到 unknown，且动作明确"别再重试"。
Assert-Hint -Name "unknown" -Output "Something entirely unexpected happened" -Category "unknown" -ActionPattern "GitHub Issues"

# 8) 空输出不抛（安装器崩溃时日志可能为空）。
Assert-Hint -Name "empty" -Output "" -Category "unknown"

Write-Host "PipFailureHint: 8 组分类断言通过"
