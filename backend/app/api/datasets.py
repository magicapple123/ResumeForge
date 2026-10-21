# SPDX-License-Identifier: Apache-2.0
"""数据集接口：列出、导入、切换、重命名、删除与导出。

一份数据集就是一整份数据库（岗位、资料、简历、助手会话、设置全在里面）。导入一个
备份包会**新建**一份数据集而不触碰当前正在使用的数据，用户随后自行决定是否切过去，
所以这条路径本身是可撤销的。

导入与切换都会改写用户的数据归属，因此都要求请求来自本机回环；导入还要求
``Content-Type: application/zip``——它不在 CORS 简单请求允许的类型里，跨站页面必须
先发预检，而预检只放行本机前端。
"""

import json
import logging
import zipfile
from pathlib import Path
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool

from .. import database
from ..dataset_registry import DatasetError, canonical_dataset_id
from ..runtime.log_fields import safe_log_text
from ..services.data_backup import (
    MANIFEST_MEMBER,
    BackupError,
    export_directory,
    manifest_asset_counts,
    manifest_asset_warnings,
    purge_stale_restores,
    restore_directory,
    uncovered_summary,
)
from ..services.data_backup.global_assets import (
    read_global_assets_payload,
    restore_global_assets,
)
from ..services.data_backup.global_config import read_global_llm_payload
from ..services.data_backup.naming import default_backup_stem, safe_backup_filename
from ..services.datasets import (
    activate_dataset,
    create_dataset,
    delete_dataset,
    export_all_datasets,
    export_dataset,
    import_dataset,
    list_datasets,
    rename_dataset,
)
from ..services.exporter import sanitize_filename
from ..services.global_llm_profiles import merge_exported_profiles
from ..services.sample_dataset import load_sample_dataset
from . import settings as settings_api

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings/datasets", tags=["settings"])

# 中间件按这个常量放宽请求体上限；路由改名时必须同步，否则豁免会静默失效。
IMPORT_PATH = f"{router.prefix}/import"

# 数据集 id 由后端生成，拼进路径前严格校验，避免路径穿越。
# Windows 把 .zip 映射成 application/x-zip-compressed，两种都接受。
_ZIP_CONTENT_TYPES = frozenset({"application/zip", "application/x-zip-compressed"})


def _require_loopback(request: Request) -> None:
    # 复用设置接口里的判定，保持两处口径一致（测试也会替换那一个函数）。
    if not settings_api._is_loopback_request(request):  # noqa: SLF001
        raise HTTPException(status_code=403, detail="数据集管理只允许在本机操作")


def _require_valid_id(dataset_id: str) -> str:
    try:
        return canonical_dataset_id(dataset_id)
    except DatasetError as exc:
        raise HTTPException(status_code=400, detail="数据集标识无效") from exc


def _translate(exc: Exception) -> HTTPException:
    if isinstance(exc, BackupError):
        return HTTPException(status_code=exc.status_code, detail=str(exc))
    # DatasetError 与 BackupError 同构（都有 status_code / 中文 message）。
    status = getattr(exc, "status_code", 400)
    return HTTPException(status_code=status, detail=str(exc))


@router.get("")
def read_datasets(request: Request) -> list[dict]:
    _require_loopback(request)
    return list_datasets()


class _DatasetCreateIn(BaseModel):
    """新建空数据集的请求体：只收一个自定义名称。"""

    name: str = Field(min_length=1, max_length=64)


@router.post("")
def create(request: Request, payload: _DatasetCreateIn) -> dict:
    """新建一份空数据集（自定义名称），返回描述；创建后可激活（激活后为空视图）。"""
    _require_loopback(request)
    try:
        return create_dataset(payload.name, database.engine)
    except Exception as exc:
        raise _translate(exc) from exc


@router.post("/sample/load")
def load_sample(request: Request) -> dict:
    """一键载入体验示例：新建「体验示例」数据集、写入纯虚构数据并切换过去。

    供首启动引导与首页空态调用；写的是**独立数据集**，主数据不受影响，
    用户随时可以在设置页把整份数据集删掉。
    """
    _require_loopback(request)
    try:
        return load_sample_dataset(database.engine)
    except Exception as exc:
        raise _translate(exc) from exc


