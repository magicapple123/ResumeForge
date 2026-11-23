# SPDX-License-Identifier: Apache-2.0
"""K2：BOSS 直聘保活访问（后台标签，不抢焦点、不拉新窗口）。

## 为什么还需要它

L1（会话 Cookie 续期）对 BOSS **不生效**：BOSS 的登录令牌（``bst`` / ``zp_at`` / ``wt2``
/ ``wbg``）本来就是持久 Cookie，约 7 天过期；``bst`` 是不透明令牌（130B，不是 JWT），
把它改成 90 天很可能不会延长**服务端**有效期——所以不做 K3（延长 Cookie），也不做
K1（接受 7 天）。唯一有把握的是让站点自己刷新令牌：**定期用真实登录态访问一次首页**。

## 做法与边界

- 只在**投递浏览器已经在运行**时动作；没运行就跳过（绝不为保活单独拉起窗口）。
- 每 6 小时检查一次；距上次实际访问 ≥ 24 小时才真访问（失败也一样，不重试轰炸）。
- ``Target.createTarget(url=..., background=True)`` → 等页面就绪（复用
  :func:`page_ready.wait_for_page_state`）→ ``Target.closeTarget``。**只加载首页，不点任何东西**。
- 判定：出现登录框 → ``login_required``；出现验证码 → ``captcha``，**不自动破解**，退避
  3 天。失败只记结果，不阻塞投递、也不升级成"登录失效"（避免误报）。
- 设置 ``apply.boss_keepalive`` 默认开；关闭后**零 CDP 调用**。首次真正访问时写一条
  一次性说明（会真实访问 zhipin.com，用户有权事先知道）。

## 尚未验证的风险（必须如实写在文档里）

后台标签会不会被 BOSS 判定为"不活跃"从而不刷新 ``bst``，只能实测（至少跨一个 7 天
周期）。真无效就退到"可见标签短暂打开"，不能假装有效。
"""

from __future__ import annotations

import contextlib
import json
import logging
import threading
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy.orm import Session

from ...models.setting import AppSetting
from .page_ready import ReadyWait, wait_for_page_state

logger = logging.getLogger(__name__)

#: 检查频率（应用运行期间）与两次实际访问之间的最小间隔。
CHECK_INTERVAL_SECONDS = 6 * 3600.0
MIN_VISIT_INTERVAL = timedelta(hours=24)
#: 出现验证码后的退避：不破解、不重试轰炸。
CAPTCHA_BACKOFF = timedelta(days=3)
#: 等首页就绪的预算。BOSS 首屏有广告与异步渲染，给（比默认稍长的）15 秒。
READY_TIMEOUT_SECONDS = 15.0
_JOIN_SECONDS = 5.0

RESULT_OK = "ok"
RESULT_LOGIN_REQUIRED = "login_required"
RESULT_CAPTCHA = "captcha"
RESULT_ERROR = "error"

KEY_BOSS_KEEPALIVE = "apply.boss_keepalive"
KEY_LAST_AT = "apply.boss_keepalive.last_at"
KEY_LAST_RESULT = "apply.boss_keepalive.last_result"
#: 一次性说明：值 = 首次真实访问的时刻（ISO）。
KEY_NOTICE_FIRST_VISIT = "apply.boss_keepalive.notice"
KEY_NOTICE_DELIVERED = "apply.boss_keepalive.notice_delivered"

BOSS_KEEPALIVE_NOTICE = (
    "已开启 BOSS 保活：应用每天会在后台打开一次 BOSS 直聘首页（只加载页面、不点任何东西），"
    "让登录状态尽量长期有效。可在投递设置里关闭。"
)


def boss_entry_url() -> str:
    """保活要访问的地址。直接复用站点适配器里的常量，别在第二处写一遍 URL。"""
    from ..sites.boss_page import BOSS_ENTRY_URL

    return BOSS_ENTRY_URL


