# SPDX-License-Identifier: Apache-2.0
"""数据集的独立生命周期动作（从 ``services/datasets.py`` 纯搬迁）：新建空数据集
与启动指针恢复。

为什么独立成模块：``datasets.py`` 贴着 500 行预算。导入链路（``import_dataset``）
与切换链路（prepare/commit/compensate）留在原模块——测试在 ``datasets`` 模块命名
空间上 monkeypatch（``_DRAIN_TIMEOUT_SECONDS`` / ``extract_database`` /
``run_database_migrations`` / ``cleanup_temp_directories`` /
``write_active_dataset_id`` 等），落点不能动；本模块只承载不参与这些打桩的两个动作，
原模块作为对外门面再导出。

日志频道刻意沿用 ``app.services.datasets``：``test_dataset_activation_compensation``
用 ``caplog.at_level(..., logger="app.services.datasets")`` 钉住恢复链路的告警/信息，
搬迁不能换频道（换名字后 INFO 记录会被默认 WARNING 级别滤掉）。
"""

from __future__ import annotations

import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..database_migrations import run_database_migrations
from ..dataset_registry import (
    MAIN_DATASET_ID,
    DatasetError,
    dataset_database_file,
    new_dataset_id,
    read_active_dataset_id,
    write_active_dataset_id,
    write_metadata,
)
from ..runtime.log_fields import safe_log_text
from .datasets_admin import _describe

logger = logging.getLogger("app.services.datasets")


def create_dataset(name: str, bind: Engine) -> dict[str, Any]:
    """新建一份**空数据集**：全新 SQLite 文件 + 迁移到当前 head + 写元信息。

    空库直接跑迁移（``0001`` → head），不必先 ``create_all``：create_all + stamp + upgrade
    会把 ``0002`` 起的加索引/加列动作在已经建好的表上重复执行一遍而失败。
    """
    cleaned = name.strip()
    if not cleaned:
        raise DatasetError("名称不能为空")
    if len(cleaned) > 64:
        raise DatasetError("名称过长（最多 64 个字符）")

    dataset_id = new_dataset_id()
    target = dataset_database_file(dataset_id)
    target.parent.mkdir(parents=True, exist_ok=True)

    new_engine = database.build_engine(database.database_url_for(target))
    try:
        run_database_migrations(new_engine)
    finally:
        new_engine.dispose()

    write_metadata(
        dataset_id,
        {
            "name": cleaned,
            "source": "新建",
            "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
        },
    )
    logger.info("已新建空数据集 id=%s", safe_log_text(dataset_id))
    return _describe(dataset_id, target)


def recover_startup_pointer() -> None:
    """启动时校验数据集指针与可用库的一致性（PR-03 崩溃窗口的确定性恢复）。

    极端崩溃窗口：指针已写成目标库、进程在引擎接管完成前退出。重启后若指针
    指向的库已不可用（文件丢失/损坏到打不开），记录并回退主数据；可用则保持
    用户的选择——切换意图在预检通过之后才落盘，保持它是安全的。
    """
    dataset_id = read_active_dataset_id()
    if dataset_id == MAIN_DATASET_ID:
        return
    try:
        target = dataset_database_file(dataset_id)
        if not target.exists():
            raise DatasetError(f"数据集文件已不存在：{target.name}")
        # 只用探针连接验证"这个文件真的打得开"：SQLite 惰性建连，坏文件要到
        # 第一条 PRAGMA 才暴露，这里主动触发一次。
        probe = database.build_engine(database.database_url_for(target))
        try:
            with probe.connect() as connection:
                connection.exec_driver_sql("SELECT 1")
        finally:
            probe.dispose()
    except Exception as exc:  # noqa: BLE001 - 指针不可用就要恢复，不能让启动失败
        logger.warning("启动恢复：指针指向的数据集 %s 不可用（%s），已回退主数据", dataset_id, exc)
        write_active_dataset_id(MAIN_DATASET_ID)
        main_file = dataset_database_file(MAIN_DATASET_ID)
        current = database.engine.url.database
        if current is None or Path(str(current)).resolve() != main_file.resolve():
            database.rebind(main_file)
        return
    logger.info("启动恢复：数据集指针一致性校验通过 id=%s", dataset_id)


__all__ = ["create_dataset", "recover_startup_pointer"]
