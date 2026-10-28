# SPDX-License-Identifier: Apache-2.0
"""把建好的库打成「导入用」的备份包。

走应用自己的 ``create_backup_archive``，而不是手写 zip：包内清单的格式号、
alembic revision、逐表行数、资产清单与密钥剥离都在那一处，手写一份必然与导入侧的
校验对不上（最常见的症状是"清单与数据库内容不一致，已拒绝恢复"）。
"""

from __future__ import annotations

import shutil
from pathlib import Path

from app.database import engine
from app.services.data_backup import create_backup_archive


def build(work_dir: Path, output: Path) -> Path:
    """生成 zip 并复制到 ``output``；返回最终路径。"""
    staging = work_dir / "staging"
    staging.mkdir(parents=True, exist_ok=True)
    archive = create_backup_archive(
        engine,
        staging,
        include_api_keys=False,
        include_global_llm=False,
        include_global_assets=False,
        # 单数据集导出本来要扫"数据目录里还有什么没进包"；这里的数据目录是临时目录，
        # 扫出来的只有我们自己创建的 staging/，写进清单只会让导入后多一条无意义的告警。
        scan_coverage=False,
    )
    output.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(archive, output)
    return output
