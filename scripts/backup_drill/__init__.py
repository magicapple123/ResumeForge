# SPDX-License-Identifier: Apache-2.0
"""R01 完整备份与隔离恢复演练的实现包（入口：scripts/backup_restore_drill.py）。

拆成 common / checks / source_phase / restore_phase / cli 只为守住单文件行数预算。
所有 app 导入都在函数内部完成，因此 common 与 checks 可以被 pytest 在**不设置**
DATABASE_URL 的情况下直接导入。
"""
