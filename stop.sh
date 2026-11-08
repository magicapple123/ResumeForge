#!/bin/bash
# 简历通（ResumeForge）Linux 停止入口。
#
# 用法：bash stop.sh        （也可以在文件管理器里「在终端中运行」）
#
# 只停"记录对得上的"进程：PID 存在、命令行匹配、启动时刻签名一致，三者缺一不可，
# 所以 PID 被复用或记录过期时不会误杀无关程序。实现见 scripts/linux/stop.sh。

cd "$(dirname "${BASH_SOURCE[0]:-$0}")" || exit 1

bash "scripts/linux/stop.sh" "$@"
status=$?

if [ "$status" -ne 0 ]; then
    printf '\n按回车键关闭这个窗口。\n'
    read -r _
fi
exit "$status"
