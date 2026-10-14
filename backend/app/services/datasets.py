"""数据集管理：把多份完整数据库作为可切换的数据集来维护。

每份数据集就是一个 SQLite 文件，并且它们是**真实的活动文件**（不是副本）——切换
只是把引擎指过去，不搬运数据，因此也不存在"忘记把改动写回去"的隐患。

指针与目录始终相对 **DATABASE_URL 所在的目录**（见 :mod:`app.dataset_registry`），
所以切换只影响"连哪个文件"，不会让数据集列表本身跟着漂移。

模块分工（PR-18 拆分批，纯搬迁无行为变化）：导入链路（``import_dataset``）与
切换链路（prepare/commit/compensate、``recover_startup_pointer``）留在本文件——测试
在 ``datasets`` 模块命名空间上 monkeypatch（``_DRAIN_TIMEOUT_SECONDS``/``extract_database``
/``run_database_migrations`` 等），落点不能动；列表/重命名/删除/导出，以及数据集
文件的落盘（``place_packaged_datasets``）与失败回收（``discard_created_datasets``）
在 ``datasets_admin.py``；附件的先验后发布在
``data_backup/asset_restore.py``（RR-03，见 ADR-0005）。本文件同时是对外门面：
下面的 re-export 保证既有消费方（``api/datasets.py`` 等）与测试的 import 路径不变。
"""

from __future__ import annotations

import logging
import secrets
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from sqlalchemy import Engine

from .. import database
from ..database import Base, ensure_sqlite_columns
from ..database_compat import SQLITE_REQUIRED_COLUMNS
from ..database_migrations import is_unversioned_legacy_database, run_database_migrations
from ..dataset_registry import (
    MAIN_DATASET_ID,
    DatasetError,
    dataset_database_file,
    datasets_directory,
    is_valid_dataset_id,
    new_dataset_id,
    read_active_dataset_id,
    write_active_dataset_id,
    write_metadata,
)
from ..runtime.log_fields import safe_log_text
from .data_backup import (
    ARCHIVE_DATASETS_DIRNAME,
    cleanup_temp_directories,
    dataset_asset_prefix,
    declared_datasets,
    extract_database,
    inspect_archive,
    inspect_extra_dataset,
)
from .data_backup.asset_manifest import (
    manifest_asset_warnings,
    verify_database_rows,
)
from .data_backup.asset_restore import AssetRestorePlan, verify_restored_assets
from .data_backup.import_archive import (
    _remove_candidate_files,
)
from .datasets_admin import (
    _describe,
    delete_dataset,
    discard_created_datasets,
    export_all_datasets,
    export_dataset,
    list_datasets,
    place_packaged_datasets,
    rename_dataset,
)

logger = logging.getLogger(__name__)

__all__ = [
    "delete_dataset",
    "export_all_datasets",
    "export_dataset",
    "import_dataset",
    "list_datasets",
    "rename_dataset",
]

# 切换前最多等这么久，等正在进行的请求把手里的连接还回池子。
# 排空预算：等待租约清零与连接归还。10s 而非更短的 3s——激活会唤醒备份调度
# （trigger_check），新数据集的首份自动备份在调度线程持租约期间创建，CI/慢磁盘
# 上实测可超过 3s：A→B→A 连续切换的用例在 3s 窗下偶发 409（2026-10-13 CI run6
# Windows 后端作业）。等待有界（10s）好过立即 409 让用户重试；真正卡死的租约
# 超时后仍按原语义拒绝并点名 owner。
_DRAIN_TIMEOUT_SECONDS = 10.0


def _entry_dataset_stem(entry: dict[str, Any]) -> str:
    """取随包数据集条目在包内的 id（``datasets/<stem>.db`` 的 stem）。

    形状合法性已由 ``_assert_member_is_a_dataset`` 在校验阶段把关；这里再取一次
    只是为了给资产成员前缀用，不做二次裁决。
    """
    member = str(entry.get("file") or "")
    prefix = f"{ARCHIVE_DATASETS_DIRNAME}/"
    stem = member[len(prefix) : -len(".db")]
    if (stem != MAIN_DATASET_ID and not is_valid_dataset_id(stem)) or entry.get("id") != stem:
        raise DatasetError("备份包的数据集标识无效，已停止导入", status_code=400)
    return stem


