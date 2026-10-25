# SPDX-License-Identifier: Apache-2.0
"""内置职业场景目录的加载与校验（A1，契约 §2.3）。

目录是**声明式数据**（`app/data/career_scenarios/catalog.json`），不是代码分支：
``catalog_version`` 必须来自文件，升级只改数据并递增版本；代码里不散落内置场景清单。
内置场景是"快捷组合"，不是互斥身份——用户可以跳过、也可以叠加自己的维度。

校验目标是**失败可见**而不是尽力加载：目录损坏时抛 :class:`CatalogError`，API 层转成
503，前端继续使用"不带场景"的旧生成流程（计划 §7.3：加载失败可继续不带场景使用）。
所以这里不做"跳过坏条目"的容错——静默少几个内置场景比报错更难解释。

缓存进程内只读结果；测试改 `CATALOG_PATH` 后要调 :func:`clear_cache`。
"""

from __future__ import annotations

import json
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from ...schemas.career_scenario import (
    CAREER_SCENARIO_CATALOG_UNAVAILABLE,
    MAX_GUIDANCE_ITEMS,
    MAX_GUIDANCE_LENGTH,
    MAX_PREFERRED_SECTIONS,
    MAX_SCENARIO_NAME_LENGTH,
    RESUME_SECTION_KEY_SET,
    CareerScenarioConfig,
)

CATALOG_PATH = (
    Path(__file__).resolve().parents[2] / "data" / "career_scenarios" / "catalog.json"
)
MAX_CATALOG_VERSION_LENGTH = 32
MAX_PRESET_KEY_LENGTH = 64
# 目录文档结构版本（与场景 config 的结构版本、场景 revision 分开，见计划 §7.2）。
CATALOG_SCHEMA_VERSION = 1

_KEY_RE = re.compile(r"^[a-z][a-z0-9_]{0,31}$")
_TOP_LEVEL_KEYS = frozenset({"catalog_version", "schema_version", "presets"})
_PRESET_KEYS = frozenset({"key", "name", "config", "suggested_sections", "guidance"})


class CatalogError(Exception):
    """内置目录不可用（缺失/损坏/版本不认识）。API 层统一转 503。"""

    code = CAREER_SCENARIO_CATALOG_UNAVAILABLE

    def __init__(self, detail: str) -> None:
        super().__init__(detail)
        self.detail = detail


@dataclass(frozen=True)
class CatalogPreset:
    key: str
    name: str
    # 归一化后的 config（含 preferred_sections；见 _build_preset 的合并规则）。
    config: dict[str, Any]
    suggested_sections: tuple[str, ...]
    guidance: tuple[str, ...]


@dataclass(frozen=True)
class CareerScenarioCatalog:
    catalog_version: str
    schema_version: int
    presets: tuple[CatalogPreset, ...]

    def preset(self, key: str) -> CatalogPreset | None:
        for item in self.presets:
            if item.key == key:
                return item
        return None


# 进程内只读缓存：目录是静态数据，解析和校验每请求都做一遍没有意义；测试改路径后
# 必须调 clear_cache（缓存命中时不会重新读盘）。
_CACHE: CareerScenarioCatalog | None = None
_CACHE_LOCK = threading.Lock()


def clear_cache() -> None:
    """清掉进程内缓存（测试/目录热更新用）。"""
    global _CACHE
    with _CACHE_LOCK:
        _CACHE = None


def load_catalog(*, force_reload: bool = False) -> CareerScenarioCatalog:
    """读取并校验内置目录；成功后缓存。任何格式问题都抛 :class:`CatalogError`。"""
    global _CACHE
    if not force_reload and _CACHE is not None:
        return _CACHE
    with _CACHE_LOCK:
        if not force_reload and _CACHE is not None:
            return _CACHE
        catalog = _load(CATALOG_PATH)
        _CACHE = catalog
        return catalog


def _load(path: Path) -> CareerScenarioCatalog:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CatalogError("内置场景目录缺失或不可读，请检查安装是否完整") from exc
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise CatalogError("内置场景目录不是合法 JSON，已回退为不带场景的生成") from exc
    if not isinstance(data, dict):
        raise CatalogError("内置场景目录顶层必须是对象")

    missing = _TOP_LEVEL_KEYS - set(data)
    unknown = set(data) - _TOP_LEVEL_KEYS
    if missing or unknown:
        detail = "内置场景目录结构不正确"
        if missing:
            detail += f"，缺少字段：{'、'.join(sorted(missing))}"
        if unknown:
            detail += f"，未知字段：{'、'.join(sorted(unknown))}"
        raise CatalogError(detail + "；已回退为不带场景的生成")

    catalog_version = _clean_text(
        data["catalog_version"], "catalog_version", MAX_CATALOG_VERSION_LENGTH
    )
    schema_version = data["schema_version"]
    if (
        not isinstance(schema_version, int)
        or isinstance(schema_version, bool)
        or schema_version != CATALOG_SCHEMA_VERSION
    ):
        raise CatalogError(
            f"内置场景目录结构版本 {schema_version!r} 不受支持"
            f"（当前支持 {CATALOG_SCHEMA_VERSION}）"
        )

    presets_raw = data["presets"]
    if not isinstance(presets_raw, list) or not presets_raw:
        raise CatalogError("内置场景目录至少需要一个快捷场景")
    presets = tuple(_build_preset(item, index) for index, item in enumerate(presets_raw))
    keys = [item.key for item in presets]
    if len(set(keys)) != len(keys):
        raise CatalogError("内置场景目录存在重复的 preset key")
    return CareerScenarioCatalog(
        catalog_version=catalog_version,
        schema_version=schema_version,
        presets=presets,
    )


