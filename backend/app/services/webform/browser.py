# SPDX-License-Identifier: Apache-2.0
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

from ...config import DATA_DIR, DEFAULT_WEBFORM_BROWSER_PORT
from ...schemas.apply import BrowserStatusOut
from ..apply._config import get_apply_config
from ..browser.browser_inputs import validated_browser_url
from ..browser.browser_manager import BrowserError, BrowserManager, BrowserStatus
from ..browser.cdp_client import CdpError

WEBFORM_PROFILE_DIR_NAME = "webform-browser-profile"

_manager_lock = threading.Lock()
_browser_operation_lock = threading.Lock()
_manager: BrowserManager | None = None
_manager_key: tuple[Any, ...] | None = None


def default_profile_dir():
    """网申浏览器独立的登录态与窗口配置目录（落在数据目录下，随 RF_DATA_DIR 走）。

    与投递浏览器同理：不能写进安装目录，否则升级安装会清掉登录态（ADR-0004）。
    """
    return DATA_DIR / WEBFORM_PROFILE_DIR_NAME


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


# 导航失败时给用户看的一句话。不能沿用底层异常的中文：CDP 的「Page.navigate 被页面拒绝」
# 「打开新标签页失败（HTTP 500）」这类措辞对用户没有可操作的下一步。
OPEN_URL_FAILED = "无法打开网页，请检查地址或网络后重试"


def _navigate_error_text(result: Any) -> str:
    """从 CDP Page.navigate 的返回里取出导航错误；正常导航返回空串。

    CDP 对 DNS 解析失败 / 连接被拒 / 无效端口 这类失败**不会抛异常**，而是在 result 里
    给 errorText（如 net::ERR_NAME_NOT_RESOLVED）。不读它就会把打不开的网页报成
    「已打开」——2026-10-26 实机：不存在的域名与拒绝连接的端口都拿到 200。
    """
    if not isinstance(result, dict):
        return ""
    if not result.get("errorText") or result.get("isDownload"):
        return ""
    return str(result.get("errorText"))


def _navigate_and_focus(client: Any, url: str) -> None:
    """把已绑定的标签页导航到 url、检查导航错误、并带到前台。

    CDP 的 Page.navigate 对 DNS 解析失败 / 连接被拒这类失败**不抛异常**，只在 result
    里给 errorText；不读它就会把打不开的网页报成「已打开」（2026-10-26 实机）。CDP
    异常与 errorText 统一收敛成可读的 BrowserError，调用方只需要处理"成功返回"。
    """
    try:
        result = client.navigate(url)
    except CdpError as exc:
        raise BrowserError(OPEN_URL_FAILED) from exc
    if _navigate_error_text(result):
        raise BrowserError(OPEN_URL_FAILED)
    try:
        client.ensure_page_visible()
    except CdpError as exc:
        raise BrowserError(OPEN_URL_FAILED) from exc


def open_url(db: Session, url: str) -> dict[str, Any]:
    """打开网址但不覆盖现有标签页；相同 URL 复用同一标签页并重新导航。

    这里必须把「检查 → 启动/复用 → 导航」串成一个临界区：前端快速连点时，
    两个请求若同时看到浏览器未启动，就会各自拉起一次或各自新建标签页。
    首次有目标地址时直接把它交给浏览器进程，避免先闪出一个 about:blank。

    **浏览器已经在跑时同样要过地址校验与导航错误检查**：启动路径复用
    BrowserManager.start 里的 validated_browser_url，而「复用/新开标签页」这条路径
    以前既没校验也没看 errorText，于是端口 99999、不存在的域名都会被报成打开成功
    （2026-10-26 实机复现）。两条路径的失败语义必须一致。

    **相同 URL 已存在时也要重新导航**：命中的标签页可能停在上一次失败的 Chrome 错误页
    上，旧实现命中 existing 就直接 return，把"仍然打不开"假报成 200；重新 Page.navigate
    并读 errorText 才能给出可读失败。复用语义不变——仍用同一个 target_id，不新增标签页。
    """
    wanted = str(url or "").strip()
    if not wanted:
        raise BrowserError("目标网址不能为空")
    # 协议 / 端口 / 长度 / 反斜杠：与应用内所有导航入口共用同一套校验。
    wanted = validated_browser_url(wanted)

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
                # 同 URL 复用同样要重新导航并检查 errorText：那个标签页可能停在上次
                # 失败的 Chrome 错误页上，直接 return 会把"仍然打不开"假报成已打开
                # （2026-10-26 实机）。重新导航还让用户再点一次就是重试，且**不新增
                # 标签页**——同 URL 复用语义不变。
                _navigate_and_focus(client, wanted)
            finally:
                client.close()
            return {"target_id": target_id, "url": wanted}

        # 已经有一个空白页时优先复用它，避免用户每点一次就多一个标签页。
        blank = next(
            (item for item in targets if str(item.get("url", "")).strip() in {"", "about:blank"}),
            None,
        )
        client = (
            manager.client_for_target(str(blank["id"])) if blank is not None else manager.client()
        )
        try:
            if blank is not None:
                target_id = str(blank["id"])
            else:
                # 没有空白页时**先开一个空白标签页、再用 Page.navigate 过去**，而不是把
                # 目标地址直接交给 /json/new：后者拿不到导航结果，打不开的网址会静默
                # 变成"已打开"；Page.navigate 的 errorText 才是唯一能判定的信号。
                try:
                    target_id = client.new_tab("about:blank")
                except CdpError as exc:
                    raise BrowserError(OPEN_URL_FAILED) from exc
            _navigate_and_focus(client, wanted)
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
    """读取网申浏览器当前所有页面目标。

    浏览器没启动时底层抛的是 BrowserError；浏览器刚被关掉的那一瞬可能抛 CdpError
    （HTTP 端点连不上）。两种都要收敛成可展示的 BrowserError，否则路由只能回 500
    ——前端轮询这个接口时会看到一条无信息的内部错误
    （2026-10-26 实机：停止状态下 GET /browser/targets 是 500）。
    """
    try:
        return get_browser_manager(db).list_page_targets()
    except CdpError as exc:
        raise BrowserError("无法读取网申浏览器的页面列表，请确认浏览器仍在运行") from exc


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