def import_dataset(
    archive_path: Path,
    name: str,
    bind: Engine,
    staging_dir: Path,
    *,
    allow_partial_assets: bool = False,
) -> dict[str, Any]:
    """把上传的备份包校验后落成一份**新数据集**，不触碰当前正在使用的数据。

    **先把整包里所有东西都验完，再开始写盘。** 一份包可能带好几份数据集，若边写边验，
    后面某份不合法时前面几份已经落盘了——用户看到的是一次失败，列表里却多出几份半截的
    数据集，还得自己分辨哪几份能用。校验全部前置之后，这条路径才是"要么全成、要么不动"。

    RR-03 把**附件**也拉进了这条"先验后写"的链路：以前附件是"直接写进共享目录、写完
    再复核"，包里的字节先落到本机同名文件上，复核失败时原件已经被覆写；而且主库与随包
    数据集在附件校验之前就已发布。现在：

    1. 阶段一先做库与附件的**全部预检**（附件写进私有暂存并逐个核对 sha256、
       与磁盘现状做冲突检测），任何完整性问题或冲突都在**业务目录发布前**终止
       （除非用户显式选择 ``allow_partial_assets`` 跳过有问题的附件）；
    2. 阶段二才发布库；发布后任何失败都会**收回本次新建的数据集文件**——只删自己
       刚创建的东西，用户既有文件一律不动；
    3. 阶段三原子、不覆盖地发布附件；失败回收本次新建的文件；
    4. 最后按清单独立复核磁盘现状，严格模式失败回滚；仅显式允许部分附件恢复时
       返回 ``asset_issues`` 与不完整标志。旧包走同一发布链，但没有原始 SHA-256。
    """
    preview = inspect_archive(archive_path, bind, staging_dir)
    manifest = preview.get("manifest", {})
    actual_counts = preview.get("database", {}).get("tables", {})
    for table, expected in (manifest.get("tables") or {}).items():
        if type(expected) is not int or expected < 0 or actual_counts.get(table, 0) != expected:
            raise DatasetError(
                "备份包的数据库行数与清单不符，已停止导入：" + str(table), status_code=400
            )

    staged: list[tuple[dict[str, Any], Path]] = []
    created_dataset_ids: list[str] = []
    assets_parent = datasets_directory()
    plan = AssetRestorePlan(assets_parent / f".rf-restore-{secrets.token_hex(8)}")
    try:
        # 阶段一：只校验，不落盘（库）。
        for entry in declared_datasets(manifest):
            staged.append((entry, inspect_extra_dataset(archive_path, entry, bind, staging_dir)))

        # 阶段一（续）：只校验，不落盘（附件）。每个段一份前缀/目的地口径：活动数据集
        # 用包根扁平前缀，随包数据集用 ``datasets/<id>/``，但**目的地是同一个共享目录**
        # ——正因如此，跨段的物理同名冲突也要在这里被拦住（以前是"后写的赢"）。
        asset_destinations = {
            "user_files": assets_parent / "user_files",
            "referral_images": assets_parent / "referral_images",
        }
        main_assets = manifest.get("asset_manifest")
        if isinstance(main_assets, dict):
            plan.add_section(
                archive_path,
                main_assets,
                prefixes={
                    "user_files": dataset_asset_prefix(None, "user_files"),
                    "referral_images": dataset_asset_prefix(None, "referral_images"),
                },
                destinations=asset_destinations,
                label="活动数据集",
            )
        else:
            plan.add_legacy_section(
                archive_path,
                prefixes={
                    category: dataset_asset_prefix(None, category)
                    for category in asset_destinations
                },
                destinations=asset_destinations,
                label="旧格式活动数据集",
            )
        for entry, _candidate in staged:
            entry_assets = entry.get("asset_manifest") if isinstance(entry, dict) else None
            stem = _entry_dataset_stem(entry)
            prefixes = {
                category: dataset_asset_prefix(stem, category) for category in asset_destinations
            }
            if not isinstance(entry_assets, dict):
                plan.add_legacy_section(
                    archive_path,
                    prefixes=prefixes,
                    destinations=asset_destinations,
                    label="旧格式随包数据集",
                )
                continue
            plan.add_section(
                archive_path,
                entry_assets,
                prefixes=prefixes,
                destinations=asset_destinations,
                label=f"随包数据集「{entry.get('name')}」",
            )
        declared_warnings = manifest_asset_warnings(manifest)
        blocking = [*plan.blocking_issues(), *declared_warnings]
        if blocking and not allow_partial_assets:
            raise DatasetError(
                "备份包的附件未通过校验，已停止导入（没有发布业务数据）："
                + blocking[0]
                + (f"（共 {len(blocking)} 条问题）" if len(blocking) > 1 else ""),
                status_code=400,
            )

        # 阶段二：全部通过之后才开始写。
        dataset_id = new_dataset_id()
        created_dataset_ids.append(dataset_id)
        target = dataset_database_file(dataset_id)
        target.parent.mkdir(parents=True, exist_ok=True)

        # 先写临时文件再原子改名：中途失败不会留下一个半截的数据集被列表看到。
        partial = target.with_suffix(".partial")
        try:
            extract_database(archive_path, partial)
            partial.replace(target)
        except OSError as exc:
            partial.unlink(missing_ok=True)
            raise DatasetError(f"写入数据集失败：{exc}", status_code=500) from exc

        write_metadata(
            dataset_id,
            {
                "name": name.strip() or f"导入于 {datetime.now():%Y-%m-%d %H:%M}",
                "source": "导入",
                "created_at": datetime.now().astimezone().isoformat(timespec="seconds"),
                "manifest": manifest,
            },
        )
        logger.info("已导入新数据集 id=%s name=%s", dataset_id, name)

        result = _describe(dataset_id, target)
        restored = place_packaged_datasets(staged, created_dataset_ids)
        if restored:
            # 随包带走的其余数据集各落成一份新数据集。**用新 id**：包里的 id 在本机可能早就
            # 存在（那是另一份数据），沿用会覆盖它——而覆盖用户的另一份数据集是不可逆的。
            result["restored_datasets"] = restored

        # 阶段三：发布附件（原子改名；同名冲突保留本机文件），随后按清单独立复核。
        asset_issues: list[str] = []
        published, publish_issues = plan.publish()
        counts = plan.merged_counts(published)
        result["restored_assets"] = counts
        asset_issues.extend(publish_issues)
        if publish_issues and not allow_partial_assets:
            raise DatasetError(
                "备份包的附件发布失败，已回滚本次导入：" + publish_issues[0], status_code=500
            )
        if not isinstance(main_assets, dict):
            result["restored_user_files"] = counts["user_files"]
            result["restored_referral_images"] = counts["referral_images"]
            result["legacy_asset_verification"] = "zip_crc_and_size"
        # 用户在允许部分附件恢复下导入时，预检问题同样如实上报。
        if allow_partial_assets:
            asset_issues.extend(blocking)
        if isinstance(main_assets, dict):
            asset_issues.extend(verify_restored_assets(main_assets, asset_destinations))
        for entry, _candidate in staged:
            entry_assets = entry.get("asset_manifest")
            if isinstance(entry_assets, dict):
                asset_issues.extend(verify_restored_assets(entry_assets, asset_destinations))
        # 导出侧已经知道的"这份备份不完整"（附件缺失/内容与登记哈希不符）：导入时
        # 如实转述，别让用户以为恢复出了完整的一套附件。
        if declared_warnings:
            result["backup_asset_warnings"] = declared_warnings

        # 恢复后按清单复核 DB 关键行数（表缺失/行数不符都显式上报）。
        asset_issues.extend(verify_database_rows(target, manifest.get("tables") or {}))
        if asset_issues and not allow_partial_assets:
            raise DatasetError(
                "备份恢复后的完整性校验失败，已回滚本次导入：" + asset_issues[0], status_code=400
            )
        if asset_issues:
            result["asset_issues"] = asset_issues
            result["assets_incomplete"] = True
            logger.warning("备份包恢复完成但存在 %s 条资产/行数问题", len(asset_issues))

        # 回给前端做提示用：勾选过"包含 API Key"的包恢复成功后，界面要如实告诉用户
        # 密钥也跟着回来了（解不开时应用按未配置处理，仍需重填）。
        result["api_key_included"] = manifest.get("api_key_included") is True
        return result
    except BaseException:
        # 阶段二/三中途失败：收回本次新建的数据集文件（只删自己刚创建的那几份，
        # 用户既有文件一个都不动），让"失败"真的等于"什么都没发生"。
        plan.rollback()
        discard_created_datasets(created_dataset_ids)
        raise
    finally:
        plan.discard()
        for _, candidate in staged:
            # 候选库在 staging 校验（迁移）时会产生 WAL 边车，主文件与边车一起清。
            _remove_candidate_files(candidate)


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


