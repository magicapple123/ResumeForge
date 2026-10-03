"""网申填表接口（prefix ``/api/webform``）。

薄路由：只做校验、调 service、返回 schema；错误统一 ``HTTPException(status, detail=中文)``。

**这个功能只填不交**：这里没有任何"提交表单"的接口，service 层也没有对应的实现
（``tests/test_webform_no_submit.py`` 把这条钉成了不变量）。填完由用户在浏览器窗口里
自己核对并点击提交。
"""
import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ..database import SessionLocal, get_db
from ..models.web_form_record import SOURCE_BATCH
from ..schemas.webform import (
    BrowserStatusOut,
    WebFormExtraProfileIn,
    WebFormExtraProfileOut,
    WebFormFieldsOut,
    WebFormFillIn,
    WebFormFillOut,
    WebFormFillRecordOut,
    WebFormLiveEnabledIn,
    WebFormLiveIn,
    WebFormLiveOut,
    WebFormMemoryTargetsOut,
    WebFormOpenUrlIn,
    WebFormPreviewIn,
    WebFormPreviewOut,
    WebFormRememberIn,
    WebFormRememberOut,
    WebFormSnapshotOut,
    WebFormUrlHistoryListOut,
    WebFormUrlHistoryOut,
)
from ..services import webform as webform_service
from ..services.diagnostics import record_event
from ..services.webform import ai, extra_profile, history, profile_targets, url_history
from ..services.webform import live_targets, repeated_profile
from ..services.webform import browser as webform_browser
from ..services.webform.engine import FormEngine
from ..services.webform.fields import FIELD_LABELS

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webform", tags=["webform"])


