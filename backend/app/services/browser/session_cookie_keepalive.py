# SPDX-License-Identifier: Apache-2.0
"""L1：会话 Cookie 续期（"专用浏览器里登录过的站点长期免登录"）。

## 为什么需要它

专用浏览器用持久 profile，所以**带过期时间**的 Cookie 本来就能跨重启活下来；丢的是
**会话 Cookie**（没有 ``expires``，浏览器进程正常退出时按规范直接丢弃）。实测本机
profile 的 ``Preferences.profile.exit_type`` 是 ``Crashed``，说明上次就没干净退出——
光靠 ``stop()`` 钩子兜不住，运行期定时扫描是必需的。

做法：``Storage.getCookies`` 找出 ``session == true``（或 ``expires <= 0``）的那些，
用 ``Network.setCookie`` 按**原属性**写回，只把 ``expires`` 换成 ``now + days*86400``。
Cookie 从此变成持久 Cookie，关浏览器 / 关应用 / 重启系统都还在。

## 五条不能省的细节

1. **``__Host-`` 前缀**：必须 ``path="/"``、``secure=true``、**不带 domain**（否则
   Chromium 直接拒绝，而且回执里只给一个 ``success=false``）。这里改成用 ``url``
   指定宿主，让写回去的仍是 host-only Cookie。
2. **``__Secure-`` 前缀**：``secure`` 必须为真。
3. **``partitionKey`` 必须原样带回**：漏了它会写成一条**新的普通 Cookie**，分区 Cookie
   既没被续期、还多出一条影子 Cookie——这是最容易漏、也最难在日志里看出来的一条。
4. **同一条 Cookie 只写一次**：60 秒是**扫描**频率，不是写入频率。每分钟重写一遍
   Cookie 库既磨损 profile（SQLite 写放大），也没有任何额外收益。判重键是
   ``(domain, name, value)``。
5. **任何异常都不能阻断关闭**：这里是"关浏览器"链路上的一环，抛出去就会让
   ``stop()`` 半路中断、浏览器进程留在那里。

## 代价（必须写进文档，不能承诺"永久免登录"）

延长会话 Cookie 的生命周期 = 延长"拿到本机 profile 就能用你的登录态"的窗口；而服务端
会话到期、IP / 设备绑定、站点主动踢下线都不是客户端能解决的。
"""

from __future__ import annotations

import contextlib
import json
import logging
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from ...models.setting import AppSetting
from .cookie_migration import cookie_transfer_params

logger = logging.getLogger(__name__)

#: 扫描频率（秒）。**不是**写入频率，见模块说明第 4 条。
SESSION_COOKIE_SCAN_SECONDS = 60.0
#: 续期后的有效期（天）默认值与允许值。只接受这三档，其余一律落回默认。
DEFAULT_SESSION_COOKIE_DAYS = 90
ALLOWED_SESSION_COOKIE_DAYS: tuple[int, ...] = (30, 90, 365)
#: 停止线程时等待 join 的上限（秒）。扫描本身是一次 CDP 往返，正常远低于它。
_KEEPALIVE_JOIN_SECONDS = 5.0

KEY_KEEP_SESSION_COOKIES = "browser.keep_session_cookies"
KEY_SESSION_COOKIE_DAYS = "browser.session_cookie_days"
#: 一次性说明：值 = 功能**首次真正生效**的时刻（ISO）。展示方读完调
#: :func:`mark_notice_delivered` 写下面那个键，两个键都在 AppSetting 里，不建表。
#: **正文不在这里**：展示文案只有前端 i18n 一份（`applyUi.loginStatus.keepSessionNotice`），
#: 后端只给天数——在这里再放一份中文模板，英文界面就会漏中文，而且两份迟早不同步。
KEY_NOTICE_FIRST_EFFECTIVE = "browser.keep_session_cookies.notice"
KEY_NOTICE_DELIVERED = "browser.keep_session_cookies.notice_delivered"


@dataclass(frozen=True)
class SessionCookiePolicy:
    """续期开关与有效期（来自设置）。"""

    enabled: bool = True
    days: int = DEFAULT_SESSION_COOKIE_DAYS

    def normalized_days(self) -> int:
        return (
            self.days if self.days in ALLOWED_SESSION_COOKIE_DAYS else DEFAULT_SESSION_COOKIE_DAYS
        )