def _build_preset(raw: Any, index: int) -> CatalogPreset:
    position = f"第 {index + 1} 个内置场景"
    if not isinstance(raw, dict):
        raise CatalogError(f"{position}必须是对象")
    missing = _PRESET_KEYS - set(raw)
    unknown = set(raw) - _PRESET_KEYS
    if missing or unknown:
        detail = f"{position}字段不正确"
        if missing:
            detail += f"，缺少：{'、'.join(sorted(missing))}"
        if unknown:
            detail += f"，未知：{'、'.join(sorted(unknown))}"
        raise CatalogError(detail)

    key = _clean_text(raw["key"], "key", MAX_PRESET_KEY_LENGTH)
    if not _KEY_RE.match(key):
        raise CatalogError(f"{position}的 key {key!r} 不合法（小写字母开头，可含数字/下划线）")
    name = _clean_text(raw["name"], "name", MAX_SCENARIO_NAME_LENGTH)

    config_raw = raw["config"]
    if not isinstance(config_raw, dict):
        raise CatalogError(f"内置场景 {key} 的 config 必须是对象")
    try:
        config = CareerScenarioConfig.model_validate(config_raw)
    except ValidationError as exc:
        raise CatalogError(f"内置场景 {key} 的 config 校验失败：{_first_error(exc)}") from exc
    if config.include_employment_status:
        raise CatalogError(f"内置场景 {key} 不得默认允许发送就业状态")

    suggested = _section_list(raw["suggested_sections"], key)
    merged_sections = _merge_sections(config.preferred_sections, suggested, key)
    config_dict = config.model_dump()
    config_dict["preferred_sections"] = merged_sections

    guidance_raw = raw["guidance"]
    if not isinstance(guidance_raw, list) or len(guidance_raw) > MAX_GUIDANCE_ITEMS:
        raise CatalogError(f"内置场景 {key} 的 guidance 必须是最多 {MAX_GUIDANCE_ITEMS} 条数组")
    guidance = tuple(
        _clean_text(item, "guidance", MAX_GUIDANCE_LENGTH) for item in guidance_raw
    )

    return CatalogPreset(
        key=key,
        name=name,
        config=config_dict,
        suggested_sections=tuple(merged_sections),
        guidance=guidance,
    )


def _section_list(raw: Any, key: str) -> list[str]:
    if not isinstance(raw, list) or len(raw) > MAX_PREFERRED_SECTIONS:
        raise CatalogError(
            f"内置场景 {key} 的 suggested_sections 必须是最多 {MAX_PREFERRED_SECTIONS} 项的数组"
        )
    sections: list[str] = []
    for item in raw:
        if not isinstance(item, str) or item not in RESUME_SECTION_KEY_SET:
            raise CatalogError(f"内置场景 {key} 的 suggested_sections 含未知栏目 {item!r}")
        if item in sections:
            raise CatalogError(f"内置场景 {key} 的 suggested_sections 重复：{item}")
        sections.append(item)
    return sections


def _merge_sections(config_sections: list[str], suggested: list[str], key: str) -> list[str]:
    """config 的 preferred_sections 与 suggested_sections 是同一件事的两处表达。

    允许作者只写一处：两处都空 → 空（沿用默认顺序）；一处为空 → 取另一处；
    两处都写就必须一致（否则"建议"与"发送维度"会静默分叉，正是最难解释的那类 bug）。
    """
    if config_sections and suggested and config_sections != suggested:
        raise CatalogError(f"内置场景 {key} 的 config.preferred_sections 与 suggested_sections 不一致")
    return list(config_sections or suggested)


def _clean_text(value: Any, field: str, max_length: int) -> str:
    if not isinstance(value, str):
        raise CatalogError(f"内置场景目录的 {field} 必须是字符串")
    cleaned = value.strip()
    if not cleaned:
        raise CatalogError(f"内置场景目录的 {field} 不能为空")
    if len(cleaned) > max_length:
        raise CatalogError(f"内置场景目录的 {field} 超过 {max_length} 字")
    return cleaned


def _first_error(exc: ValidationError) -> str:
    errors = exc.errors()
    if not errors:
        return "未知错误"
    first = errors[0]
    location = ".".join(str(part) for part in first.get("loc", ()))
    message = str(first.get("msg", "未知错误"))
    return f"{location} {message}".strip()


__all__ = [
    "CATALOG_PATH",
    "CATALOG_SCHEMA_VERSION",
    "CatalogError",
    "CatalogPreset",
    "CareerScenarioCatalog",
    "clear_cache",
    "load_catalog",
]
