# SPDX-License-Identifier: Apache-2.0
"""B2：切换浏览器时的 Cookie 导出 / 注入 / 迁移编排。

## 为什么切换浏览器要迁移 Cookie

B2 之后每个浏览器有**自己的 profile 目录**（见 :mod:`profile_identity`），
所以"在 Chrome 里登录过、切到 Edge 还要登录"——这正是用户提的第 2 条需求。
Cookie 是唯一能在两个 Chromium 之间搬的东西：本机 profile 的 ``Local State.os_crypt``
只有 ``encrypted_key``、没有 ``app_bound_encrypted_key``，也就是经典 DPAPI
（同一 Windows 用户下 Chrome / Edge 共用一把密钥），跨浏览器迁移在加密层是可行的。

**不迁移**（明确边界，UI 与文档都要写）：``localStorage`` / ``IndexedDB`` /
浏览器保存的密码。多数站点靠 Cookie 即可恢复，少数 SPA 可能仍要重登。

## 迁移顺序（不能调换）

1. **先导出**：旧实例在跑就直接 ``Storage.getCookies``；没在跑就用旧浏览器 + 旧
   profile 临时启动一次再导出（旧浏览器已卸载 → 明确失败，不静默继续）；
2. **再停旧**：不停就切 profile，两个实例会抢同一个 ``user-data-dir``；
3. **再启新**：新实例以 ``url=None`` 启动，所以还停在 ``about:blank``；
4. **首次导航前注入**：``Network.setCookie`` 逐条写进新 profile。顺序反了（先导航）
   就会先被站点重定向到登录页，登录态看起来"迁移失败"。

同一身份重复启动**不触发**迁移（见 :func:`migrate_cookies_to_new_manager` 的第一个分支）。
"""

from __future__ import annotations

import contextlib
import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models.setting import AppSetting

logger = logging.getLogger(__name__)

#: 迁移失败时给用户看的那句话（"不静默继续"的落点）。
MIGRATION_FAILED_MESSAGE = (
    "无法迁移登录状态：旧浏览器打不开（可能已卸载或被安全软件拦截）。"
    "请在新的专用浏览器里重新登录一次；旧浏览器的登录数据仍然保留，没有损坏。"
)

MIGRATION_NOT_NEEDED = "not-needed"
MIGRATION_COPIED = "copied"
MIGRATION_FAILED = "failed"

#: 一次性提示 KV：迁移失败 / 无法迁移时写入，供登录状态面板展示（不建表）。
KEY_MIGRATION_NOTICE = "browser.cookie_migration.notice"


class CookieMigrationError(RuntimeError):
    """导出 / 注入阶段的失败（消息可直接展示给用户）。"""


def cookie_transfer_params(
    cookie: Mapping[str, Any], *, expires: int | None = None
) -> dict[str, Any]:
    """把一条 Cookie 转成 ``Network.setCookie`` 的参数，**保留全部原属性**。

    这是"跨实例搬运一条 Cookie"的唯一实现，L1 续期（:mod:`session_cookie_keepalive`）
    也复用它——两条链路的属性保真规则必须完全一致，各写一份迟早对不上。

    三条前缀规则不能省：

    - ``__Host-``：``secure`` + ``path="/"`` + **不带 domain**（用 ``url`` 表达宿主，
      写回去仍是 host-only）。带 domain 会被 Chromium 直接拒绝；
    - ``__Secure-``：``secure`` 必须为真；
    - 带 ``partitionKey`` 的必须原样带回，否则会写成一条**新的普通 Cookie**。

    Args:
        cookie: ``Storage.getCookies`` 返回的一条 Cookie。
        expires: 绝对过期时间（秒）。``None`` = 保持原值（会话 Cookie 仍是会话 Cookie）。
    """
    name = str(cookie.get("name") or "")
    domain = str(cookie.get("domain") or "").lstrip(".")
    path = str(cookie.get("path") or "/") or "/"
    params: dict[str, Any] = {"name": name, "value": str(cookie.get("value") or "")}

    if name.startswith("__Host-"):
        params["url"] = f"https://{domain}/"
        params["path"] = "/"
        params["secure"] = True
    else:
        params["domain"] = domain
        params["path"] = path
        if name.startswith("__Secure-") or bool(cookie.get("secure")):
            params["secure"] = True

    if bool(cookie.get("httpOnly")):
        params["httpOnly"] = True
    same_site = str(cookie.get("sameSite") or "")
    if same_site in {"Strict", "Lax", "None"}:
        params["sameSite"] = same_site
    priority = str(cookie.get("priority") or "")
    if priority in {"Low", "Medium", "High"}:
        params["priority"] = priority
    partition = cookie.get("partitionKey")
    if isinstance(partition, Mapping) and partition:
        params["partitionKey"] = dict(partition)

    if expires is None:
        original = cookie.get("expires")
        try:
            # `expires` 缺省时是 None：先挡掉再转 float，否则 pyright 会把
            # 「Any | None 传给 ConvertibleToFloat」判成类型错误（值本身也是脏数据）。
            original_value = -1 if original is None else int(float(original))
        except (TypeError, ValueError):
            original_value = -1
        # -1 / 0 都表示"会话 Cookie"；CDP 里 -1 就是不要 expires 的写法。
        params["expires"] = original_value if original_value > 0 else -1
    else:
        params["expires"] = int(expires)
    return params