@dataclass
class SessionCookiePromotion:
    """一次扫描的结果（同时用于日志与证据文件）。"""

    scanned: int = 0
    promoted: int = 0
    skipped_seen: int = 0
    failed: int = 0
    #: 被续期的 Cookie，``"<domain>|<name>"``；只记名字，不记值（值就是登录凭据本身）。
    names: list[str] = field(default_factory=list)
    error: str = ""

    def as_dict(self) -> dict[str, Any]:
        return {
            "scanned": self.scanned,
            "promoted": self.promoted,
            "skipped_seen": self.skipped_seen,
            "failed": self.failed,
            "names": list(self.names),
            "error": self.error,
        }


def _as_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def needs_promotion(cookie: Mapping[str, Any]) -> bool:
    """这条 Cookie 是不是"会话 Cookie"（没有过期时间）。"""
    if bool(cookie.get("session")):
        return True
    return _as_float(cookie.get("expires")) <= 0


def cookie_key(cookie: Mapping[str, Any]) -> tuple[str, str, str]:
    """判重键 ``(domain, name, value)``——值变了说明用户重新登录过，要再续一次。"""
    return (
        str(cookie.get("domain") or ""),
        str(cookie.get("name") or ""),
        str(cookie.get("value") or ""),
    )


def set_cookie_params(
    cookie: Mapping[str, Any], days: int, *, now: float | None = None
) -> dict[str, Any]:
    """把一条会话 Cookie 转成 ``Network.setCookie`` 的参数（保留全部原属性）。

    属性保真规则只有一份实现（:func:`cookie_migration.cookie_transfer_params`），
    这里只负责把 ``expires`` 换成 ``now + days*86400``——两条链路各写一份前缀规则，
    迟早有一条会漏掉 ``partitionKey``。``now`` 可注入，便于离线断言确切数值。
    """
    return cookie_transfer_params(
        cookie, expires=int((now if now is not None else time.time()) + days * 86400)
    )


def promote_session_cookies(
    client: Any,
    days: int,
    *,
    now: float | None = None,
    seen: set[tuple[str, str, str]] | None = None,
) -> SessionCookiePromotion:
    """扫一次会话 Cookie 并用 ``Network.setCookie`` 续期。

    **不抛异常**：扫描失败只会让本次续期没发生（下一次扫描再来），而抛出去会打断
    关闭流程。单条失败只记 debug 并继续下一条。

    Args:
        client: 已连上的 CDP 客户端（浏览器级或页面级都可，两个域都能下命令）。
        days: 续期后的有效期（天）。
        now: 当前时间戳（可注入）。
        seen: 已处理过的 ``(domain, name, value)`` 集合；传入时会就地累加。

    Returns:
        :class:`SessionCookiePromotion`，含扫描数 / 成功数 / 跳过数 / 失败数与 Cookie 名。
    """
    report = SessionCookiePromotion()
    try:
        result = client.send("Storage.getCookies", {})
    except Exception as exc:  # noqa: BLE001 - 续期失败必须降级，不能打断关闭
        report.error = type(exc).__name__
        logger.debug("读取 Cookie 失败，本次跳过续期 error=%s", report.error)
        return report
    cookies = result.get("cookies") if isinstance(result, Mapping) else None
    if not isinstance(cookies, list):
        report.error = "no-cookies-field"
        return report
    report.scanned = len(cookies)

    for cookie in cookies:
        if not isinstance(cookie, Mapping) or not needs_promotion(cookie):
            continue
        key = cookie_key(cookie)
        if seen is not None and key in seen:
            report.skipped_seen += 1
            continue
        params = set_cookie_params(cookie, days, now=now)
        try:
            written = client.send("Network.setCookie", params)
        except Exception as exc:  # noqa: BLE001 - 单条失败继续下一条
            report.failed += 1
            logger.debug(
                "续期 Cookie 失败 name=%s error=%s", params.get("name"), type(exc).__name__
            )
            continue
        if isinstance(written, Mapping) and written.get("success") is False:
            report.failed += 1
            logger.debug("续期 Cookie 被拒绝 name=%s", params.get("name"))
            continue
        report.promoted += 1
        report.names.append(f"{str(cookie.get('domain') or '')}|{params['name']}")
        if seen is not None:
            seen.add(key)
    return report


# ===== 设置读写（AppSetting KV，不建表）=====


def _read_json(db: Session, key: str, fallback: Any) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return fallback
    try:
        return json.loads(row.value)
    except (TypeError, ValueError):
        return fallback


