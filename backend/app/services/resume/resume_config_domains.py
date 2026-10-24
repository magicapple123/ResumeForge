# SPDX-License-Identifier: Apache-2.0
"""format_config 扩展域协议的常量与版本判定（Wave2 契约第 1 册 §1.2，叶子模块）。

**为什么单独成文件**：W07 局部排版 / W08 分页 / W15 照片裁剪三批都要往同一个
``format_config`` JSON 里存数据。如果每批各自定一套"顶层键 + 校验 + 版本"，
第二天就会出现三份"读 format_config"的实现——正是历史上"预览与导出发散"的成因。
所以这里只放**协议本身**（域白名单 / 版本 / 体积上限），校验与消费各自在域模块里，
依赖方向单向：本模块只依赖标准库。
"""

from __future__ import annotations

import json
import re

# 域键名**冻结**：新增域必须先改 Wave2 契约与本文档，不允许插件式塞入。
DOMAIN_KEYS: tuple[str, ...] = ("roles", "objects", "pagination", "photo_crop")

# 本端当前读写的版本。域里 ``version`` 缺省按 1 读（宽容旧数据）。
DOMAIN_VERSION: dict[str, int] = {key: 1 for key in DOMAIN_KEYS}
SUPPORTED_VERSIONS: dict[str, frozenset[int]] = {key: frozenset({1}) for key in DOMAIN_KEYS}

# format_config 序列化（紧凑 JSON / UTF-8）后的体积上限：超限是 422 而不是静默裁剪——
# 客户端状态已经坏了，静默丢数据比报错更难排查（契约 §1.3）。
MAX_FORMAT_CONFIG_BYTES = 32_768

# 嵌套深度上限：format_config → domain → value → scalar（photo_crop 的 source/rect 是
# 契约里唯一允许的例外，深度 4）。
MAX_FORMAT_CONFIG_DEPTH = 3

# 与既有 ``resume_template_format._HEX_COLOR_RE`` 同一口径（三/六位十六进制）。
HEX_COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
# 对象 id 正则与 ``document_identity.OBJECT_ID_PATTERN`` 同值（8–32 位、URL 安全字符）。
OBJECT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{8,32}$")


def is_domain_key(key: object) -> bool:
    """这个顶层键是不是协议内的扩展域（不是的话按既有的"未知键丢弃"处理）。"""
    return isinstance(key, str) and key in DOMAIN_KEYS


def domain_version(raw: object) -> int:
    """读出域对象的 version；缺省 / 非正整数一律按 1 读（宽容旧数据，契约 R2）。"""
    if isinstance(raw, dict):
        value = raw.get("version")
        if isinstance(value, int) and not isinstance(value, bool) and value > 0:
            return value
    return 1


def is_supported(domain: str, version: int) -> bool:
    """本端是否支持这个域的该版本；未知域返回 False（不吹牛）。"""
    return version in SUPPORTED_VERSIONS.get(domain, frozenset())


def serialized_size(config: object) -> int:
    """紧凑 JSON / UTF-8 的序列化体积（契约 §1.3 的 32 KiB 判据）。"""
    try:
        payload = json.dumps(config, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        return 0
    return len(payload.encode("utf-8"))


def is_object_id(value: object) -> bool:
    return isinstance(value, str) and bool(OBJECT_ID_RE.fullmatch(value))


__all__ = [
    "DOMAIN_KEYS",
    "DOMAIN_VERSION",
    "HEX_COLOR_RE",
    "MAX_FORMAT_CONFIG_BYTES",
    "MAX_FORMAT_CONFIG_DEPTH",
    "OBJECT_ID_RE",
    "SUPPORTED_VERSIONS",
    "domain_version",
    "is_domain_key",
    "is_object_id",
    "is_supported",
    "serialized_size",
]