def _raise(exc: webform_service.WebFormError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


# ===== 字段目录 =====


@router.get("/fields", response_model=WebFormFieldsOut)
def list_fields():
    """网申字段目录。界面由它驱动渲染——加字段只改后端常量表，不用动前端。"""
    return webform_service.list_fields()


# ===== 「网申资料」=====
#
# 用户专门为网申表单录的补充资料（四六级分数、档案所在地、紧急联系人、身高视力…），
# **简历里没有**，所以单独存在 ``web_form_profile_entry`` 里。
#
# **只给网申填表用**：简历生成读的是 ``UserProfile``，完全不经过这两个接口，所以
# "生成简历不读这里"是结构保证的。助手也读不到（理由见 ``test_assistant_coverage.py``）。


@router.get("/extra-profile", response_model=WebFormExtraProfileOut)
def read_extra_profile(db: Session = Depends(get_db)):
    """字段清单 + 已填的值 + 每条的来源与档位（清单由后端下发，前端不写死字段名）。"""
    return {
        **webform_service.list_extra_fields(db),
        "values": extra_profile.list_entries(db),
        "details": extra_profile.list_details(db),
        "repeated_groups": repeated_profile.list_groups(db),
    }


@router.put("/extra-profile", response_model=WebFormExtraProfileOut)
def write_extra_profile(payload: WebFormExtraProfileIn, db: Session = Depends(get_db)):
    """整份覆盖写入。没提到的 key 会被删除——这一屏就是「网申资料」的全部。

    ``details`` 只用于给**学到的**那几条指定来源与档位（``source`` / ``reuse``）。
    """
    try:
        extra_profile.save_entries(
            db,
            payload.values,
            details={key: entry.model_dump() for key, entry in payload.details.items()},
            commit=False,
        )
        if payload.repeated is not None:
            repeated_profile.save_groups(
                db,
                {
                    key: [record.model_dump() for record in records]
                    for key, records in payload.repeated.items()
                },
                commit=False,
            )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    return {
        **webform_service.list_extra_fields(db),
        "values": extra_profile.list_entries(db),
        "details": extra_profile.list_details(db),
        "repeated_groups": repeated_profile.list_groups(db),
    }


@router.get("/memory-targets", response_model=WebFormMemoryTargetsOut)
def list_memory_targets(db: Session = Depends(get_db)):
    """返回「记住这条」可以写入的目标。**只有「网申资料」**（理由见 profile_targets）。"""
    return {"targets": profile_targets.build_memory_targets(db)}


# ===== 浏览器 =====
#
# 网申使用独立的浏览器生命周期、CDP 端口和用户目录。这样投递台打开入口页时不会覆盖
# 用户正在填写的网申页面，两个功能可以同时使用。


@router.get("/browser/status", response_model=BrowserStatusOut)
def browser_status(db: Session = Depends(get_db)):
    status = webform_browser.browser_status(db)
    # 浏览器可能由用户直接关掉，不能只让前端看到 stopped；后台实时会话也要
    # 同步收摊，否则浏览器重新打开后页面会误以为旧监听仍然有效。
    if status.state == "stopped" and webform_service.is_live_running():
        webform_service.stop_live()
    return status


@router.post("/browser/start", response_model=BrowserStatusOut)
def browser_start(db: Session = Depends(get_db)):
    try:
        status = webform_browser.start_browser(db)
    except Exception as exc:  # noqa: BLE001 - 与投递台同一套错误映射
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 浏览器起来就**立即自动开启**智能逐项填表：历历球随首个页面注入，不用等
    # 用户发现"怎么还没出现"再手动开。失败不阻断——轮询自愈与前端兜底都在。
    try:
        _start_live_session(db)
    except Exception as exc:  # noqa: BLE001 - 页面未就绪时靠轮询自愈重装
        logger.warning("浏览器启动后自动开启实时填表失败（稍后自愈）：%s", exc)
    return status


@router.post("/browser/open-url")
def browser_open_url(payload: WebFormOpenUrlIn, db: Session = Depends(get_db)):
    try:
        url = url_history.normalize_url(payload.url)
        result = webform_browser.open_url(db, url)
        url_history.remember_url(db, url)
    except (ValueError, webform_browser.BrowserError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    # 同 browser/start：打开目标页面即自动开启实时填表，历历球随页面就绪出现。
    try:
        _start_live_session(db)
    except Exception as exc:  # noqa: BLE001 - 页面未就绪时靠轮询自愈重装
        logger.warning("打开页面后自动开启实时填表失败（稍后自愈）：%s", exc)
    return result


@router.get("/url-history", response_model=WebFormUrlHistoryListOut)
def list_url_history(db: Session = Depends(get_db)):
    return {"items": [WebFormUrlHistoryOut.model_validate(item) for item in url_history.list_urls(db)]}


@router.delete("/url-history/{item_id}", status_code=204)
def delete_url_history(item_id: int, db: Session = Depends(get_db)):
    if not url_history.delete_url(db, item_id):
        raise HTTPException(status_code=404, detail="网址历史不存在")


@router.post("/browser/stop", status_code=204)
def browser_stop(db: Session = Depends(get_db)):
    webform_browser.stop_browser(db)
    webform_service.stop_live()


# ===== 点哪个填哪个 =====
#
# 与「读取当前表单 → 批量填」是**两种并存的模式**，不是替代关系：
# - 批量适合长表单一次铺开；
# - 这个模式适合逐项核对，也能帮到批量填不了的框（自定义下拉等：告诉你去选什么，
#   但不替你点开选）。
#
# 它不做预先快照——点哪个框才现场匹配哪个框，所以不存在"页面一联动序号就失效"的问题。


@router.get("/live/status", response_model=WebFormLiveOut)
def live_status():
    return webform_service.live_status()


@router.post("/live/enabled", response_model=WebFormLiveOut)
def set_live_enabled(payload: WebFormLiveEnabledIn):
    """只切换智能逐项填表，不销毁监听会话和页面上的悬浮球。"""
    webform_service.set_live_enabled(payload.enabled)
    status = webform_service.live_status()
    record_event("webform.live_enabled", enabled=payload.enabled, running=status.get("running", False))
    return status


@router.get("/browser/targets")
def browser_targets(db: Session = Depends(get_db)):
    targets = webform_browser.list_page_targets(db)
    states = live_targets.snapshot({str(item["id"]) for item in targets})
    return {
        "items": [
            {
                **item,
                "target_id": str(item["id"]),
                "live_enabled": states.get(str(item["id"]), True),
            }
            for item in targets
        ]
    }


@router.post("/browser/targets/{target_id}/live")
def set_browser_target_live(
    target_id: str, payload: dict[str, bool], db: Session = Depends(get_db)
):
    del db
    enabled = live_targets.set_enabled(target_id, bool(payload.get("enabled", True)))
    return {"target_id": target_id, "live_enabled": enabled}


@router.post("/live/start", response_model=WebFormLiveOut)
def live_start(payload: WebFormLiveIn | None = None, db: Session = Depends(get_db)):
    return _start_live_session(db, want_ai=payload.ai if payload is not None else None)


def _start_live_session(
    db: Session, want_ai: bool | None = None, *, close_db: bool = True
) -> dict:
    """开启（或复用正在跑的）实时填表会话；浏览器与页面路由共用这段主体。

    ``start_live`` 本身是幂等的：已在跑的会话只刷新资料与客户端，不会重复注入、
    也不会再弹浏览器窗口——所以浏览器启动/打开页面后可以放心地自动调一次。
    ``want_ai=None`` 表示按默认开启 AI（未配模型时会话内部自动降级为纯规则）。
    """
    manager = webform_browser.get_browser_manager(db)
    if not manager.is_active():
        raise HTTPException(
            status_code=409,
            detail="受控浏览器还没启动，请先点「启动浏览器」并打开网申页面",
        )
    # 开着 AI 但没配模型时 `build_provider` 返回 None，会话内部把开关一并降级为关——
    # **不报错**：没配模型照样能用规则填，那是这个功能本来的样子。
    use_ai = True if want_ai is None else want_ai
    provider = ai.build_provider(db) if use_ai else None
    data = webform_service.build_live_form_data(db)
    catalog = webform_service.build_catalog(db)
    memory_targets = profile_targets.build_memory_targets(db)

    def load_live_data() -> tuple[dict[str, str], list[dict[str, str]]]:
        """每次聚焦新控件时读取最新资料，避免实时会话持有旧快照。"""
        session = SessionLocal()
        try:
            return (
                webform_service.build_live_form_data(session),
                webform_service.build_catalog(session),
            )
        finally:
            session.close()

    def load_memory_targets() -> list[dict[str, Any]]:
        """每次打开逐框记忆编辑器时读取最新的完整资料目标。"""
        session = SessionLocal()
        try:
            return profile_targets.build_memory_targets(session)
        finally:
            session.close()

    def load_live_clients() -> list[tuple[str, Any]]:
        """每轮同步网申浏览器的标签页，并为每个页面绑定独立 CDP 客户端。"""
        session = SessionLocal()
        try:
            browser = webform_browser.get_browser_manager(session)
            clients: list[tuple[str, Any]] = []
            for target in browser.list_page_targets():
                target_id = str(target.get("id") or "").strip()
                if target_id:
                    clients.append((target_id, browser.client_for_target(target_id)))
            return clients
        finally:
            session.close()

    # 「记住这条」的落库回调：会话跑在后台线程上，**不能把请求的 session 带过去**
    # （请求一返回它就关了）。这里闭一个"每次开一个一次性 session"的写入口进去。
    # 用的是单字段写入（只动用户选中的一条）而不是整体 PUT——后者是**整份覆盖**，
    # 在后台线程里用它会把用户这一屏之外的资料全删掉。
    def store_remember(entry: dict[str, str]) -> bool:
        session = SessionLocal()
        try:
            target_id = str(entry.get("target_id") or "").strip()
            label = str(entry.get("label") or "").strip()
            if not target_id:
                default = profile_targets.resolve_default_target(
                    session,
                    field_key=entry.get("key", ""),
                    label=label,
                )
                target_id = default["target_id"]
                entry["target_id"] = target_id
                entry["label"] = default["label"]
                entry["destination"] = default["location"]
            else:
                target = next(
                    (
                        item
                        for item in profile_targets.build_memory_targets(session)
                        if item.get("target_id") == target_id
                    ),
                    None,
                )
                if target is not None:
                    source = "我的资料" if target.get("source") == "profile" else "网申资料"
                    entry["destination"] = " · ".join(
                        part
                        for part in (
                            source,
                            str(target.get("group") or ""),
                            str(target.get("label") or label),
                        )
                        if part
                    )
            return profile_targets.remember_target(
                session,
                target_id=target_id,
                value=entry.get("value", ""),
                label=entry.get("label", ""),
                reuse=entry.get("reuse", "general"),
            )
        finally:
            session.close()

    if close_db:
        db.close()  # 会话会开线程跑模型调用，别占着连接池
    try:
        webform_service.start_live(
            manager.client(),
            data,
            catalog,
            provider=provider,
            ai_enabled=use_ai,
            store=store_remember,
            require_memory_choice=False,
            data_loader=load_live_data,
            memory_targets=memory_targets,
            memory_targets_loader=load_memory_targets,
            target_clients_loader=load_live_clients,
        )
    except webform_service.WebFormError as exc:
        _raise(exc)
    status = webform_service.live_status()
    record_event("webform.live_start", ai=use_ai, enabled=status.get("enabled", True))
    return status


@router.post("/live/remember", response_model=WebFormRememberOut)
def remember_live(payload: WebFormRememberIn):
    """把用户在资料选择框里明确选中的目标写入本地资料。"""
    saved = webform_service.remember_live_choice(
        target_id=payload.target_id,
        value=payload.value,
        label=payload.label,
        reuse=payload.reuse,
    )
    if not saved:
        raise HTTPException(status_code=400, detail="这条资料没有保存成功，请重新选择目标后再试")
    return {"saved": True, "live": webform_service.live_status()}


@router.post("/live/stop", response_model=WebFormLiveOut)
def live_stop():
    """停用后页面上的监听与面板都会撤掉，不会留东西在别人的页面上。"""
    webform_service.stop_live()
    return webform_service.live_status()


# ===== 读取 / 预览 / 填充 =====


@router.post("/snapshot", response_model=WebFormSnapshotOut)
def take_snapshot(db: Session = Depends(get_db)):
    """读取**当前标签页**上的控件清单并存档。不写页面，纯读。"""
    manager = webform_browser.get_browser_manager(db)
    if not manager.is_active():
        raise HTTPException(
            status_code=409,
            detail="受控浏览器还没启动，请先点「启动浏览器」并在里面打开网申页面",
        )
    try:
        snapshot, page = webform_service.read_snapshot(manager.client())
    except webform_service.WebFormError as exc:
        _raise(exc)
    record_event("webform.snapshot", control_count=len(snapshot.controls), title=page.get("title", ""))
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
        data = webform_service.build_form_data(db)
        report = webform_service.build_preview(snapshot, data)
        # 「要记下来吗」的提案。**必须在 db.close() 之前算**——它要查库，而下面那行
        # 为了 await 模型调用已经把连接关了。`data` 复用上面那一份，不再查第二次。
        learning = extra_profile.learnable(db, report.items, data)
    except webform_service.WebFormError as exc:
        _raise(exc)
    # provider 要拿 db 配置，模型调用要等网络——**先取配置、关连接，再 await**。
    provider = ai.build_provider(db) if payload.ai else None
    db.close()
    if provider is not None:
        await webform_service.enrich_preview_with_ai(snapshot, data, report, provider)
    record_event(
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
    manager = webform_browser.get_browser_manager(db)
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
        )
    except webform_service.WebFormError as exc:
        _raise(exc)
    counts = {"filled": 0, "unverified": 0, "failed": 0}
    for outcome in outcomes:
        if outcome.status in counts:
            counts[outcome.status] += 1
    _record_fill(db, manager.client(), snapshot, payload, outcomes)
    record_event(
        "webform.fill",
        form_control_total=len(snapshot.controls),
        recognized_total=len(outcomes),
        filled=counts["filled"],
        unverified=counts["unverified"],
        failed=counts["failed"],
    )
    return {
        "outcomes": [outcome.__dict__ for outcome in outcomes],
        **counts,
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
        controls = FormEngine().read_controls(client)
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
                "field_label": FIELD_LABELS.get(outcome.field, outcome.field),
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
        history.create_record(
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
    limit: int = Query(default=history.DEFAULT_LIST_LIMIT, ge=1, le=history.MAX_LIST_LIMIT),
    db: Session = Depends(get_db),
):
    """填充记录列表（只含未删除的，最近的在最前）。"""
    return history.list_records(db, limit=limit)


@router.get("/records/{record_id}", response_model=WebFormFillRecordOut)
def read_record(record_id: int, db: Session = Depends(get_db)):
    record = history.record_or_none(db, record_id)
    if record is None:
        raise HTTPException(status_code=404, detail="填充记录不存在或已被删除")
    return record


@router.delete("/records/{record_id}", status_code=204)
def remove_record(record_id: int, db: Session = Depends(get_db)):
    """移入回收站（软删，可恢复）。彻底删除在回收站里另做。"""
    if not history.delete_record(db, record_id):
        raise HTTPException(status_code=404, detail="填充记录不存在或已被删除")