@dataclass(frozen=True)
class BossKeepaliveState:
    """保活的开关与上次结果（读自 AppSetting）。"""

    enabled: bool = True
    last_at: str = ""
    last_result: str = ""

    def last_at_dt(self) -> datetime | None:
        raw = (self.last_at or "").strip()
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            return None

    def is_due(self, *, now: datetime | None = None) -> bool:
        """现在该不该真访问一次。

        两道闸门：验证码退避 3 天；其余情况（含失败）一律 ≥ 24 小时才再试一次。
        ``last_at`` 缺失或不可解析时视为"从没访问过"——该跑。
        """
        if not self.enabled:
            return False
        last = self.last_at_dt()
        if last is None:
            return True
        interval = CAPTCHA_BACKOFF if self.last_result == RESULT_CAPTCHA else MIN_VISIT_INTERVAL
        return (now or datetime.now()) - last >= interval


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


def read_state(db: Session) -> BossKeepaliveState:
    """读开关与上次结果；缺行 = 默认开、从没访问过。"""
    enabled = _read_json(db, KEY_BOSS_KEEPALIVE, True)
    last_at = db.get(AppSetting, KEY_LAST_AT)
    last_result = db.get(AppSetting, KEY_LAST_RESULT)
    return BossKeepaliveState(
        enabled=enabled is not False,
        last_at=last_at.value if last_at is not None else "",
        last_result=last_result.value if last_result is not None else "",
    )


def write_enabled(db: Session, enabled: bool) -> BossKeepaliveState:
    """开 / 关保活（设置接口与测试共用）。"""
    _write(db, KEY_BOSS_KEEPALIVE, json.dumps(bool(enabled)))
    db.commit()
    return read_state(db)


def write_result(db: Session, result: str, *, now: datetime | None = None) -> BossKeepaliveState:
    """记一次访问结果。失败也记：节流按"上次访问"算，不是按"上次成功"算。"""
    if result not in {RESULT_OK, RESULT_LOGIN_REQUIRED, RESULT_CAPTCHA, RESULT_ERROR}:
        raise ValueError(f"未知的保活结果：{result!r}")
    stamp = (now or datetime.now()).isoformat(timespec="seconds")
    _write(db, KEY_LAST_AT, stamp)
    _write(db, KEY_LAST_RESULT, result)
    db.commit()
    return read_state(db)


def read_notice(db: Session) -> str:
    row = db.get(AppSetting, KEY_NOTICE_FIRST_VISIT)
    return row.value if row is not None else ""


def mark_notice_delivered(db: Session) -> bool:
    if db.get(AppSetting, KEY_NOTICE_DELIVERED) is not None:
        return False
    _write(db, KEY_NOTICE_DELIVERED, json.dumps(True))
    db.commit()
    return True


# ===== CDP：后台标签访问一次首页 =====


def probe_script() -> str:
    """首页状态探针：``url`` / ``ready`` / 是否出现登录框或验证码。

    **判可见性，不判存在性**：BOSS 把登录弹窗的整套模板写在页面标记里、默认隐藏
    （详见 ``sites/boss_page._blocker_js``）。只看 ``querySelector`` 会把正常首页判成
    「需要登录」，保活就会天天报 ``login_required``——比不做还糟。
    """
    from ..sites.boss_page import SELECTOR_CAPTCHA, SELECTOR_LOGIN

    return "".join(
        [
            "(() => { /* rf:boss-keepalive */\n",
            f"  const CAPTCHA = {json.dumps(SELECTOR_CAPTCHA)};\n",
            f"  const LOGIN = {json.dumps(SELECTOR_LOGIN)};\n",
            "  const shown = (sel) => [...document.querySelectorAll(sel)]\n",
            "    .some((node) => !!(node && node.getClientRects().length));\n",
            "  return JSON.stringify({\n",
            "    url: location.href,\n",
            "    ready: document.readyState,\n",
            "    captcha: shown(CAPTCHA),\n",
            "    login_required: shown(LOGIN),\n",
            "  });\n",
            "})()",
        ]
    )


def classify(state: dict[str, Any]) -> str:
    """页面状态 → 结果值。验证码优先（它比登录框更能解释"为什么没登录"）。"""
    if not state:
        return RESULT_ERROR
    if state.get("captcha"):
        return RESULT_CAPTCHA
    if state.get("login_required"):
        return RESULT_LOGIN_REQUIRED
    return RESULT_OK


