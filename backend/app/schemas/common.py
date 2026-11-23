# SPDX-License-Identifier: Apache-2.0
"""通用 Schema：分页与跨模块共用的字段校验。"""

from typing import Generic, TypeVar
from urllib.parse import urlsplit

from pydantic import BaseModel

T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int


def validate_http_url(value: str, label: str) -> str:
    """把一个用户填的链接规整成"可以放心渲染/跳转"的形态。

    **一处实现**：岗位的「投递链接」与求职进度的「关联链接」是同一类输入，各自写一份
    校验必然漂移（一份放行 `file:`、另一份不放行，用户填同一个链接会得到两种结果）。

    规则（三条，缺一条都能造成真实的坏结果）：

    1. **只放行 http / https**——`javascript:` 是可执行脚本、`file:` 能读本地文件，
       它们都会被渲染成 `<a href>`，等于把用户输入变成代码执行入口；
    2. **必须有 host**——`http://` 这种没有主机的地址前端拼不出来，点了也是死链；
    3. **空串合法**：两个字段都是选填，"清空"是正常动作，不能判成错误。

    入参出参都 trim：粘贴来的链接常带首尾空格与换行，留着会让 `href` 变成
    `<a href=" https://…">`（浏览器会把空格当相对路径的一部分）。

    Args:
        value: 用户填的原始字符串，可为空。
        label: 字段的中文名，用于拼错误文案（岗位「投递链接」/ 进度「关联链接」）。

    Returns:
        trim 之后的原始字符串（不重写 scheme/host 大小写，避免把用户看得见的地址改掉）。

    Raises:
        ValueError: scheme 不是 http/https，或没有 host。
    """
    cleaned = (value or "").strip()
    if not cleaned:
        return ""
    try:
        parsed = urlsplit(cleaned)
    except ValueError as exc:
        raise ValueError(f"{label}必须是有效的 HTTP 或 HTTPS 地址") from exc
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError(f"{label}只支持 HTTP 或 HTTPS 地址")
    return cleaned


__all__ = ["Page", "validate_http_url"]
