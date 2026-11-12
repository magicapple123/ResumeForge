# SPDX-License-Identifier: Apache-2.0
"""首页统计接口与存储清理入口。

取数整段已下沉到 ``services/stats.dashboard_stats``（读路径第二批）：本文件只留
HTTP 关注点——路由、依赖注入、以及清理功能的**本机路径校验**。四条 SQL 的预算
约定跟着查询走，见 ``services/stats.py`` 的模块说明
（``tests/test_stats_query_budget.py`` 钉住）。
"""

import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import get_db, session_engine
from ..schemas.search import Stats
from ..services.stats import dashboard_stats

router = APIRouter(prefix="/api/stats", tags=["stats"])

# Windows 盘符路径（``C:/…``）在 POSIX 上不算绝对路径，所以单独认一次：
# 跨平台都不允许它进「在文件夹中显示」的路径参数。
_WINDOWS_DRIVE_RE = re.compile(r"^[A-Za-z]:")


@router.get("/storage")
def get_storage_stats(db: Session = Depends(get_db)) -> dict:
    """各项本地目录的磁盘占用（RF-25）：只统计体积与文件数，不返回任何文件内容。"""
    from ..services.storage_stats import storage_overview

    return storage_overview(session_engine(db))


def _cleanup_categories(raw: Any) -> set[str] | None:
    """把请求里的清理类别归一成集合。

    ``None``（没传该字段）= 全部类别；**空集合** = 用户取消全选，什么都不清。
    两种情形必须区分：把"空"当成"全部"会让取消勾选变成"更彻底地清"。
    """
    if raw is None:
        return None
    if isinstance(raw, str):
        raw = [raw]
    if not isinstance(raw, (list, tuple, set)):
        raise ValueError("categories 必须是字符串数组")
    values: list[str] = []
    for item in raw:
        if not isinstance(item, str):
            raise ValueError("categories 必须是字符串数组")
        values.extend(part.strip() for part in item.split(",") if part.strip())
    return set(values)


@router.get("/storage/cleanup-preview")
def cleanup_preview(
    older_than_days: int = Query(default=30, ge=1, le=3650),
    categories: list[str] | None = Query(
        default=None,
        description="要扫描的类别（可重复传，也可逗号分隔）：backups / backup-trash / "
        "auto-backups / logs。不传=全部；传空=什么都不清。",
    ),
) -> dict:
    """清理预览（R19）：列出超过保留期的备份与日志，只 stat 不读内容、不做任何删除。

    预览与执行吃**同一份** ``categories`` 语义与同一份 ``plan_cleanup``，所以"预览看到
    的就是执行会移走的"。未知类别返回 400 并列出合法值，而不是静默当成"全部"。
    """
    from ..services.cleanup import plan_cleanup

    try:
        selected = _cleanup_categories(categories)
        return plan_cleanup(older_than_days=older_than_days, categories=selected)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/storage/cleanup")
def cleanup_now(body: dict | None = None) -> dict:
    """执行清理（R19）：候选文件移入 ``.cleanup-trash/<时间戳>/``，永不硬删。"""
    from ..services.cleanup import DEFAULT_RETENTION_DAYS, run_cleanup

    payload = body if isinstance(body, dict) else {}
    raw = payload.get("older_than_days", DEFAULT_RETENTION_DAYS)
    try:
        days = max(1, min(3650, int(raw)))
    except (TypeError, ValueError):
        days = DEFAULT_RETENTION_DAYS
    raw_paths = payload.get("paths")
    paths: set[str] | None = None
    if raw_paths is not None:
        if not isinstance(raw_paths, (list, tuple, set)):
            raise HTTPException(status_code=400, detail="paths 必须是字符串数组")
        if any(not isinstance(item, str) for item in raw_paths):
            raise HTTPException(status_code=400, detail="paths 必须是字符串数组")
        paths = {item.strip() for item in raw_paths if item.strip()}
    try:
        selected = _cleanup_categories(payload.get("categories"))
        return run_cleanup(older_than_days=days, categories=selected, paths=paths)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


# 「在文件夹中显示」允许定位的首段目录：与 ``cleanup.CATEGORIES`` 的扫描根一致。
# 清理清单里的相对路径只会落在这三类里，别处（数据库、附件、datasets/）不允许被打开。
_CLEANUP_REVEAL_ROOTS = ("backups", "auto-backups", "logs")


