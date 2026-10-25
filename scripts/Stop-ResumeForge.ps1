# SPDX-License-Identifier: Apache-2.0
[CmdletBinding()]
param(
    [switch]$SkipBackend
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDirectory = Join-Path $ProjectRoot "runtime"

# The process-record helpers live in ResumeForge.Common.ps1 with the rest of the
# launcher helpers so the start path can reuse them: a leftover process that still
# holds its port is stopped through the same PID, start-time and command-line
# checks, never by name.
. (Join-Path $PSScriptRoot "ResumeForge.Common.ps1")

# 先按启动记录停；记录缺失/过期时再走兜底识别（端口 + 命令行 + 健康检查）。
# 兜底是 2026-10-26 补的：实际遇到过"简历通已经在跑、但没有启动记录"的实例
# （被别的窗口/脚本直接拉起、记录被清理等），此时 stop.cmd 静默返回，看起来
# 就是"stop.cmd 失效"。兜底只停能自报 ResumeForge 的进程，详见 Common.ps1。
Write-Host "正在停止简历通..."
$frontendStatus = Stop-RecordedProcess `
    -DisplayName "前端" `
    -RecordPath (Join-Path $RuntimeDirectory "frontend.json") `
    -CommandPattern (Get-ResumeForgeProcessPattern -Service "frontend")
$frontendStopped = $frontendStatus -eq "stopped"
if (-not $frontendStopped) {
    $frontendStopped = Stop-UnrecordedResumeForgeService -Service "frontend" -ProjectRoot $ProjectRoot
}
if (-not $frontendStopped) {
    Write-Host "前端没有需要停止的独立进程（当前多半由后端同源提供页面）。"
}

if (-not $SkipBackend) {
    $backendStatus = Stop-RecordedProcess `
        -DisplayName "后端" `
        -RecordPath (Join-Path $RuntimeDirectory "backend.json") `
        -CommandPattern (Get-ResumeForgeProcessPattern -Service "backend")
    $backendStopped = $backendStatus -eq "stopped"
    if (-not $backendStopped) {
        $backendStopped = Stop-UnrecordedResumeForgeService -Service "backend" -ProjectRoot $ProjectRoot
    }
    if (-not $backendStopped) {
        Write-Host "没有发现正在运行的后端（可能本来就没启动，或已经退出）。"
    }
}
else {
    Write-Host "后端：按请求跳过（应用自己在退出）。"
}

Write-Host "已完成。数据库与配置没有被修改。"
