"""快照 / 预览 / 填充路由与填充记录路由（职责④⑤）。

从 ``api/webform.py`` 拆出。服务层符号一律经 ``webform_service`` 属性访问，
保证包属性 patch（``app.api.webform.webform_service.*``、
``app.api.webform.history.*``）继续生效。"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ...database import get_db
from ...models.web_form_record import SOURCE_BATCH
from ...schemas.webform import (
    WebFormFillIn,
    WebFormFillOut,
    WebFormFillRecordOut,
    WebFormPreviewIn,
    WebFormPreviewOut,
    WebFormSnapshotOut,
)
from ...services import diagnostics
from ...services import webform as webform_service
from ...services.settings_service import get_webform_relaxed_mode
from ._shared import _raise, logger

router = APIRouter(prefix="/api/webform", tags=["webform"])


# ===== 读取 / 预览 / 填充 =====


@router.post("/snapshot", response_model=WebFormSnapshotOut)
def take_snapshot(db: Session = Depends(get_db)):
    """读取**当前标签页**上的控件清单并存档。不写页面，纯读。"""
    manager = webform_service.browser.get_browser_manager(db)
    if not manager.is_active():
        raise HTTPException(
            status_code=409,
            detail="受控浏览器还没启动，请先点「启动浏览器」并在里面打开网申页面",
        )
    try:
        snapshot, page = webform_service.read_snapshot(manager.client())
    except webform_service.WebFormError as exc:
        _raise(exc)
    diagnostics.record_event("webform.snapshot", control_count=len(snapshot.controls), title=page.get("title", ""))
    return {
        "snapshot_id": snapshot.id,
        "page": page,
    }


@router.post("/preview", response_model=WebFormPreviewOut)
async def preview(payload: WebFormPreviewIn, db: Session = Depends(get_db)):
    """把"资料 vs 页面"算成可核对的预览（规则部分**纯计算，不碰页面**）。

    配了模型且开着 AI 时，规则认不出的那些控件会**用一次调用**批量交给模型识别，
    命中的并进 ``items`` 并标成 ``source="ai"``（**默认不勾选**）。
    """
    try:
        snapshot = webform_service.get_snapshot_store().get(payload.snapshot_id)
        # build_form_data/build_preview（规则匹配是纯计算热路径）都是同步重活，
        # 下沉线程池避免阻塞事件循环；db 会话按 resume_template_import 的既有
        # 模式直接作为参数传入线程池。
        data = await run_in_threadpool(webform_service.build_form_data, db)
        # 「放宽模式」是用户设置（默认关）：开着时，点选类控件若匹配到字段+值会以
        # 「放宽代选」/「需你确认」进预览行。关着时 build_preview 行为与从前一致。
        relaxed = await run_in_threadpool(get_webform_relaxed_mode, db)
        report = await run_in_threadpool(
            webform_service.build_preview, snapshot, data, relaxed=relaxed
        )
        # 「要记下来吗」的提案。**必须在 db.close() 之前算**——它要查库，而下面那行
        # 为了 await 模型调用已经把连接关了。`data` 复用上面那一份，不再查第二次。
        learning = await run_in_threadpool(
            webform_service.extra_profile.learnable, db, report.items, data
        )
    except webform_service.WebFormError as exc:
        _raise(exc)
    # provider 要拿 db 配置，模型调用要等网络——**先取配置、关连接，再 await**。
    provider = webform_service.ai.build_provider(db) if payload.ai else None
    db.close()
    if provider is not None:
        # relaxed 与 build_preview 用同一个开关值：开启时放宽候选（点选类、规则没认出
        # 字段）也一并交给模型，命中后按放宽代选语义采纳。
        await webform_service.enrich_preview_with_ai(
            snapshot, data, report, provider, relaxed=relaxed
        )
    diagnostics.record_event(
        "webform.preview",
        control_count=len(snapshot.controls),
        matched=len(report.items),
        missing=len(report.missing_data),
        unrecognized=len(report.unrecognized),
        blocked=len(report.blocked),
    )
    return {
        "snapshot_id": snapshot.id,
        "page": {"url": snapshot.url, "title": snapshot.title, "control_count": len(snapshot.controls)},
        **report.as_dict(),
        "default_indexes": [item.index for item in webform_service.default_selections(report)],
        "learning": {"candidates": learning},
    }


@router.post("/fill", response_model=WebFormFillOut)
def fill(payload: WebFormFillIn, db: Session = Depends(get_db)):
    """按用户确认过的选择写入页面。**不提交**，写完由用户自己核对。

    严格用 ``snapshot_id`` 对应的那份快照：中间重新读页面会让用户确认的映射与落地的
    不一致，而这种不一致用户看不见。
    """
    manager = webform_service.browser.get_browser_manager(db)
    if not manager.is_active():
        raise HTTPException(status_code=409, detail="受控浏览器已关闭，请重新启动并读取表单")
    try:
        snapshot = webform_service.get_snapshot_store().get(payload.snapshot_id)
        outcomes = webform_service.apply_fill(
            manager.client(),
            snapshot,
            [
                webform_service.FillSelection(
                    index=item.index, field=item.field, value=item.value
                )
                for item in payload.items
            ],
            # 整页填充收尾复读一次：组件事后还原的"伪已填"要如实降级（见 apply_fill）。
            settle_recheck=webform_service.SETTLE_RECHECK_SECONDS,
        )
    except webform_service.WebFormError as exc:
        _raise(exc)
    counts = {"filled": 0, "unverified": 0, "failed": 0}
    reason_counts: dict[str, int] = {}
    for outcome in outcomes:
        if outcome.status in counts:
            counts[outcome.status] += 1
        if outcome.reason:
            reason_counts[outcome.reason] = reason_counts.get(outcome.reason, 0) + 1
    _record_fill(db, manager.client(), snapshot, payload, outcomes)
    diagnostics.record_event(
        "webform.fill",
        form_control_total=len(snapshot.controls),
        recognized_total=len(outcomes),
        filled=counts["filled"],
        unverified=counts["unverified"],
        failed=counts["failed"],
        reason_counts=reason_counts,
    )
    return {
        "outcomes": [outcome.__dict__ for outcome in outcomes],
        **counts,
        "reason_counts": reason_counts,
        "form_control_total": len(snapshot.controls),
        "recognized_total": len(outcomes),
    }


def _page_after_fill(client: Any, applied: dict[int, str]) -> list[dict[str, Any]]:
    """填完后重读页面，做一份可读快照：[{index, label, value, filled}]。

    **这是"我当时到底填了什么"的唯一可靠来源**：``outcomes`` 只说了成功与否，而回读校验
    （``engine._verify``）已经确认过值真的落到了页面上。重读一次代价很小（一次 evaluate），
    换来的是事后回看时能看到真实值——这正是用户要求"留下记录方便回看"的那件事。

    读失败（页面跳走、浏览器关了）不该让填充本身失败：**这里吞掉异常**，返回空快照，
    记录照样落一条（只是少了页面快照）。
    """
    try:
        controls = webform_service.FormEngine().read_controls(client)
    except Exception as error:  # noqa: BLE001 - 回看用的附加信息，不该拖垮填充
        logger.warning("填充后重读页面失败，记录里不会有页面快照：%s", error)
        return []
    rows: list[dict[str, Any]] = []
    for control in controls:
        rows.append(
            {
                "index": control.index,
                "label": control.label or control.placeholder or control.aria_label,
                "value": control.current_display(),
                "filled": control.index in applied,
            }
        )
    return rows


def _record_fill(
    db: Session,
    client: Any,
    snapshot: Any,
    payload: WebFormFillIn,
    outcomes: list[Any],
) -> None:
    """把这次填充落成一条记录。

    **落记录失败绝不能让填充看起来失败**——值已经写进页面了，那是既成事实。所以这里吞掉
    一切异常，只留一条 warning：用户宁可少一条历史，也不要"填好了却报错"这种自相矛盾的提示。
    """
    try:
        by_index = {item.index: item.field for item in payload.items}
        applied = {outcome.index for outcome in outcomes if outcome.status == "filled"}
        items = [
            {
                "index": outcome.index,
                "field": by_index.get(outcome.index, outcome.field),
                "field_label": webform_service.FIELD_LABELS.get(outcome.field, outcome.field),
                "control_label": "",
                "value": next(
                    (item.value for item in payload.items if item.index == outcome.index), ""
                ),
                "status": outcome.status,
                "detail": outcome.detail,
                "source": "rule",
            }
            for outcome in outcomes
        ]
        webform_service.history.create_record(
            db,
            url=snapshot.url,
            page_title=snapshot.title,
            items=items,
            page_snapshot=_page_after_fill(client, applied),
            source=SOURCE_BATCH,
        )
    except Exception as error:  # noqa: BLE001 - 见 docstring
        logger.warning("网申填充记录落库失败：%s", error)


# ===== 填充记录 =====
#
# 回看用：每次「填充到页面」落一条。删除走回收站（软删），彻底删除在回收站里另做。


@router.get("/records", response_model=list[WebFormFillRecordOut])
def list_records(
    limit: int = Query(default=webform_service.history.DEFAULT_LIST_LIMIT, ge=1, le=webform_service.history.MAX_LIST_LIMIT),
    db: Session = Depends(get_db),
):
    """填充记录列表（只含未删除的，最近的在最前）。"""
    return webform_service.history.list_records(db, limit=limit)


@router.get("/records/{record_id}", response_model=WebFormFillRecordOut)
def read_record(record_id: int, db: Session = Depends(get_db)):
    record = webform_service.history.record_or_none(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="填充记录不存在或已被删除")
    return record


@router.delete("/records/{record_id}", status_code=204)
def remove_record(record_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删，可恢复）。彻底删除在回收站里另做。"""
    if not webform_service.history.delete_record(db, record_id):
        raise HTTPException(status_code=404, detail="填充记录不存在或已被删除")