@router.post("/import")
async def import_archive(request: Request) -> dict:
    """流式接收备份包并落成一份新数据集，不触碰当前数据。"""
    _require_loopback(request)
    content_type = request.headers.get("content-type", "").split(";")[0].strip().lower()
    if content_type not in _ZIP_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="请上传 ResumeForge 导出的 .zip 备份文件")

    from ..config import get_settings

    settings = get_settings()
    limit = settings.max_backup_upload_mb * 1024 * 1024
    directory = restore_directory(database.engine)
    directory.mkdir(parents=True, exist_ok=True)
    purge_stale_restores(database.engine)

    staging = directory / f"{uuid4().hex}.zip"
    received = 0
    try:
        with staging.open("wb") as target:
            async for chunk in request.stream():
                received += len(chunk)
                if received > limit:
                    raise HTTPException(
                        status_code=413,
                        detail=f"备份文件过大，最大允许 {settings.max_backup_upload_mb} MB",
                    )
                target.write(chunk)
        # zip 校验、逐成员解压、sqlite 快照复制与候选库迁移都是同步重活，
        # 下沉线程池避免导入期间整个后端无响应。
        # 附件校验默认 fail-closed：包里的附件缺失/被改过、或与本机同名文件冲突时
        # 整个导入拒绝（没有写入任何数据）。用户显式勾选"跳过有问题的附件"才走
        # allow_partial_assets 的 DB-only 路径，且问题仍会在 asset_issues 里如实返回。
        allow_partial = request.query_params.get("allow_partial_assets", "").lower() in (
            "1",
            "true",
            "yes",
        )
        created = await run_in_threadpool(
            import_dataset,
            staging,
            request.query_params.get("name", ""),
            database.engine,
            directory,
            allow_partial_assets=allow_partial,
        )
        # 全局模型配置是"数据集之外"的一份，导入失败不该把已经落盘的数据集回滚：
        # 数据集是主体，配置是附带信息，失败时如实附在返回里由界面提示。
        try:
            global_payload = read_global_llm_payload(staging)
            if global_payload is not None:
                created["global_llm"] = merge_exported_profiles(global_payload)
        except Exception as exc:  # noqa: BLE001 - 边上信息，不能扩大失败面
            logger.warning("备份包里的全局模型配置未能导入：%s", exc)
            created["global_llm"] = {"error": str(exc)}
        # 字体（格式 6）同理：属于"数据集之外"的全局资产，恢复失败**不回滚**已经落盘
        # 的数据集，只把计数与原因如实附在返回里——用户至少能看出字体没完全回来。
        try:
            assets_payload = read_global_assets_payload(staging)
            if assets_payload is not None:
                fonts = restore_global_assets(staging, assets_payload)
                created["restored_fonts"] = fonts["restored"]
                created["skipped_fonts"] = fonts["skipped"]
                created["active_font_set"] = fonts["active_set"]
                if fonts["names_added"]:
                    created["restored_font_names"] = fonts["names_added"]
                if fonts["issues"]:
                    created["font_issues"] = fonts["issues"]
        except Exception as exc:  # noqa: BLE001 - 字体是附加物，不能扩大失败面
            logger.warning("备份包里的字体未能导入：%s", exc)
            created["font_issues"] = [f"字体未能导入（{exc}）"]
    except HTTPException:
        staging.unlink(missing_ok=True)
        raise
    except Exception as exc:
        staging.unlink(missing_ok=True)
        raise _translate(exc) from exc
    finally:
        staging.unlink(missing_ok=True)

    # 格式 4 的嵌套整包返回的是 {restored, failed, summary}，没有单一 id。
    logger.info("已导入数据集 id=%s size=%s", created.get("id", ""), received)
    # 注意：**导入路径刻意不立刻回填副本**。回填要对新数据集文件开第二个引擎，
    # Windows 上会让紧接着的删除/移动失败；而且导入本身不切换激活库——用户真正
    # 开始用这份数据必然先经过「切换」，切换路径上的回填（见 activate）已经覆盖
    # 了"备份包在别的机器导出、副本还没生成"的情况。
    return created


@router.post("/{dataset_id}/activate")
def activate(request: Request, dataset_id: str) -> dict:
    """切换当前使用的数据集。

    刻意不使用 ``Depends(get_db)``：切换要释放连接池再换引擎，本请求自己持有的
    会话会在 Windows 上锁住文件。
    """
    _require_loopback(request)
    try:
        result = activate_dataset(_require_valid_id(dataset_id), database.engine)
    except Exception as exc:
        raise _translate(exc) from exc
    # 切换完成后 best-effort 回填新激活库的用户文件副本（幂等，失败只记日志）——
    # 数据集可能来自导入或旧版本，副本还没生成过。
    from ..services.user_files import schedule_backfill

    schedule_backfill()
    return result


@router.patch("/{dataset_id}")
def rename(request: Request, dataset_id: str) -> dict:
    _require_loopback(request)
    name = request.query_params.get("name", "")
    try:
        return rename_dataset(_require_valid_id(dataset_id), name)
    except Exception as exc:
        raise _translate(exc) from exc


@router.delete("/{dataset_id}", status_code=204)
def remove(request: Request, dataset_id: str) -> None:
    _require_loopback(request)
    try:
        delete_dataset(_require_valid_id(dataset_id))
    except Exception as exc:
        raise _translate(exc) from exc