class _KeepaliveTimeout(RuntimeError):
    """等首页就绪超时（内部异常，最终收敛成 ``error``）。"""


def _parse_state(value: Any) -> dict[str, Any]:
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except ValueError:
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return value if isinstance(value, dict) else {}


def _wait_ready(page: Any, *, timeout_seconds: float) -> dict[str, Any]:
    """等首页可用；出现登录框 / 验证码立刻返回（不必等满预算）。"""

    def _is_ready(state: dict[str, Any]) -> bool:
        return bool(
            state.get("ready") == "complete" or state.get("captcha") or state.get("login_required")
        )

    return wait_for_page_state(
        lambda: _parse_state(page.evaluate(probe_script())),
        is_ready=_is_ready,
        on_timeout=lambda _state: _KeepaliveTimeout(),
        config=ReadyWait(timeout=timeout_seconds),
    )


def visit_once(manager: Any, *, timeout_seconds: float = READY_TIMEOUT_SECONDS) -> str:
    """在已运行的投递浏览器里开一个**后台**标签访问 BOSS 首页，读完就关。

    返回 ``ok`` / ``login_required`` / ``captcha`` / ``error``。**不抛异常**：保活失败
    只是记一个结果，不能影响投递任务，也不能让调用线程死掉。
    """
    target_id = ""
    client: Any | None = None
    try:
        client = manager.client()
        if client is None:
            # 管理器可能还没连上（窗口刚关/正在重启）：当成一次失败的访问，不抛。
            return RESULT_ERROR
        created = client.send("Target.createTarget", {"url": boss_entry_url(), "background": True})
        target_id = str((created or {}).get("targetId") or "")
        if not target_id:
            return RESULT_ERROR
        page = manager.client_for_target(target_id)
        try:
            state = _wait_ready(page, timeout_seconds=timeout_seconds)
        finally:
            with contextlib.suppress(Exception):
                page.close()
        return classify(state)
    except Exception as exc:  # noqa: BLE001 - 访问失败只记结果
        logger.debug("BOSS 保活访问失败 error=%s", type(exc).__name__)
        return RESULT_ERROR
    finally:
        if client is not None:
            if target_id:
                # 后台标签必须关掉：留着就是用户窗口里多出一个他没开的页。
                with contextlib.suppress(Exception):
                    client.send("Target.closeTarget", {"targetId": target_id})
            with contextlib.suppress(Exception):
                client.close()


def _state_from_database() -> BossKeepaliveState:
    try:
        from ...database import SessionLocal

        with SessionLocal() as db:
            return read_state(db)
    except Exception:  # noqa: BLE001
        logger.debug("读取 BOSS 保活设置失败，使用默认值", exc_info=True)
        return BossKeepaliveState()


def _write_result_to_database(result: str, now: datetime | None = None) -> None:
    try:
        from ...database import SessionLocal

        with SessionLocal() as db:
            write_result(db, result, now=now)
            if db.get(AppSetting, KEY_NOTICE_FIRST_VISIT) is None:
                _write(
                    db,
                    KEY_NOTICE_FIRST_VISIT,
                    (now or datetime.now()).isoformat(timespec="seconds"),
                )
                db.commit()
    except Exception:  # noqa: BLE001 - 结果写不进去不该让线程死掉
        logger.debug("写入 BOSS 保活结果失败", exc_info=True)