def _wait_for_idle(bind: Engine) -> None:
    """两段式排空（RF-03）：先等逻辑租约清零，再兜底等短请求把连接还回池子。

    切换会换掉引擎：若此刻有任务（租约）或请求（连接池）仍停在旧库上，它后续打开
    的会话会落到**新**数据集上，等于把这次的数据写进了别处。宁可让用户重试一次。
    失败信息点名正在运行的任务（租约 owner），而不是一句笼统的"有请求"。
    """
    from ..runtime import dataset_scope

    deadline = time.monotonic() + _DRAIN_TIMEOUT_SECONDS
    while time.monotonic() < deadline:
        if (
            dataset_scope.leases_pending() == 0
            and not getattr(bind.pool, "checkedout", lambda: 0)()
        ):
            return
        time.sleep(0.1)
    owners = dataset_scope.lease_owners()
    detail = "、".join(sorted(set(owners))) if owners else "例如 AI 生成中"
    raise DatasetError(f"有正在进行的任务（{detail}），请稍候再切换数据集", status_code=409)


def _preview_target(target: Path) -> None:
    """目标库预检：用**临时引擎**确认它能打开并完成迁移；失败抛 409，原库不受影响。

    预检引擎用完立即 dispose（Windows 文件句柄），随后提交段才能独占目标文件。
    预检把迁移也跑完一遍：提交段里再跑是幂等的（alembic 已在 head）。
    """
    preview = database.build_engine(database.database_url_for(target))
    try:
        if is_unversioned_legacy_database(preview):
            Base.metadata.create_all(bind=preview)
            ensure_sqlite_columns(preview, SQLITE_REQUIRED_COLUMNS)
        run_database_migrations(preview)
    except Exception as exc:
        raise DatasetError(f"目标数据集无法使用（预检失败）：{exc}", status_code=409) from exc
    finally:
        preview.dispose()


