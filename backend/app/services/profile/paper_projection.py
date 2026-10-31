# SPDX-License-Identifier: Apache-2.0
"""确定性纸面投影的公共入口：C5-B、承载区文本、ResumeContent、指纹与响应。

本模块是 F2/F3/F5 共用的**稳定导入面**；实现分两层：
- paper_content_builder.py：内容组装（消费快照 → ResumeContent + 警告）；
- projection_views.py：内容之外的只读摘要（候选 / 来源布局 / 组元数据）。
映射表只有一份（paper_policy.py）；语言映射只有一份（language_projection.py，
2026-10 起语言是独立分区，不再并入 skills）。
公共函数 / 类型清单见 __all__，生成链路（F3）与网申链路（F5）直接 import 这里。

**确定性**：同一份消费快照重复调用必须得到逐字节相同的 ResumeContent 与
snapshot_token（服务器解析当前组后返回确定性纸面内容）。所有遍历顺序来自
participating_keys / section_order / sort_order，不靠字典顺序或时间。

**不静默截断**：承载区超长保留默认正文，追加行放得下多少放多少，其余进 warnings
（code=carrier_overflow）；照片引用解析不了时留空并给 photo_unresolved。
私密字段（证书编号）永不进 content / candidates / warnings（H/R-40）。
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from collections.abc import Iterable, Mapping

from ...schemas.profile_projection import (
    ConsumedFieldSpec,
    ConsumedProfile,
    PaperProjectionOut,
    ProjectionCandidateOut,
    ProjectionWarningOut,
)
from ...schemas.resume import ResumeContent
from ..resume import document_io
from . import paper_policy
from .paper_content_builder import clean_values, is_http_url, project_content
from .paper_limits import PhotoResolver
from .projection_views import candidates, editor_schema, scope_out, source_layout

# 归一化时额外去掉的符号：区间的"～"、连字符类与间隔号不是文字，匹配时应忽略。
_IGNORED_SYMBOLS = frozenset("~～·—…")


# ===== C5-B：归一化匹配与「标签：值」补回的唯一实现 =====


def normalize_for_match(text: str) -> str:
    """去掉全部空白（含换行/全角空格）与中英文标点；**不改写落库文本**。

    只用于"正文里是否已经出现这个值"的匹配（R-80 / 验收 O）：AI 允许改写正文，
    所以比较前把排版差异抹平；标点按 Unicode 类别 P* 处理（ASCII 与中文标点都在内），
    另加区间号/间隔号这类常被误当标点的符号。
    """
    if not text:
        return ""
    kept: list[str] = []
    for char in str(text):
        if char.isspace() or char in _IGNORED_SYMBOLS:
            continue
        category = unicodedata.category(char)
        if category.startswith("P") or category in ("Cf", "Cc"):
            continue
        kept.append(char)
    return "".join(kept)


def ensure_custom_field_lines(
    text: str,
    fields: Iterable[tuple[str, str] | ConsumedFieldSpec],
    *,
    values: Mapping[str, str] | None = None,
) -> tuple[str, list[str]]:
    """C5-B 唯一实现：正文可改写，但每个非空自定义字段的「标签：值」必须出现。

    fields 是**有序**的 (label, value) 对（字段定义顺序）；也接受 ConsumedFieldSpec
    序列，此时用 values（field_id → 文本）取值。返回 (新正文, 实际追加的行)：值已
    出现在**原文**中（忽略空白与标点的变体）视为已呈现，不重复补；否则末尾按顺序
    追加 "label：value" 一行。不抛异常、不拒绝保存（R-80）；"仅素材"字段应在调用方
    过滤，不传进来（回声阻断属 C6）。
    """
    original = str(text or "").rstrip()
    normalized_original = normalize_for_match(original)
    result = original
    appended: list[str] = []
    for item in fields or ():
        if isinstance(item, ConsumedFieldSpec):
            label = item.label
            value = (values or {}).get(item.field_id, "")
        else:
            label, value = item
        value_text = str(value or "").strip()
        if not value_text:
            continue
        normalized_value = normalize_for_match(value_text)
        if not normalized_value or normalized_value in normalized_original:
            continue
        label_text = str(label or "").strip()
        line = f"{label_text}：{value_text}" if label_text else value_text
        result = f"{result}\n{line}" if result else line
        appended.append(line)
    return result, appended


# ===== 承载区纯函数（R-37/R-42 的单点，生成/填充链路直接复用） =====


def project_carrier_text(
    entry_values: Mapping[str, str],
    section_key: str,
    extra_custom_fields: Iterable[ConsumedFieldSpec] | None = None,
) -> str:
    """一条资料的承载区文本：默认承载区正文 + 按定义顺序的「标签：值」行。

    追加内容 = 该分区没有独立槽位的默认字段（paper_policy.appended_field_specs）
    + extra_custom_fields 里的自定义字段；私密字段永不追加。仅素材分区
    （basic_info / patents / languages）与自建/未知分区没有承载区，返回空串。
    本函数不截断（限长策略在 project_paper_content 里按目标槽位执行，且会 warning）。
    """
    values = clean_values(entry_values)
    fields = (*paper_policy.builtin_field_specs(section_key), *(extra_custom_fields or ()))
    base, extras = _carrier_parts(section_key, fields, values)
    return (
        "\n".join([base, *(line for _label, line in extras)])
        if base
        else "\n".join(line for _label, line in extras)
    )


def _carrier_parts(
    section_key: str, fields: Iterable[ConsumedFieldSpec], values: Mapping[str, str]
) -> tuple[str, list[tuple[str, str]]]:
    """返回 (承载区正文, 追加行)；枚举/URL 不认识的槽位字段也退回追加行。"""
    carrier_id = paper_policy.carrier_field_id(section_key)
    rule = paper_policy.SECTION_RULES.get(section_key)
    if carrier_id is None or paper_policy.is_material_only(section_key):
        return "", []
    base = values.get(carrier_id, "")
    extras: list[tuple[str, str]] = []
    for spec in fields:
        value = values.get(spec.field_id, "")
        if spec.field_id == carrier_id or not value or spec.private:
            continue
        slot = rule.slots.get(spec.key) if rule is not None and spec.is_builtin else None
        if _needs_carrier_append(slot, value):
            extras.append((spec.label, f"{spec.label}：{value}"))
    return base, extras


def _needs_carrier_append(slot: paper_policy.SlotRule | None, value: str) -> bool:
    """没有槽位、或枚举/URL 槽位不认识这个值 → 以「标签：值」追加（不丢值）。"""
    if slot is None:
        return True
    if slot.kind == "enum":
        return (slot.enum or {}).get(value) is None
    return slot.kind == "url" and not is_http_url(value)


# ===== 对外主函数 =====


def project_paper_content(
    consumed: ConsumedProfile,
    *,
    resolve_photo: PhotoResolver | None = None,
) -> ResumeContent:
    """把消费快照投影成简历纸面内容（C1/C2/C5 的唯一出口）。

    resolve_photo 由调用方注入（资源引用 → data URL）；缺省时 data URL 直接透传、
    其它引用留空并记 photo_unresolved warning。返回值不含任何私密字段。
    """
    return project_content(consumed, resolve_photo, []).content


def _custom_field_hints(consumed: ConsumedProfile) -> dict[str, list[dict]]:
    """当前方案的自定义字段元数据（v1→v2 转换器用来识别「标签：值」行与落位置）。"""
    hints: dict[str, list[dict]] = {}
    for key, section in consumed.sections.items():
        rows = [
            {
                "section_key": key,
                "field_id": spec.field_id,
                "label": spec.label,
                "field_type": spec.field_type,
                "default_placement": spec.default_placement or "trail",
                "material_only": spec.material_only,
            }
            for spec in section.fields
            if not spec.is_builtin
        ]
        if rows:
            hints[key] = rows
    return hints


def build_projection(
    consumed: ConsumedProfile,
    *,
    resolve_photo: PhotoResolver | None = None,
    language: str | None = None,
) -> PaperProjectionOut:
    """投影响应：确定性纸面内容 + 逐条候选 + 来源布局 + 警告 + 快照指纹。

    ``content`` 在响应边界转成 **v2 文档 JSON**（自定义字段位置来自当前方案定义）；
    内部仍先组装 v1 中间态，因为候选/快照指纹与生成链路的同一份 v1 视图对齐
    （snapshot_token 继续基于 v1 内容计算，F4 的冻结/比对语义不变）。
    """
    warnings: list[ProjectionWarningOut] = []
    assembly = project_content(consumed, resolve_photo, warnings)
    legacy = assembly.content
    document = document_io.ensure_document_version(
        legacy.model_dump(mode="json"),
        language=language,
        custom_fields=_custom_field_hints(consumed),
    )
    # 候选的 v2 定位：document_path 与 document_entry 都由同一份 content 派生，
    # 前端「从资料填入」直接取现成 entry，不再按 v1 paper_content_path 反查 v2。
    #
    # v1 中��态不携带消费 entry_id（converter 会为条目生成新的稳定 id），所以这里按
    # **条目顺序**对齐：paper_content_path 的尾号即为该分区内 v1 条目下标，而 converter
    # 保持 v1 条目顺序（空条目不产生纸面占位 → path 为空，不定位）。顺序对不上的条目
    # 宁可不给 document_entry，也不猜错条目。
    located: dict[tuple[str, int], tuple[str, dict]] = {}
    for section in document.get("sections") or []:
        section_key = str(section.get("key") or "")
        for index, entry in enumerate(section.get("entries") or []):
            entry_id = str(entry.get("id") or "")
            if section_key and entry_id:
                located[(section_key, index)] = (f"{section_key}.{entry_id}", entry)
    candidate_rows: list[ProjectionCandidateOut] = []
    for row in candidates(consumed, assembly.entry_paths):
        index: int | None = None
        internal_path = assembly.entry_paths.get(row.entry_id, "")
        if internal_path:
            match = re.search(r"(\d+)$", internal_path)
            index = int(match.group(1)) if match else None
        elif row.section_key == "summary":
            index = 0
        document_section = (
            internal_path.split("/", 1)[0]
            if internal_path and not internal_path.startswith("custom_sections/")
            else row.section_key
        )
        found = located.get((document_section, index)) if index is not None else None
        if found is None:
            candidate_rows.append(row)
            continue
        path, entry = found
        candidate_rows.append(
            row.model_copy(update={"document_path": path, "document_entry": entry})
        )
    return PaperProjectionOut(
        scope=scope_out(consumed),
        content=document,
        candidates=candidate_rows,
        source_layout=source_layout(consumed),
        editor_schema=editor_schema(consumed),
        warnings=warnings,
        snapshot_token=snapshot_token(consumed, legacy),
    )


def snapshot_token(consumed: ConsumedProfile, content: ResumeContent) -> str:
    """内容 + scope + 工作区/分区修订的稳定指纹（同数据重复调用必须相同）。"""
    payload = {
        "scope": {
            "group_id": consumed.group_id,
            "group_name": consumed.group_name,
            "is_default": consumed.is_default,
            "participating_keys": list(consumed.participating_keys),
            "section_order": list(consumed.section_order),
            "workspace_revision": consumed.workspace_revision,
        },
        "workspace_revision": consumed.workspace_revision,
        "content": content.model_dump(mode="json"),
        "section_revisions": {
            key: section.revision for key, section in sorted(consumed.sections.items())
        },
    }
    serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(serialized.encode("utf-8")).hexdigest()


__all__ = [
    "PhotoResolver",
    "build_projection",
    "ensure_custom_field_lines",
    "normalize_for_match",
    "project_carrier_text",
    "project_paper_content",
    "snapshot_token",
]