class BossKeepalive:
    """K2 的生命周期挂钩：投递浏览器运行期间每 6 小时检查一次。"""

    def __init__(
        self,
        *,
        state_reader: Callable[[], BossKeepaliveState] | None = None,
        result_writer: Callable[[str], None] | None = None,
        interval_seconds: float = CHECK_INTERVAL_SECONDS,
        timeout_seconds: float = READY_TIMEOUT_SECONDS,
        clock: Callable[[], datetime] = datetime.now,
    ) -> None:
        self._state = state_reader or _state_from_database
        self._write_result = result_writer or _write_result_to_database
        self._interval = max(1.0, float(interval_seconds))
        self._timeout = max(1.0, float(timeout_seconds))
        self._clock = clock
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._lock = threading.Lock()
        #: 有序事件表（给断言与证据用）：``not-running`` / ``not-due`` / ``result:ok`` …
        self.events: list[str] = []

    @property
    def running(self) -> bool:
        return self._thread is not None and self._thread.is_alive()

    def on_running(self, manager: Any) -> None:
        """投递浏览器进入 running：按当前设置决定要不要起检查线程。"""
        try:
            state = self._state()
        except Exception:  # noqa: BLE001
            state = BossKeepaliveState()
        if not state.enabled:
            self._record("disabled")
            return
        with self._lock:
            if self.running:
                return
            self._stop.clear()
            self._thread = threading.Thread(
                target=self._loop, args=(manager,), name="rf-boss-keepalive", daemon=True
            )
            self._thread.start()
        self._record("thread-started")

    def on_stopping(self, manager: Any) -> None:  # noqa: ARG002 - 协议要求同名参数
        """关闭前只停线程：保活不需要"最后一次"（一天一次，没有收尾动作）。"""
        self._stop_thread()

    def stop_thread_only(self) -> None:
        self._stop_thread()

    def check_once(self, manager: Any) -> str:
        """同步检查一次，返回 ``disabled`` / ``not-running`` / ``not-due`` / 结果值。

        三道闸门都在**创建任何 CDP 客户端之前**：浏览器没跑、设置关了、还没到期，
        都是零调用（单测直接断言 CDP 调用次数为 0）。
        """
        state = self._state()
        if not state.enabled:
            self._record("disabled")
            return "disabled"
        if not manager.is_running():
            self._record("not-running")
            return "not-running"
        if not state.is_due(now=self._clock()):
            self._record("not-due")
            return "not-due"
        result = visit_once(manager, timeout_seconds=self._timeout)
        try:
            self._write_result(result)
        except Exception:  # noqa: BLE001 - 写结果失败不影响本次判定
            logger.debug("记录 BOSS 保活结果失败", exc_info=True)
        self._record(f"result:{result}")
        if result in {RESULT_LOGIN_REQUIRED, RESULT_CAPTCHA}:
            logger.info("BOSS 保活结果=%s（不会自动处理验证码，必要时退避 3 天）", result)
        return result

    def _record(self, event: str) -> None:
        with self._lock:
            self.events.append(event)
            del self.events[:-64]

    def _stop_thread(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join(timeout=_JOIN_SECONDS)
        self._thread = None
        self._record("stop-thread")

    def _loop(self, manager: Any) -> None:
        # 先查一次再等 6 小时：用户可能每天只开十分钟应用，等 6 小时就永远轮不到。
        # 到期闸门保证这次查询与上次访问至少隔 24 小时，不会变成开机就轰炸。
        while not self._stop.is_set():
            try:
                self.check_once(manager)
            except Exception:  # noqa: BLE001 - 后台线程绝不能因为一次异常退出
                logger.warning("BOSS 保活检查失败", exc_info=True)
            if self._stop.wait(self._interval):
                break


__all__ = [
    "BOSS_KEEPALIVE_NOTICE",
    "CAPTCHA_BACKOFF",
    "CHECK_INTERVAL_SECONDS",
    "KEY_BOSS_KEEPALIVE",
    "KEY_LAST_AT",
    "KEY_LAST_RESULT",
    "KEY_NOTICE_DELIVERED",
    "KEY_NOTICE_FIRST_VISIT",
    "MIN_VISIT_INTERVAL",
    "RESULT_CAPTCHA",
    "RESULT_ERROR",
    "RESULT_LOGIN_REQUIRED",
    "RESULT_OK",
    "BossKeepalive",
    "BossKeepaliveState",
    "boss_entry_url",
    "classify",
    "mark_notice_delivered",
    "probe_script",
    "read_notice",
    "read_state",
    "visit_once",
    "write_enabled",
    "write_result",
]
