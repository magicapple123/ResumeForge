"""网申填表专用浏览器生命周期。

网申与投递台必须是两个相互隔离的受控浏览器：

- 不同的 CDP 端口，避免一边的导航覆盖另一边；
- 不同的 user-data-dir，避免登录态、窗口和标签页互相串线；
- 浏览器选择仍复用投递设置里的 Chrome / Edge / 自定义路径，减少重复配置。

本模块只负责网申浏览器管理，不参与表单识别与填写。
"""
from __future__ import annotations

import threading
from typing import Any

from sqlalchemy.orm import Session

from ...config import BACKEND_DIR, DEFAULT_WEBFORM_BROWSER_PORT
from ...schemas.apply import BrowserStatusOut
from ..apply._config import get_apply_config
from ..browser.browser_manager import BrowserError, BrowserManager, BrowserStatus

WEBFORM_PROFILE_DIR_NAME = "webform-browser-profile"

_manager_lock = threading.Lock()
_browser_operation_lock = threading.Lock()
_manager: BrowserManager | None = None
_manager_key: tuple[Any, ...] | None = None


def default_profile_dir():
    """网申浏览器独立的登录态与窗口配置目录。"""
    return BACKEND_DIR / "data" / WEBFORM_PROFILE_DIR_NAME


def _cache_key(config: Any) -> tuple[str, str]:
    return (str(config.browser_choice), str(config.browser_path or "").strip())


def get_browser_manager(db: Session) -> BrowserManager:
    """返回网申浏览器单例；浏览器选择变化时只重建网申这一侧。"""
    global _manager, _manager_key
    config = get_apply_config(db)
    key = _cache_key(config)
    with _manager_lock:
        if _manager is None or _manager_key != key:
            if _manager is not None:
                _manager.stop()
            _manager = BrowserManager(
                profile_dir=default_profile_dir(),
                port=DEFAULT_WEBFORM_BROWSER_PORT,
                browser_choice=config.browser_choice,
                browser_path=config.browser_path.strip() or None,
            )
            _manager_key = key
        return _manager


def _status_out(status: BrowserStatus) -> BrowserStatusOut:
    return BrowserStatusOut(
        state=status.state,
        port=status.port,
        profile_dir=status.profile_dir,
        browser_path=status.browser_path,
        browser_name=status.browser_name,
        entry_url="",
        logged_in_hint=status.logged_in_hint,
        owned=status.owned,
    )


def browser_status(db: Session) -> BrowserStatusOut:
    return _status_out(get_browser_manager(db).status())


def start_browser(db: Session) -> BrowserStatusOut:
    """启动网申浏览器，停在空白页，之后由用户自己打开目标网申页面。"""
    # 启动会先探测端口再创建进程；没有临界区时，快速连点或两个页面同时请求会
    # 同时看到"未启动"，各自拉起一个窗口。
    with _browser_operation_lock:
        manager = get_browser_manager(db)
        return _status_out(manager.start(url=None))


def open_url(db: Session, url: str) -> dict[str, Any]:
    """打开网址但不覆盖现有标签页；相同 URL 直接复用。

    这里必须把「检查 → 启动/复用 → 导航」串成一个临界区：前端快速连点时，
    两个请求若同时看到浏览器未启动，就会各自拉起一次或各自新建标签页。
    首次有目标地址时直接把它交给浏览器进程，避免先闪出一个 ``about:blank``。
    """
    wanted = str(url or "").strip()
    if not wanted:
        raise BrowserError("目标网址不能为空")

    with _browser_operation_lock:
        manager = get_browser_manager(db)
        if not manager.is_active():
            manager.start(url=wanted)
            # Chromium 会在启动参数指定的地址上创建首个页面；只读一次目标列表，
            # 让前端后续可以直接绑定到这个页面，而不是再新建一个标签页。
            targets = manager.list_page_targets()
            existing = next((item for item in targets if item.get("url") == wanted), None)
            return {
                "target_id": str(existing.get("id", "")) if existing else "",
                "url": wanted,
            }

        targets = manager.list_page_targets()
        existing = next((item for item in targets if item.get("url") == wanted), None)
        if existing is not None:
            target_id = str(existing["id"])
            client = manager.client_for_target(target_id)
            try:
                client.ensure_page_visible()
            finally:
                client.close()
            return {"target_id": target_id, "url": wanted}

        # 已经有一个空白页时优先复用它，避免用户每点一次就多一个标签页。
        blank = next(
            (
                item
                for item in targets
                if str(item.get("url", "")).strip() in {"", "about:blank"}
            ),
            None,
        )
        client = (
            manager.client_for_target(str(blank["id"]))
            if blank is not None
            else manager.client()
        )
        try:
            if blank is not None:
                target_id = str(blank["id"])
                client.navigate(wanted)
            else:
                target_id = client.new_tab(wanted)
            client.ensure_page_visible()
            return {"target_id": target_id, "url": wanted}
        finally:
            client.close()


def stop_browser(db: Session) -> None:
    """只关闭本次后端进程实际拉起的网申浏览器。"""
    with _browser_operation_lock:
        manager = get_browser_manager(db)
        status = manager.status()
        if status.state == "running" and not status.owned:
            raise BrowserError(
                "这个网申浏览器窗口不是本次运行启动的，应用不会猜进程来关闭它；请直接关闭那个窗口。"
            )
        manager.stop()


def list_page_targets(db: Session) -> list[dict[str, Any]]:
    """读取网申浏览器当前所有页面目标。"""
    return get_browser_manager(db).list_page_targets()


def client_for_target(db: Session, target_id: str):
    """创建绑定指定网申标签页的 CDP 客户端。"""
    return get_browser_manager(db).client_for_target(target_id)


def reset_browser_manager() -> None:
    """测试用：重置网申浏览器单例，不影响投递台浏览器。"""
    global _manager, _manager_key
    with _manager_lock:
        if _manager is not None:
            _manager.stop()
        _manager = None
        _manager_key = None


def reset_for_tests() -> None:
    """测试用：清理网申专用浏览器单例的可观察状态。"""
    reset_browser_manager()


__all__ = [
    "WEBFORM_PROFILE_DIR_NAME",
    "browser_status",
    "client_for_target",
    "default_profile_dir",
    "get_browser_manager",
    "list_page_targets",
    "open_url",
    "reset_browser_manager",
    "reset_for_tests",
    "start_browser",
    "stop_browser",
]