def _commit_switch(dataset_id: str, target: Path) -> None:
    """预检通过后的提交段（PR-03：prepare / commit / compensate）。

    prepare（调用方 ``_preview_target``）→ 本函数：
    建**目标引擎**并迁移/清理（此段失败只 dispose 新引擎，指针、旧引擎、内存
    身份原封不动）→ 写指针 → ``adopt_engine`` 接管 → 释放旧引擎 → 发布身份。

    与旧实现的关键差别：
    - 旧引擎**不过早销毁**：旧 ``rebind`` 先 dispose 再建新引擎，建失败时旧
      引擎已被拆掉；这里新引擎确认可用之后才释放旧引擎。
    - 指针写入失败时新引擎还没接管，失败保持原状态；指针写入成功后的
      ``adopt/publish`` 是纯内存操作不再失败。若进程恰在"指针已写、引擎未换"
      的崩溃窗口退出，重启由 :func:`recover_startup_pointer` 做确定性恢复。
    """
    from ..runtime import dataset_scope

    previous_engine = database.engine
    try:
        new_engine = database.build_engine(database.database_url_for(target))
    except Exception as exc:
        logger.warning("切换到数据集 %s 失败，已保持原数据集不变：%s", dataset_id, exc)
        raise DatasetError(f"目标数据集无法使用（切换失败）：{exc}", status_code=409) from exc
    try:
        # 数据集可能来自更早的版本：建表/补列/迁移要在这里补跑，否则旧表缺列会直接 500。
        if is_unversioned_legacy_database(new_engine):
            Base.metadata.create_all(bind=new_engine)
            ensure_sqlite_columns(new_engine, SQLITE_REQUIRED_COLUMNS)
        run_database_migrations(new_engine)
        cleanup_temp_directories(new_engine)
    except Exception as exc:
        new_engine.dispose()
        logger.warning("切换到数据集 %s 失败，已保持原数据集不变：%s", dataset_id, exc)
        raise DatasetError(f"目标数据集无法使用（切换失败）：{exc}", status_code=409) from exc
    try:
        write_active_dataset_id(dataset_id)
    except OSError as exc:
        new_engine.dispose()
        logger.warning("切换到数据集 %s 时写指针失败，已保持原数据集不变：%s", dataset_id, exc)
        raise DatasetError(f"写入数据集指针失败：{exc}", status_code=500) from exc
    # 提交点：指针已落盘。先接管新引擎，再释放旧引擎，最后发布新身份——
    # 三步都是内存操作，不引入新的失败模式。
    database.adopt_engine(new_engine)
    previous_engine.dispose()
    dataset_scope.publish_switch(dataset_id, new_engine)


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