def _write(db: Session, key: str, value: str) -> None:
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value
    db.commit()


def read_policy(db: Session) -> SessionCookiePolicy:
    """读续期开关与天数；缺行 / 值坏了都退回默认（默认开、90 天）。"""
    enabled = _read_json(db, KEY_KEEP_SESSION_COOKIES, True)
    days = _read_json(db, KEY_SESSION_COOKIE_DAYS, DEFAULT_SESSION_COOKIE_DAYS)
    return SessionCookiePolicy(
        enabled=enabled is not False,
        days=days if isinstance(days, int) else DEFAULT_SESSION_COOKIE_DAYS,
    )


def write_policy(
    db: Session, *, enabled: bool | None = None, days: int | None = None
) -> SessionCookiePolicy:
    """写开关 / 天数（设置接口与测试共用）。天数越界直接拒绝，不悄悄改小。"""
    if enabled is not None:
        _write(db, KEY_KEEP_SESSION_COOKIES, json.dumps(bool(enabled)))
    if days is not None:
        if days not in ALLOWED_SESSION_COOKIE_DAYS:
            raise ValueError(f"保持登录天数只能是 {ALLOWED_SESSION_COOKIE_DAYS} 之一")
        _write(db, KEY_SESSION_COOKIE_DAYS, json.dumps(int(days)))
    return read_policy(db)


def read_notice(db: Session) -> str:
    """一次性说明的"首次生效时刻"；空串表示还没生效过、无可展示。"""
    row = db.get(AppSetting, KEY_NOTICE_FIRST_EFFECTIVE)
    return row.value if row is not None else ""


def notice_delivered(db: Session) -> bool:
    """说明是否**已经**展示过（与 :func:`mark_notice_delivered` 成对，只读不写）。

    展示方每次打开面板都要先问一次：说明是"一次性"的，但它是否已经给过用户
    只由这个键决定——前端不缓存、也不自己记，否则换设备/清缓存后会再弹一遍。
    """
    return db.get(AppSetting, KEY_NOTICE_DELIVERED) is not None


def mark_notice_delivered(db: Session) -> bool:
    """标记说明已展示给用户；返回这次是否真的写了（重复调用返回 False）。"""
    if (db.get(AppSetting, KEY_NOTICE_DELIVERED)) is not None:
        return False
    _write(db, KEY_NOTICE_DELIVERED, json.dumps(True))
    return True


def _policy_from_database() -> SessionCookiePolicy:
    """后台线程用的读取口：自己开一次会话，失败就用默认策略。"""
    try:
        from ...database import SessionLocal

        with SessionLocal() as db:
            return read_policy(db)
    except Exception:  # noqa: BLE001 - 读设置失败不能停掉续期（默认就是开）
        logger.debug("读取会话 Cookie 续期设置失败，使用默认值", exc_info=True)
        return SessionCookiePolicy()


def _mark_first_effective() -> None:
    """记下"功能首次真正生效"的时刻（只写一次，后台线程用）。"""
    try:
        from ...database import SessionLocal

        with SessionLocal() as db:
            if db.get(AppSetting, KEY_NOTICE_FIRST_EFFECTIVE) is not None:
                return
            _write(db, KEY_NOTICE_FIRST_EFFECTIVE, time.strftime("%Y-%m-%dT%H:%M:%S"))
    except Exception:  # noqa: BLE001 - 说明标记写不进去不该影响续期
        logger.debug("写入保持登录的一次性说明标记失败", exc_info=True)