@dataclass
class InjectionReport:
    """注入结果。单条失败只记日志继续，所以成功与失败都要计数。"""

    total: int = 0
    injected: int = 0
    failed: int = 0

    def as_dict(self) -> dict[str, Any]:
        return {"total": self.total, "injected": self.injected, "failed": self.failed}


def export_all_cookies(client: Any) -> list[dict[str, Any]]:
    """导出**全部** Cookie（不只是会话 Cookie——迁移要保全所有登录态）。

    Raises:
        CookieMigrationError: 读不到 Cookie 清单。迁移必须知道"到底导出成功了没有"，
            所以这里不像 L1 那样吞异常。
    """
    try:
        result = client.send("Storage.getCookies", {})
    except Exception as exc:  # noqa: BLE001 - 统一收敛成可展示的迁移失败
        raise CookieMigrationError(f"读取旧浏览器的 Cookie 失败：{type(exc).__name__}") from exc
    cookies = result.get("cookies") if isinstance(result, Mapping) else None
    if not isinstance(cookies, list):
        raise CookieMigrationError("旧浏览器没有返回可用的 Cookie 清单")
    return [dict(item) for item in cookies if isinstance(item, Mapping)]


def inject_cookies(client: Any, cookies: Sequence[Mapping[str, Any]]) -> InjectionReport:
    """把导出的 Cookie 逐条写进新浏览器。单条失败只记日志并继续。"""
    report = InjectionReport(total=len(cookies))
    for cookie in cookies:
        params = cookie_transfer_params(cookie)
        try:
            written = client.send("Network.setCookie", params)
        except Exception as exc:  # noqa: BLE001 - 单条失败不影响其余
            report.failed += 1
            logger.debug(
                "注入 Cookie 失败 name=%s error=%s", params.get("name"), type(exc).__name__
            )
            continue
        if isinstance(written, Mapping) and written.get("success") is False:
            report.failed += 1
            logger.debug("注入 Cookie 被拒绝 name=%s", params.get("name"))
            continue
        report.injected += 1
    return report


@dataclass(frozen=True)
class MigrationOutcome:
    """一次切换迁移的结果 + **调用顺序**（证据文件直接打印 ``steps``）。"""

    status: str
    cookie_count: int = 0
    injected: int = 0
    failed: int = 0
    source: str = ""
    message: str = ""
    steps: tuple[str, ...] = field(default_factory=tuple)

    @property
    def ok(self) -> bool:
        return self.status != MIGRATION_FAILED

    def as_dict(self) -> dict[str, Any]:
        return {
            "status": self.status,
            "cookie_count": self.cookie_count,
            "injected": self.injected,
            "failed": self.failed,
            "source": self.source,
            "message": self.message,
            "steps": list(self.steps),
        }

    def as_line(self) -> str:
        return (
            f"status={self.status} source={self.source or '-'} "
            f"cookies={self.cookie_count} injected={self.injected} failed={self.failed} "
            f"steps={' -> '.join(self.steps)}"
        )


def _profile_dir(manager: Any) -> Path | None:
    """取 manager 的 profile 目录；拿不到（auto 未解析）时返回 None。"""
    try:
        return Path(manager.profile_dir)
    except Exception:  # noqa: BLE001 - 身份未定不等于迁移失败
        return None


def _export_from(manager: Any) -> list[dict[str, Any]]:
    client = manager.client()
    try:
        return export_all_cookies(client)
    finally:
        with contextlib.suppress(Exception):
            client.close()


def _inject_into(manager: Any, cookies: Sequence[Mapping[str, Any]]) -> InjectionReport:
    client = manager.client()
    try:
        return inject_cookies(client, cookies)
    finally:
        with contextlib.suppress(Exception):
            client.close()


def _stop_quietly(manager: Any, steps: list[str], label: str) -> None:
    steps.append(label)
    try:
        manager.stop()
    except Exception:  # noqa: BLE001 - 关不掉旧实例不能挡住"启新"
        logger.warning("关闭旧专用浏览器时出错", exc_info=True)


def write_migration_notice(db: Session, message: str) -> None:
    """把"无法迁移"的提示写进 KV（面板读它，不建表）。"""
    row = db.get(AppSetting, KEY_MIGRATION_NOTICE)
    if row is None:
        db.add(AppSetting(key=KEY_MIGRATION_NOTICE, value=message))
    else:
        row.value = message
    db.commit()


def read_migration_notice(db: Session) -> str:
    row = db.get(AppSetting, KEY_MIGRATION_NOTICE)
    return row.value if row is not None else ""


def clear_migration_notice(db: Session) -> None:
    row = db.get(AppSetting, KEY_MIGRATION_NOTICE)
    if row is not None:
        db.delete(row)
        db.commit()


