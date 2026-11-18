# SPDX-License-Identifier: Apache-2.0
<#
.SYNOPSIS
    把 pip 安装失败的原始输出归成"一句可执行的原因 + 一条动作"（T06）。

.DESCRIPTION
    改造前：pip 失败会抛一段 5 步清单，用户读完仍不知道**这一次**是网络、代理、镜像、
    哈希还是磁盘的问题。清单是"所有可能"，不是"这一次的原因"。

    这里只做分类，不做决策：输入是 pip 的完整输出，输出是
        Category  机器可读类别
        Headline  一句话原因（面向用户，20–40 字）
        Action    一条下一步动作（一条，不是五条）
        Matched   命中的原始行（诊断用，写入日志，不进标题）

    分类顺序有意为之：先排"配置类"（代理/镜像/哈希），再排"环境类"（磁盘/权限），
    最后才是通用网络。因为一次失败可能同时包含多条特征，而配置类的原因更具体、更可行动。

.NOTES
    纯函数：不读环境、不发请求、不写文件，Pester 可直接喂样例输出。
#>

Set-StrictMode -Version Latest

function Get-PipFailureHint {
    [CmdletBinding()]
    [OutputType([pscustomobject])]
    param(
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [AllowNull()]
        [string] $Output
    )

    $text = if ($null -eq $Output) { "" } else { $Output }

    # 每条：类别 → (匹配正则, 一句话原因, 一条动作)。顺序即优先级。
    $rules = @(
        @{
            Category = "hash_mismatch"
            Pattern  = "hash mismatch|THESE PACKAGES DO NOT MATCH THE HASHES|--require-hashes"
            Headline = "下载到的包与锁文件记录的 SHA-256 不一致"
            Action   = "不要绕过校验（去掉 --require-hashes）；把这条 pip 输出发到 GitHub Issues，等锁更新后再装。"
        },
        @{
            Category = "proxy"
            Pattern  = "ProxyError|proxy authentication|407|Tunnel connection failed|Unable to connect to proxy"
            Headline = "代理拒绝了这次连接"
            Action   = "确认代理软件在运行、端口与账号正确；或先清掉 HTTP_PROXY/HTTPS_PROXY 再重试。"
        },
        @{
            Category = "mirror"
            Pattern  = "Could not find a version|No matching distribution|404 Client Error.*pypi"
            Headline = "镜像上没有找到锁文件要求的版本"
            Action   = "换回官方源（去掉 -i 参数）重试；仍在则说明锁已过期，请更新依赖锁后重新安装。"
        },
        @{
            Category = "disk"
            Pattern  = "No space left|ENOSPC|There is not enough space|磁盘空间不足"
            Headline = "磁盘空间不足，安装中断"
            Action   = "清理所在磁盘（至少留出 2 GB）后重试；venv 目录可整体删除重装。"
        },
        @{
            Category = "permission"
            Pattern  = "Permission denied|拒绝访问|Access is denied|WinError 5"
            Headline = "没有权限写入安装目录"
            Action   = "把应用放到用户目录下（不要在 Program Files），或关掉占用该目录的杀毒软件后重试。"
        },
        @{
            Category = "network"
            Pattern  = "Connection timed out|Read timed out|Max retries exceeded|NewConnectionError|SSLError|CERTIFICATE_VERIFY_FAILED|Temporary failure in name resolution"
            Headline = "连不上 Python 包源（超时或证书失败）"
            Action   = "先试国内镜像：backend\.venv\Scripts\python.exe -m pip install --require-hashes -i https://mirrors.aliyun.com/pypi/simple -r backend\requirements.runtime.lock.txt"
        }
    )

    foreach ($rule in $rules) {
        $match = [regex]::Match($text, $rule.Pattern, [System.Text.RegularExpressions.RegexOptions]::IgnoreCase)
        if ($match.Success) {
            return [pscustomobject]@{
                Category = $rule.Category
                Headline = $rule.Headline
                Action   = $rule.Action
                Matched  = $match.Value
            }
        }
    }

    return [pscustomobject]@{
        Category = "unknown"
        Headline = "依赖安装失败，且没有匹配到已知原因"
        Action   = "把日志里 pip-install 开头的那份原始输出发到 GitHub Issues；不要反复重试（同样的环境会得到同样的结果）。"
        Matched  = ""
    }
}