class SessionCookieKeepalive:
    """L1 的生命周期挂钩：浏览器跑起来就开始定期续期，关闭前再续最后一次。

    作为 ``BrowserManager`` 的 hook 使用（``on_running`` / ``on_stopping``）：
    线程由 :meth:`on_running` 起、由 :meth:`on_stopping` **先停线程、再做最后一次续期**，
    而 ``BrowserManager.stop()`` 在发 CDP ``Browser.close`` 之前调用 ``on_stopping``——
    于是顺序天然是「停线程 → 续期 → Browser.close」（这条顺序有单测按调用序列断言）。

    :attr:`events` 是给断言与证据用的**有序**事件表，不参与业务判断。
    """

    def __init__(
        self,
        *,
        policy: Callable[[], SessionCookiePolicy] | None = None,
        interval_seconds: float = SESSION_COOKIE_SCAN_SECONDS,
        clock: Callable[[], float] = time.time,
        on_first_effective: Callable[[], None] | None = None,
    ) -> None:
        self._policy = policy or _policy_from_database
        self._interval = max(1.0, float(interval_seconds))
        self._clock = clock
        self._on_first_effective = on_first_effective or _mark_first_effective
        self._seen: set[tuple[str, str, str]] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        #: 有序事件表（``scan-promoted:N`` / ``stop-thread`` / ``final-promote`` …）。
        self.events: list[str] = []
        self.last_report = SessionCookiePromotion()

    # ===== 对外状态 =====

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    @property
    def seen_count(self) -> int:
        return len(self._seen)

    # ===== 生命周期挂钩 =====

    def on_running(self, manager: Any) -> None:
        """浏览器进入 running：按当前设置决定要不要起扫描线程。"""
        try:
            policy = self._policy()
        except Exception:  # noqa: BLE001 - 读不到设置就按默认（开）
            policy = SessionCookiePolicy()
        if not policy.enabled:
            self._record("disabled")
            return
        with self._lock:
            if self.running:
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._loop, args=(manager,), name="rf-session-cookie-keepalive", daemon=True
            )
            self._thread.start()
        self._record("thread-started")

    def on_stopping(self, manager: Any) -> None:
        """关闭前：**先停线程**，再做最后一次续期（顺序见类说明）。"""
        self._stop_thread()
        # _promote 自己会在 events 里记 ``final-promote:N``，这里不要再记一次。
        self._promote(manager, final=True)

    def stop_thread_only(self) -> None:
        """只停线程、不做续期（异常路径与测试用）。"""
        self._stop_thread()

    # ===== 内部实现 =====

    def _record(self, event: str) -> None:
        with self._lock:
            self.events.append(event)
            del self.events[:-64]  # 事件表只留最近若干条，长跑不涨内存

    def _stop_thread(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=_KEEPALIVE_JOIN_SECONDS)
        self._thread = None
        self._record("stop-thread")

    def _loop(self, manager: Any) -> None:
        while not self._stop.wait(self._interval):
            if self._stop.is_set():  # pragma: no cover - wait 已返回 True
                break
            self._promote(manager)

    def scan_once(self, manager: Any) -> SessionCookiePromotion:
        """同步跑一次扫描（测试与手动触发用）。设置关闭时**零 CDP 调用**。"""
        return self._promote(manager)

    def _promote(self, manager: Any, *, final: bool = False) -> SessionCookiePromotion:
        """一次"读设置 → 连客户端 → 续期"。

        客户端只在需要时创建：设置关闭时一行 CDP 都不发（单测断言调用次数为 0）。
        """
        try:
            policy = self._policy()
        except Exception:  # noqa: BLE001
            policy = SessionCookiePolicy()
        if not policy.enabled:
            self._record("disabled")
            return SessionCookiePromotion()
        client: Any | None = None
        try:
            client = manager.client()
        except Exception as exc:  # noqa: BLE001 - 浏览器没跑 / 连接失败都只是本轮跳过
            self._record(f"no-client:{type(exc).__name__}")
            return SessionCookiePromotion(error=type(exc).__name__)
        if client is None:
            # 与异常同一种处理：这一轮跳过，别让线程带着 AttributeError 死掉。
            self._record("no-client:none")
            return SessionCookiePromotion(error="no-client")
        try:
            report = promote_session_cookies(
                client, policy.normalized_days(), now=self._clock(), seen=self._seen
            )
        finally:
            with contextlib.suppress(Exception):
                client.close()
        self.last_report = report
        if report.promoted:
            self._record(f"{'final-' if final else ''}promote:{report.promoted}")
            if not final:
                self._on_first_effective()
        return report


__all__ = [
    "ALLOWED_SESSION_COOKIE_DAYS",
    "DEFAULT_SESSION_COOKIE_DAYS",
    "KEY_KEEP_SESSION_COOKIES",
    "KEY_NOTICE_DELIVERED",
    "KEY_NOTICE_FIRST_EFFECTIVE",
    "KEY_SESSION_COOKIE_DAYS",
    "SESSION_COOKIE_SCAN_SECONDS",
    "SessionCookieKeepalive",
    "SessionCookiePolicy",
    "SessionCookiePromotion",
    "cookie_key",
    "mark_notice_delivered",
    "needs_promotion",
    "notice_delivered",
    "promote_session_cookies",
    "read_notice",
    "read_policy",
    "set_cookie_params",
    "write_policy",
]
