"""「点哪个填哪个」实时填表路由与 ``_start_live_session`` 会话主体（职责③）。

从 ``api/webform.py`` 拆出。服务层符号一律经 ``webform_service`` 属性访问，
保证包属性 patch（``app.api.webform.webform_service.*``）继续生效。"""

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ...database import SessionLocal, get_db
from ...schemas.webform import (
    WebFormLiveEnabledIn,
    WebFormLiveIn,
    WebFormLiveOut,
    WebFormRememberIn,
    WebFormRememberOut,
)
from ...services import diagnostics
from ...services import webform as webform_service
from ...services.settings_service import get_webform_relaxed_mode

from ._shared import _raise



router = APIRouter(prefix="/api/webform", tags=["webform"])


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
    diagnostics.record_event("webform.live_enabled", enabled=payload.enabled, running=status.get("running", False))
    return status


@router.get("/browser/targets")
def browser_targets(db: Session = Depends(get_db)):
    targets = webform_service.browser.list_page_targets(db)
    states = webform_service.live_targets.snapshot({str(item["id"]) for item in targets})
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
    enabled = webform_service.live_targets.set_enabled(target_id, bool(payload.get("enabled", True)))
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
    manager = webform_service.browser.get_browser_manager(db)
    if not manager.is_active():
        raise HTTPException(
            status_code=409,
            detail="受控浏览器还没启动，请先点「启动浏览器」并打开网申页面",
        )
    # 开着 AI 但没配模型时 `build_provider` 返回 None，会话内部把开关一并降级为关——
    # **不报错**：没配模型照样能用规则填，那是这个功能本来的样子。
    use_ai = True if want_ai is None else want_ai
    provider = webform_service.ai.build_provider(db) if use_ai else None
    data = webform_service.build_live_form_data(db)
    catalog = webform_service.build_catalog(db)
    memory_targets = webform_service.profile_targets.build_memory_targets(db)

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

    def load_autofill_data() -> dict[str, str]:
        """快捷整页填充复用主界面的批量资料口径。"""
        session = SessionLocal()
        try:
            return webform_service.build_form_data(session)
        finally:
            session.close()

    def load_relaxed_mode() -> bool:
        """「放宽模式」开关每次聚焦现读：设置页改完立刻生效，不用重启会话。"""
        session = SessionLocal()
        try:
            return get_webform_relaxed_mode(session)
        finally:
            session.close()

    def load_memory_targets() -> list[dict[str, Any]]:
        """每次打开逐框记忆编辑器时读取最新的完整资料目标。"""
        session = SessionLocal()
        try:
            return webform_service.profile_targets.build_memory_targets(session)
        finally:
            session.close()

    def load_live_clients() -> list[tuple[str, Any]]:
        """每轮同步网申浏览器的标签页，并为每个页面绑定独立 CDP 客户端。"""
        session = SessionLocal()
        try:
            browser = webform_service.browser.get_browser_manager(session)
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
                default = webform_service.profile_targets.resolve_default_target(
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
                        for item in webform_service.profile_targets.build_memory_targets(session)
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
            return webform_service.profile_targets.remember_target(
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
            autofill_data_loader=load_autofill_data,
            memory_targets=memory_targets,
            memory_targets_loader=load_memory_targets,
            target_clients_loader=load_live_clients,
            relaxed_mode_loader=load_relaxed_mode,
        )
    except webform_service.WebFormError as exc:
        _raise(exc)
    status = webform_service.live_status()
    diagnostics.record_event("webform.live_start", ai=use_ai, enabled=status.get("enabled", True))
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