def _bad_path(detail: str) -> HTTPException:
    """路径校验失败的统一出口：只写原因，引导交给前端的 ``errorGuidance``。"""
    return HTTPException(status_code=400, detail=detail)


def _cleanup_reveal_target(raw: Any) -> Path:
    """把前端回传的**相对**路径还原成本机绝对路径，并做完所有安全校验。

    校验缺一不可（顺序即先便宜的字符串检查、后碰文件系统）：

    1. 只接受数据目录下的相对路径——绝对路径（含 ``/x``、``C:/x``）一律 400，
       否则这个端点就变成一个「读任意路径存在性」的探针；
    2. 拒绝含 ``..`` 的路径：``backups/../../etc/passwd`` 解析后虽可能仍在根内，
       但「清理清单里不会出现这种路径」本身就该拒绝；
    3. ``(数据目录 / path).resolve()`` 必须仍在数据目录内：``resolve()`` 会解开
       符号链接，所以指向目录外的软链在这里被挡下（字符串比较挡不住它）；
    4. 首段白名单：请求路径与**解析后**路径的首段都必须是
       ``backups`` / ``auto-backups`` / ``logs``；
    5. 必须存在且是文件：已被清理掉的文件给 404「文件已被移走或删除」。
    """
    from ..services import cleanup

    if not isinstance(raw, str):
        raise _bad_path("path 必须是字符串")
    text = raw.strip()
    if not text:
        raise _bad_path("缺少要定位的文件路径")
    # 反斜杠统一成 POSIX 分隔符：后端回传的就是 posix 形式，兼容前端手拼的 Windows 分隔符。
    posix = text.replace("\\", "/")
    if posix.startswith("/") or posix.startswith("~") or _WINDOWS_DRIVE_RE.match(posix):
        raise _bad_path("只接受数据目录下的相对路径")
    parts = [part for part in posix.split("/") if part not in ("", ".")]
    if not parts:
        raise _bad_path("缺少要定位的文件路径")
    if ".." in parts:
        raise _bad_path("路径不能包含上级目录引用")
    if parts[0] not in _CLEANUP_REVEAL_ROOTS:
        raise _bad_path(f"只能定位这几类文件：{'、'.join(_CLEANUP_REVEAL_ROOTS)}")
    # 路径基线与 ``services/cleanup.py`` 同一份（同一个可 monkeypatch 的模块属性），
    # 否则预览里点得到、定位却落到另一个根上。
    root = cleanup._data_root().resolve()
    candidate = (root / Path(*parts)).resolve()
    if not candidate.is_relative_to(root):
        raise _bad_path("路径不在数据目录内")
    resolved_parts = candidate.relative_to(root).parts
    if not resolved_parts or resolved_parts[0] not in _CLEANUP_REVEAL_ROOTS:
        raise _bad_path(f"只能定位这几类文件：{'、'.join(_CLEANUP_REVEAL_ROOTS)}")
    if not candidate.is_file():
        raise HTTPException(status_code=404, detail="文件已被移走或删除")
    return candidate


@router.post("/storage/cleanup-reveal")
def cleanup_reveal(body: dict | None = None) -> dict:
    """在系统文件管理器里定位一个清理候选（条目 04）。

    **前端永远不传绝对路径**：``CleanupCandidate.to_dict`` 刻意只回传相对数据目录的
    POSIX 路径（绝对路径会暴露用户目录结构），这里按同一口径把它还原成本机路径再
    定位，隐私设计保持不变。
    """
    from ..services.system_reveal import reveal_path

    payload = body if isinstance(body, dict) else {}
    target = _cleanup_reveal_target(payload.get("path"))
    try:
        # Popen 发起即成功（explorer /select 成功也常返回非零退出码），这里只关心
        # 「进程起不来」：可执行文件缺失、没有权限。
        reveal_path(target)
    except OSError as exc:
        raise HTTPException(
            status_code=400, detail="无法打开系统文件管理器（文件管理器不可用或没有权限）"
        ) from exc
    return {"ok": True}


@router.get("", response_model=Stats)
def get_stats(db: Session = Depends(get_db)):
    """首页统计（数量概览 / 最近动态 / 接下来做什么）；实现在 ``services.stats``。"""
    return dashboard_stats(db)