def migrate_cookies_to_new_manager(previous: Any, current: Any) -> MigrationOutcome:
    """把 ``previous`` 的 Cookie 搬到 ``current``；总是负责把 ``previous`` 停掉。

    分支与顺序（顺序即 :attr:`MigrationOutcome.steps`）：

    - 同一 profile 身份 → 只停旧实例，**不导出不注入**（同一浏览器重启不该搬一次）；
    - 旧实例在跑 → ``export-running`` → ``stop-previous`` → ``start-current`` → ``inject``；
    - 旧实例没跑 → ``start-previous`` → ``export-restarted`` → 同上；
    - 旧浏览器启动 / 读取失败 → ``export-failed`` + :data:`MIGRATION_FAILED_MESSAGE`，
      **旧 profile 一个字节都没动**（我们只是没读成），用户切回去仍然可用。

    整体失败只影响"新浏览器没有旧登录态"，不会把用户卡在两个都登不上的状态：
    新浏览器照样能用，只是要在里面重登一次。
    """
    steps: list[str] = []
    if previous is None:
        return MigrationOutcome(MIGRATION_NOT_NEEDED, steps=("no-previous",))

    previous_dir = _profile_dir(previous)
    current_dir = _profile_dir(current)
    if previous_dir is not None and previous_dir == current_dir:
        _stop_quietly(previous, steps, "stop-previous")
        return MigrationOutcome(MIGRATION_NOT_NEEDED, steps=tuple(steps))

    cookies: list[dict[str, Any]] = []
    source = ""
    try:
        if previous.is_running():
            steps.append("export-running")
            cookies = _export_from(previous)
            source = "running"
        else:
            steps.append("start-previous")
            previous.start(url=None)
            source = "restarted"
            steps.append("export-restarted")
            cookies = _export_from(previous)
    except Exception as exc:  # noqa: BLE001 - 旧浏览器不可用是明确失败，不是异常上抛
        steps.append("export-failed")
        logger.warning("切换浏览器时无法导出旧登录态 error=%s", type(exc).__name__)
        _stop_quietly(previous, steps, "stop-previous")
        return MigrationOutcome(
            MIGRATION_FAILED,
            source=source,
            message=MIGRATION_FAILED_MESSAGE,
            steps=tuple(steps),
        )

    _stop_quietly(previous, steps, "stop-previous")
    try:
        steps.append("start-current")
        previous_label = previous_dir
        logger.info(
            "切换专用浏览器：导出 %d 条 Cookie（来源 %s，旧目录 %s）",
            len(cookies),
            source,
            previous_label,
        )
        current.start(url=None)
        steps.append("inject")
        report = _inject_into(current, cookies)
    except Exception as exc:  # noqa: BLE001 - 新浏览器起不来同样是可展示的失败
        steps.append("inject-failed")
        logger.warning("切换浏览器后启动新实例失败 error=%s", type(exc).__name__)
        return MigrationOutcome(
            MIGRATION_FAILED,
            cookie_count=len(cookies),
            source=source,
            message=MIGRATION_FAILED_MESSAGE,
            steps=tuple(steps),
        )

    logger.info(
        "切换专用浏览器完成：注入 %d/%d 条 Cookie（失败 %d）",
        report.injected,
        report.total,
        report.failed,
    )
    return MigrationOutcome(
        MIGRATION_COPIED,
        cookie_count=len(cookies),
        injected=report.injected,
        failed=report.failed,
        source=source,
        steps=tuple(steps),
    )


def migration_notice_json(outcome: MigrationOutcome) -> str:
    """失败提示落库时用的 JSON 载荷（面板可结构化读，也保留原话）。"""
    return json.dumps(
        {"message": outcome.message, "steps": list(outcome.steps)}, ensure_ascii=False
    )


def migrate_and_record(previous: Any, current: Any, db: Session) -> MigrationOutcome:
    """迁移 + 记日志 + 失败时把提示写进 KV。**不抛异常**。

    给 ``get_browser_manager`` 用：它在 ``/browser/status`` 轮询路径上，任何异常都会让
    整个状态接口 500，用户会看到"浏览器未启动 + 一直转圈"。
    """
    outcome = migrate_cookies_to_new_manager(previous, current)
    if outcome.ok:
        logger.info("切换浏览器 Cookie 迁移：%s", outcome.as_line())
        return outcome
    logger.warning("切换浏览器 Cookie 迁移失败：%s", outcome.as_line())
    try:
        write_migration_notice(db, migration_notice_json(outcome))
    except Exception:  # noqa: BLE001 - 写提示失败不能挡住"换浏览器"这件事本身
        logger.warning("写入切换浏览器迁移提示失败", exc_info=True)
    return outcome


__all__ = [
    "KEY_MIGRATION_NOTICE",
    "MIGRATION_COPIED",
    "MIGRATION_FAILED",
    "MIGRATION_FAILED_MESSAGE",
    "MIGRATION_NOT_NEEDED",
    "CookieMigrationError",
    "InjectionReport",
    "MigrationOutcome",
    "clear_migration_notice",
    "cookie_transfer_params",
    "export_all_cookies",
    "inject_cookies",
    "migrate_and_record",
    "migrate_cookies_to_new_manager",
    "migration_notice_json",
    "read_migration_notice",
    "write_migration_notice",
]
