# SPDX-License-Identifier: Apache-2.0
"""「登录状态」的 KV 存取原语 + **账号备注**（原条目 8 A1）。

从 `login_status` 拆出来的理由只有一条：行数预算。`login_status` 既管两处登录态的判定，
又管三套 KV（状态 / 探测地址 / 账号备注），拆开之后两边都在 500 行以内，且这条缝本身
也是真的——**"往 `AppSetting` 里读写一行"**与**"判断登录态"**不是同一件事。

## 为什么账号备注是 KV 而不是一张表

一行用户手写的文字，没有关联查询、没有排序聚合、没有外键，为它建表只会多一份要维护的
结构与一条要写 up/down 的迁移。`AppSetting` 的键是 `login_account.<host>`，空串 = 清除
（**删行**，不存空值：否则"没填过"和"清空了"在库里长得一样）。

## 为什么文案叫「账号备注」而不是「当前账号」

这里存的是用户自己填的一行文字，应用并不知道他后来有没有换账号。把它显示成「当前账号」
等于用一条可能过期的备注冒充实时事实——站点行上明明写着「正常」，用户会以为自己登的
还是备注里那个号。

## 隐私

备注可能含邮箱 / 手机号：本模块**只读写、不记日志**（日志里最多允许出现 host）。
上限 :data:`MAX_ACCOUNT_NOTE` 字符，超长按前缀截断而不是报错——粘了一大段时
"存下一部分"比"整段丢掉"更有用。
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from ..models.setting import AppSetting

#: 账号备注：一个 host 一行 KV。**不建表**——它是纯展示用的用户备注，没有关联查询。
_ACCOUNT_KEY = "login_account.{host}"
#: 备注上限。超长按前缀截断而不是报错。
MAX_ACCOUNT_NOTE = 64


def _read_setting(db: Session, key: str) -> str:
    """读一行 `AppSetting`；没有这一行 → 空串（**不抛错**）。"""
    row = db.get(AppSetting, key)
    return row.value if row is not None else ""


def _write_setting(db: Session, key: str, value: str) -> None:
    """写一行 `AppSetting`（存在则改值）。**不 commit**：由调用方决定事务边界。"""
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=value))
    else:
        row.value = value


def _now() -> str:
    """检测时间戳的唯一格式（秒级 ISO，前端直接 `replace("T", " ")` 显示）。"""
    return datetime.now().isoformat(timespec="seconds")


def _account_key(host: str) -> str:
    return _ACCOUNT_KEY.format(host=host)


def normalize_account_note(note: str) -> str:
    """备注的唯一规范化口径：去首尾空白 → 截到 :data:`MAX_ACCOUNT_NOTE`。

    空串有明确语义（= 清除），所以**规范化之后**为空就必须删行，不能存成空值
    （否则"没填过"与"清空了"在库里长得一样）。
    """
    return str(note or "").strip()[:MAX_ACCOUNT_NOTE]


def read_account_note(db: Session, host: str) -> str:
    """读某个 host 的账号备注；没有 host 或从没写过 → 空串。"""
    wanted = str(host or "").strip().lower()
    if not wanted:
        return ""
    return _read_setting(db, _account_key(wanted))


def write_account_note(db: Session, host: str, note: str) -> str:
    """写 / 清除某个 host 的账号备注，返回落库后的值（空串 = 已清除）。

    **不记日志**：备注是用户手输文本，可能含邮箱 / 手机号，日志最多允许出现 host。
    """
    wanted = str(host or "").strip().lower()
    if not wanted:
        raise ValueError("host is required")
    key = _account_key(wanted)
    value = normalize_account_note(note)
    row = db.get(AppSetting, key)
    if value:
        if row is None:
            db.add(AppSetting(key=key, value=value))
        else:
            row.value = value
    elif row is not None:
        db.delete(row)
    db.commit()
    return value


__all__ = [
    "MAX_ACCOUNT_NOTE",
    "_now",
    "_read_setting",
    "_write_setting",
    "normalize_account_note",
    "read_account_note",
    "write_account_note",
]
