# SPDX-License-Identifier: Apache-2.0
"""数据集的查看与管理操作：列表、重命名、删除、导出，以及**数据集文件的落盘/回收**。

从 :mod:`app.services.datasets` 纯搬迁拆出（PR-18 行数预算）：这里的函数只读
注册表/元信息或做文件级管理动作，不触碰切换（prepare/commit/compensate）与
导入校验链路——那两段留在 ``datasets.py``，测试在其模块命名空间上 monkeypatch
（``_DRAIN_TIMEOUT_SECONDS``/``extract_database`` 等），落点不能动。

RR-03 又把两个文件级动作挪进来（同样只为回到行数预算，行为不变）：
``place_packaged_datasets``（把随包数据集原子落盘）与 ``discard_created_datasets``
（失败时收回本次新建的数据集文件）。它们在 ``datasets.py`` 里仍然以同名 re-export
出现，调用方与 monkeypatch 落点不变。
"""

from __future__ import annotations

import logging
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..dataset_registry import (
    MAIN_DATASET_ID,
    MAIN_DATASET_NAME,
    DatasetError,
    dataset_database_file,
    dataset_metadata_file,
    datasets_directory,
    is_valid_dataset_id,
    new_dataset_id,
    read_active_dataset_id,
    read_metadata,
    trash_directory,
    write_metadata,
)
from .data_backup import ExtraDatabase, create_backup_archive, create_collection_archive
from .data_backup.import_archive import (
    _best_effort_checkpoint,
    _remove_candidate_files,
    _remove_sqlite_sidecars,
)

logger = logging.getLogger(__name__)


def _describe(dataset_id: str, path: Path) -> dict[str, Any]:
    metadata = read_metadata(dataset_id) if dataset_id != MAIN_DATASET_ID else {}
    try:
        size = path.stat().st_size
    except OSError:
        size = 0
    return {
        "id": dataset_id,
        "name": metadata.get("name")
        or (MAIN_DATASET_NAME if dataset_id == MAIN_DATASET_ID else "未命名数据集"),
        "source": metadata.get("source") or ("本机" if dataset_id == MAIN_DATASET_ID else "导入"),
        "size_bytes": size,
        "created_at": metadata.get("created_at"),
        "is_active": dataset_id == read_active_dataset_id(),
        "exists": path.exists(),
    }


def list_datasets() -> list[dict[str, Any]]:
    """主数据 + datasets 目录下的各份数据集；当前激活的排在最前。"""
    items = [_describe(MAIN_DATASET_ID, dataset_database_file(MAIN_DATASET_ID))]
    directory = datasets_directory()
    if directory.exists():
        for path in sorted(directory.glob("*.db")):
            if is_valid_dataset_id(path.stem):
                items.append(_describe(path.stem, path))
    items.sort(key=lambda item: (not item["is_active"], item["name"]))
    return items


def rename_dataset(dataset_id: str, name: str) -> dict[str, Any]:
    """重命名数据集（写元信息；主数据不支持重命名，缺失/空名/过长均报错）。"""
    if dataset_id == MAIN_DATASET_ID:
        raise DatasetError("主数据不支持重命名")
    path = dataset_database_file(dataset_id)
    if not path.exists():
        raise DatasetError("数据集文件已不存在", status_code=404)
    cleaned = name.strip()
    if not cleaned:
        raise DatasetError("名称不能为空")
    if len(cleaned) > 64:
        raise DatasetError("名称过长（最多 64 个字符）")
    metadata = read_metadata(dataset_id)
    metadata["name"] = cleaned
    metadata.setdefault("source", "导入")
    metadata.setdefault("created_at", datetime.now().astimezone().isoformat(timespec="seconds"))
    write_metadata(dataset_id, metadata)
    return _describe(dataset_id, path)


def delete_dataset(dataset_id: str) -> None:
    """移入 datasets/.trash/ 而不是删除，与项目「不做彻底删除」的约定一致。"""
    if dataset_id == MAIN_DATASET_ID:
        raise DatasetError("主数据不支持删除")
    if dataset_id == read_active_dataset_id():
        raise DatasetError("不能删除当前正在使用的数据集，请先切换到其它数据集")
    path = dataset_database_file(dataset_id)
    if not path.exists():
        raise DatasetError("数据集文件已不存在", status_code=404)

    trash = trash_directory()
    trash.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    try:
        shutil.move(str(path), str(trash / f"{dataset_id}-{stamp}.db"))
        metadata = dataset_metadata_file(dataset_id)
        if metadata.exists():
            shutil.move(str(metadata), str(trash / f"{dataset_id}-{stamp}.json"))
    except OSError as exc:
        raise DatasetError(f"移动到回收目录失败：{exc}", status_code=500) from exc
    logger.info("数据集已移入回收目录 id=%s", dataset_id)