@router.get("/export-all")
def export_all(
    request: Request,
    include_api_keys: bool = True,
    include_global_llm: bool = True,
    filename: str | None = Query(
        default=None,
        max_length=128,
        description="下载名（可含中文）；省略时为「全部数据集-<时间戳>.zip」",
    ),
) -> FileResponse:
    """把**全部数据集**导出为一个备份包（活动的那份 + 其余每一份）。

    与 ``/{dataset_id}/export`` 的区别是"包里有没有其余数据集"。两个都给，是因为它们
    对应两种真实意图：**迁移走**（要全部）与**单独拷一份出去**（只要那一份）。

    ``include_api_keys`` 默认**包含**密钥（决策 D-A / D5）：迁移整包时最省事，用户可在
    导出前取消勾选（显式传 ``false``）把密钥剥离。带上密钥时格式号升到 3，老版本会明确拒收。
    路由声明在 ``/{dataset_id}/export`` 之前只是习惯；两者段数不同（``/export-all`` 是一段、
    ``/{id}/export`` 是两段），本来就不会互相截胡。
    """
    _require_loopback(request)
    staging = export_directory(database.engine)
    try:
        archive_path = export_all_datasets(
            database.engine,
            staging,
            include_api_keys=include_api_keys,
            include_global_llm=include_global_llm,
        )
    except Exception as exc:
        raise _translate(exc) from exc

    logger.info(
        "已导出全部数据集 file=%s key_policy=%s",
        archive_path.name,
        "included" if include_api_keys else "excluded",
    )
    return _archive_response(
        archive_path, filename=filename, default_stem=default_backup_stem("全部数据集")
    )


@router.get("/{dataset_id}/export")
def export(
    request: Request,
    dataset_id: str,
    include_api_keys: bool = True,
    include_global_llm: bool = True,
    filename: str | None = Query(
        default=None,
        max_length=128,
        description="下载名（可含中文）；省略时为「<数据集名>-<时间戳>.zip」",
    ),
) -> FileResponse:
    """把指定数据集导出为备份包（``include_api_keys`` 语义同 ``export_all``）。"""
    _require_loopback(request)
    staging = export_directory(database.engine)
    try:
        archive_path = export_dataset(
            _require_valid_id(dataset_id),
            database.engine,
            staging,
            include_api_keys=include_api_keys,
            include_global_llm=include_global_llm,
        )
    except Exception as exc:
        raise _translate(exc) from exc

    logger.info(
        "已导出数据集 id=%s file=%s key_policy=%s",
        safe_log_text(dataset_id),
        safe_log_text(archive_path.name),
        "included" if include_api_keys else "excluded",
    )
    return _archive_response(
        archive_path,
        filename=filename,
        default_stem=default_backup_stem(_dataset_label(dataset_id)),
    )


def _dataset_label(dataset_id: str) -> str:
    """数据集在下载名里的默认称呼；查不到时用 id（导出本身仍然继续）。"""
    for item in list_datasets():
        if item["id"] == dataset_id:
            return str(item.get("name") or dataset_id)
    return dataset_id


def _archive_response(
    archive_path: Path,
    *,
    filename: str | None = None,
    default_stem: str | None = None,
) -> FileResponse:
    # 下载名与临时文件名解耦：临时文件是由后端生成的安全名字，用户看到的是他填的那个。
    download_name = safe_backup_filename(filename, default_stem=default_stem or archive_path.stem)
    headers = {
        "Content-Disposition": (
            f"attachment; filename*=UTF-8''{quote(sanitize_filename(download_name), safe='')}"
        ),
        # 备份包含全部个人数据，禁止浏览器与中间层缓存。
        "Cache-Control": "no-store",
    }
    headers.update(_incomplete_backup_headers(archive_path))
    return FileResponse(
        archive_path,
        media_type="application/zip",
        headers=headers,
        background=BackgroundTask(archive_path.unlink, missing_ok=True),
    )


def _incomplete_backup_headers(archive_path: Path) -> dict[str, str]:
    """包内已经有"不完整"或"未纳入"的信号时，在响应头里如实标出（RR-03 / P3）。

    导出响应体是二进制压缩包，没有 JSON 通道；界面若只说"已导出"就等于把一份不完整的
    备份说成完整备份。这里只放**计数**（响应头是 ASCII），细节留在包内清单里。
    """
    try:
        with zipfile.ZipFile(archive_path) as archive:
            manifest = json.loads(archive.read(MANIFEST_MEMBER))
    except (OSError, KeyError, ValueError, zipfile.BadZipFile):
        return {}
    counts = manifest_asset_counts(manifest)
    headers = {
        # 三类分开报（H2）：新缺失 / 哈希不符才叫"不完整"；导入时就缺只是说明。
        "X-Backup-Asset-Missing": str(counts["missing"]),
        "X-Backup-Asset-Mismatched": str(counts["mismatched"]),
        "X-Backup-Asset-Missing-At-Import": str(counts["missing_at_import"]),
    }
    warnings = manifest_asset_warnings(manifest)
    if warnings:
        headers["X-Backup-Incomplete"] = "1"
        headers["X-Backup-Asset-Warnings"] = str(len(warnings))
    # P3：数据目录里"没进包"的东西也要可见。未覆盖不等于导出失败（用户可能只是拷
    # 当前数据集），所以不进 X-Backup-Incomplete，单独两个计数。
    coverage = uncovered_summary(manifest)
    headers["X-Backup-Uncovered"] = str(coverage["count"])
    headers["X-Backup-Uncovered-Bytes"] = str(coverage["bytes"])
    if coverage["truncated"]:
        headers["X-Backup-Uncovered-Truncated"] = "1"
    return headers
