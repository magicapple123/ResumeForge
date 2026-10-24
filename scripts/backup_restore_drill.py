#!/usr/bin/env python
# SPDX-License-Identifier: Apache-2.0
"""R01 完整备份与隔离恢复演练（合成数据、仓库外临时目录）。

为什么需要它：A02 的"自动数据库快照"只证明**数据库文件存在**，不证明"完整备份
能恢复"——附件、字体、全局模型配置、其余数据集、API Key 策略与 uncovered 清单都
不在快照里。本演练用合成数据**真实调用** services.data_backup 的导出/导入服务
（不另写第二套备份逻辑），在两个互相隔离的临时数据目录之间做一次完整往返，并把
"拒绝恢复"的边界逐个撞一遍。

两个概念必须分开（详见交付文档）：

- 自动数据库快照：data/auto-backups/ 下的单库文件，只含数据库，用于灾难时找回
  最近的库；它**不是**完整备份。
- 完整备份包：create_backup_archive / create_collection_archive 产出的 zip，含
  数据库 + 附件 + 字体 + 全局模型配置 + 其余数据集 + manifest。

用法（在仓库根目录；Windows 用反斜杠）::

    backend/.venv/Scripts/python.exe scripts/backup_restore_drill.py
    backend/.venv/Scripts/python.exe scripts/backup_restore_drill.py --keep --json-out D:/r01.json
    backend/.venv/Scripts/python.exe scripts/backup_restore_drill.py --work-dir D:/rf-drill

退出码：0 = 全部检查通过；1 = 有检查失败；2 = 参数/环境错误。
安全：只写 --work-dir（默认系统临时目录下的 rf-backup-drill-*）；启动时断言
config.DATA_DIR 与数据库路径都落在该目录内，否则拒绝运行；工作目录不允许在仓库内。
绝不读写 backend/data 或真实用户数据；不启动服务、不访问网络。

内部结构：--phase source 造合成数据并导出四份包；--phase restore 在另一个干净目录
里逐个导入（含坏包）并核对；不带 --phase 时主进程依次调度两个子进程（必须独立
进程：app.config 在导入时缓存数据库路径），最后交叉核对"源目录字节指纹在恢复前后
不变"并汇总成一份 JSON 报告。
"""

from __future__ import annotations

from pathlib import Path

_SCRIPTS_DIR = Path(__file__).resolve().parent
if str(_SCRIPTS_DIR) not in __import__("sys").path:
    __import__("sys").path.insert(0, str(_SCRIPTS_DIR))

from backup_drill.cli import main  # noqa: E402 - 先补同目录包路径，再导入实现

if __name__ == "__main__":
    raise SystemExit(main())