def export_all_datasets(
    bind: Engine,
    staging_dir: Path,
    *,
    include_api_keys: bool = False,
    include_global_llm: bool = True,
) -> Path:
    """导出**全部数据集**：活动的那份 + 其余每一份都在包里。

    为什么需要它：默认的导出只带**当前活动**的那一份，其余数据集（用户可能有好几份，
    例如给不同求职方向各开一套）不会进包。一个用户"备份了"却丢了几份数据集，通常要到
    很久以后翻旧记录时才发现，那时原始文件可能早就不在了。

    从 R16 起产物是**格式 4 的嵌套整包**：外层 zip 里每份数据集都是一个完整的单数据集
    包（``datasets/main.zip`` / ``datasets/<id>.zip``），逐份带 sha256，坏一份不影响
    其余份的恢复（见 ``data_backup.collection_export``）。
    """
    active = read_active_dataset_id()
    extras: list[ExtraDatabase] = []
    for item in list_datasets():
        if item["id"] == active or not item.get("exists"):
            continue
        extras.append(
            ExtraDatabase(
                dataset_id=item["id"],
                name=item["name"],
                source=dataset_database_file(item["id"]),
                metadata=dict(read_metadata(item["id"]) or {}),
            )
        )
    return create_collection_archive(
        bind,
        staging_dir,
        extras=extras,
        include_api_keys=include_api_keys,
        include_global_llm=include_global_llm,
        include_global_assets=True,
    )


def export_dataset(
    dataset_id: str,
    bind: Engine,
    staging_dir: Path,
    *,
    include_api_keys: bool = False,
    include_global_llm: bool = True,
) -> Path:
    """导出指定数据集为备份包。"""
    target = dataset_database_file(dataset_id)
    if not target.exists():
        raise DatasetError("数据集文件已不存在", status_code=404)
    if dataset_id == read_active_dataset_id():
        return create_backup_archive(
            bind,
            staging_dir,
            include_api_keys=include_api_keys,
            include_global_llm=include_global_llm,
            include_global_assets=True,
        )
    # 非活动数据集：临时建一个引擎取一致快照，用完立即释放（Windows 文件句柄）。
    temporary = database.build_engine(database.database_url_for(target))
    try:
        return create_backup_archive(
            temporary,
            staging_dir,
            include_api_keys=include_api_keys,
            include_global_llm=include_global_llm,
            include_global_assets=True,
        )
    finally:
        temporary.dispose()


def discard_created_datasets(dataset_ids: list[str]) -> None:
    """回滚本次导入新建的数据集：删主文件 + 边车 + 元信息，**只删自己刚创建的**。"""
    for dataset_id in dataset_ids:
        try:
            _remove_candidate_files(dataset_database_file(dataset_id))
            dataset_metadata_file(dataset_id).unlink(missing_ok=True)
        except OSError:
            logger.warning("导入回滚时未能清理数据集文件 id=%s", dataset_id, exc_info=True)


def place_packaged_datasets(
    staged: list[tuple[dict[str, Any], Path]],
    created_ids: list[str],
) -> list[dict[str, Any]]:
    """把已经校验过的其余数据集逐个落盘（校验在 ``import_dataset`` 里已经做完了）。

    ``created_ids`` 是调用方的**回收清单**：每生成一个新 id 就立刻登记进去，这样
    即使本函数在中途某个条目上失败（磁盘故障、第二个库写不进去），调用方的回滚
    也收得回**已经落盘的**那几份——否则列表里会留下半截数据集。
    """
    restored: list[dict[str, Any]] = []
    for entry, candidate in staged:
        dataset_id = new_dataset_id()
        # 先登记再落盘：任何中途失败都要能被回滚收回。
        created_ids.append(dataset_id)
        target = dataset_database_file(dataset_id)
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".partial")
        try:
            # Require a complete WAL checkpoint. A busy/failed checkpoint must not publish
            # the main file without its committed pages; the caller rolls back this import.
            _best_effort_checkpoint(candidate)
            _remove_sqlite_sidecars(candidate)
            # 同盘内改名是原子的：中途失败不会在列表里留下半截的数据集。
            candidate.replace(partial)
            partial.replace(target)
        except OSError as exc:
            partial.unlink(missing_ok=True)
            raise DatasetError(f"写入数据集失败：{exc}", status_code=500) from exc
        write_metadata(
            dataset_id,
            {
                # 名字沿用包里的：用户就是靠它在列表里认出这是哪一份。
                "name": str(entry.get("name") or "导入的数据集"),
                "source": "随备份包导入",
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
            },
        )
        restored.append(_describe(dataset_id, target))
        logger.info("随包恢复了数据集 id=%s name=%s", dataset_id, entry.get("name"))
    return restored