def activate_dataset(dataset_id: str, bind: Engine) -> dict[str, Any]:
    """把应用切换到指定数据集（RF-03：互斥 → 排空 → 预检 → 提交段 → 发布）。

    顺序是刻意的（PR-03 prepare/commit/compensate）：**预检通过才进入提交段**
    ——预检失败时指针与引擎都保持原值；提交段内先建好并迁移目标引擎，任一步
    失败都恢复/保持一致状态（见 :func:`_commit_switch`）；"检查空闲"与"换绑"
    之间放进新任务的 TOCTOU 由 switch_lock + 租约封死（切换持锁期间
    ``acquire_lease`` 直接失败）。
    """
    if dataset_id != MAIN_DATASET_ID and not is_valid_dataset_id(dataset_id):
        raise DatasetError("数据集标识无效")
    target = dataset_database_file(dataset_id)
    if not target.exists():
        raise DatasetError("数据集文件已不存在，请刷新列表后重试", status_code=404)

    from ..runtime import dataset_scope

    with dataset_scope.switch_lock():
        dataset_scope.validate_request_scope()
        _wait_for_idle(bind)
        _preview_target(target)
        _commit_switch(dataset_id, target)

    # 新数据集的备份节奏独立计算：切换后立即唤醒备份调度做一次到期检查（RF-05）。
    from .data_backup import scheduler as auto_backup_scheduler

    auto_backup_scheduler.trigger_check()
    logger.info("已切换到数据集 id=%s path=%s", dataset_id, target.name)
    return _describe(dataset_id, target)


# 这两个动作的实现搬到了 ``datasets_admin.py``（行数预算），这里保留旧名别名：
# 既有调用方与测试都在 ``datasets`` 命名空间上引用它们。注意
# ``place_packaged_datasets`` 的第二个参数是**调用方的回收清单**（见其 docstring）。
_place_packaged_datasets = place_packaged_datasets
_discard_created_datasets = discard_created_datasets
