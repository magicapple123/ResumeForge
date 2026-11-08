#!/bin/bash
# 简历通（ResumeForge）Linux 更新入口。
#
# 用法：bash update.sh            （检查并更新）
#      bash update.sh --check    （只看有没有新版本，不改动任何文件）
#
# 只更新程序文件：backend/data/（数据库、数据集、备份）与 backend/.env 永远不会
# 被覆盖；覆盖前会把旧文件备份到 runtime/backup-<时间戳>/。
# 建议先执行 bash stop.sh 停掉服务再更新。实现见 scripts/linux/update.sh。

cd "$(dirname "${BASH_SOURCE[0]:-$0}")" || exit 1

bash "scripts/linux/update.sh" "$@"
status=$?

if [ "$status" -ne 0 ]; then
    printf '\n按回车键关闭这个窗口。\n'
    read -r _
fi
exit "$status"
