"""字段识别与实时建议（实时面板用）。"""
from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Iterable

from ..engine import (
    Control,
    FormEngine,
    block_hint_satisfied,
    evidence_key,
    excluded_by_hints,
    foreign_marker,
    has_ambiguous_field_evidence,
)
from ..fields import FIELD_LABELS, FIELD_SYNONYMS, RELATIVE_HINTS
from ..matching import normalize_option_text
from ..repeated_fields import (
    compatible_block,
    field_label_for_key,
    split_repeated_key,
)


def _describe(control: Control) -> str:
    """给用户看的"这是页面上的哪个框"。"""
    for candidate in (control.label, control.placeholder, control.aria_label):
        if candidate.strip():
            return candidate.strip()
    if control.nearby_text.strip():
        return control.nearby_text.strip()[:40]
    return control.name or f"第 {control.index + 1} 个控件"


def recognize_field(control: Control) -> str | None:
    """这个控件能看出是哪个字段吗（不看有没有值）。

    用于把"认得出字段但资料为空"和"压根认不出"分开——前者用户知道该去补什么，
    后者只能如实说"没认出来"，并**交给 AI 兜底**。

    **判据与引擎的 ``_rank_controls`` 共用 ``evidence_key``，不能各写一份。**
    先前这里按"签名里最长的那个同义词"一维比较，于是「导师」框的旁文里装着邻居的
    「研究方向」，4 字压过自己的 2 字 → 报成「研究方向」。那不只是显示错：调用方看到
    "认得出"就直接返回、不再问模型，**认错反而把 AI 兜底挡在了门外**。
    """
    best_field = ""
    best_key = (0, 0)
    if has_ambiguous_field_evidence(control):
        return None
    for field_name, synonyms in FIELD_SYNONYMS.items():
        if not compatible_block(field_name, control.block_family, control.block_index):
            continue
        # 负向词与跨族否决与引擎共用同一实现（先前这里抄了一份、还少了 date_part
        # 豁免，同一页面上引擎认得出、面板认不出的分叉就从这类复制开始）。
        if excluded_by_hints(control, field_name) or foreign_marker(control, field_name):
            continue
        key = evidence_key(control, field_name, synonyms)
        # 区块限定的短词（"描述"/"职位"）没见到区块名就不算认出来——与引擎同一条判据
        # （先前这里少了它，同一个「游戏经历」框引擎认不出、面板却报"实习描述"）。
        if key is None or not block_hint_satisfied(control, field_name, key, synonyms):
            continue
        if key > best_key:
            best_field, best_key = field_name, key
    return best_field or None


def relative_hint(control: Control) -> str:
    """这个控件是不是**问别人**的（紧急联系人 / 父母 / 推荐人…）。命中就返回那个词。

    单独拎出来是因为它和"资料为空"完全不同：用户不是没填，而是**这本来就不该由资料回答**。
    混为一谈会让界面写出"你的姓名没填"这种让人困惑的提示。

    **只能用 ``RELATIVE_HINTS``**，不能用 ``FIELD_EXCLUDE_HINTS``：后者是各字段自己的
    排除词表，里面混着"这个框不是那个字段"这类语义（例如 ``phone_country_code`` 的
    ("手机", "号码")），拿它判断"是否在问别人"会把「手机号」误判成亲属栏。
    """
    signature = control.signature()
    # “内推码/推荐人”是求职者自己的招聘来源字段，不是让程序代填他人的个人信息。
    # 只有出现内推/推荐码语境时才放行；单独的“推荐人姓名/联系电话”仍按他人信息拦截。
    if any(token in signature for token in ("内推码", "推荐码", "内推编号", "内推人")):
        return ""
    return next((word for word in RELATIVE_HINTS if word in signature), "")


# 国际区号：`+86` / `+1` / `+886` 这种形状（框里现有的值就是它）。
_DIAL_CODE_RE = re.compile(r"^\+\d{1,3}$")


@dataclass
class Suggestion:
    """「点哪个填哪个」模式下，对一个控件的判定。"""

    status: str  # matched | blocked | unmatched
    field: str = ""
    field_label: str = ""
    value: str = ""
    note: str = ""
    # 放宽模式专用：主按钮的自定义文案（如「帮我勾选：我已阅读并同意隐私政策」）。
    # 空串 = 沿用默认的「填入」。页面脚本只认这个键，没有就显示默认文案。
    accept_label: str = ""


def suggest_for(
    control: Control, data: dict[str, str], *, engine: FormEngine | None = None
) -> Suggestion:
    """就**一个**控件算出该填什么（点哪个填哪个模式的核心）。

    与批量模式共用同一套匹配器与同一套"永不自动填"的判据——两份实现就会分叉。
    """
    engine = engine or FormEngine()

    reason = engine.skip_reason(control)
    if reason:
        return Suggestion("blocked", note=reason, field_label="不会自动填")
    # 下拉 / 单选 / 复选 / 日期 / 弹层选择器的"不自动填"由上面这一处说了算（"只填不点"）；
    # 这里不再按类型补刀，免得同一个边界有两种说法。
    if hinted := relative_hint(control):
        return Suggestion(
            "blocked",
            note="看起来要填别人的信息",
            field_label=f"他人信息（{FIELD_LABELS.get(hinted, hinted)}相关）",
        )

    # 区号框：**框里现有值本身就是判据**（`+86`、`+1` 这种形状）。
    #
    # 只看文本认不出它——字节那个区号框的上下文里反而含「手机号码*」，于是会被建议填
    # 完整手机号（实测到的）。而"当前值是个国际区号"这件事是它自己说的，比任何旁文都硬。
    if _DIAL_CODE_RE.match(control.value.strip()) and data.get("phone_country_code"):
        return Suggestion(
            "matched",
            field="phone_country_code",
            field_label=FIELD_LABELS.get("phone_country_code", "手机区号"),
            value=data["phone_country_code"],
        )

    result = engine.match_fields([control], data)
    if not result.mappings:
        # 选择框到不了这里（上面 ``skip_reason`` 已经判成 blocked 了）；剩下的是
        # "认不出这个文本框要填什么"。
        return Suggestion("unmatched", note="没认出来这个框要填什么")

    mapping = result.mappings[0]
    note = ""
    if mapping.date is not None and mapping.date.assumed_day:
        note = mapping.date.reason
    base_field, _index = split_repeated_key(mapping.field)
    return Suggestion(
        "matched",
        field=mapping.field,
        field_label=field_label_for_key(
            mapping.field, FIELD_LABELS.get(base_field, base_field)
        ),
        value=mapping.write_value(),
        note=note,
    )


# 「可能是这几个」最多列几条。太多了就失去"一眼扫完"的意义。
RELATED_LIMIT = 5


def related_entries(
    control: Control, catalog: Iterable[dict[str, str]], *, limit: int = RELATED_LIMIT
) -> list[dict[str, str]]:
    """按**当前控件的文字**从清单里挑最像的几条，供「换个资料…」置顶。

    为什么值得做：「换个资料…」是程序认不出或认错时才打开的，而清单通常有几十条、
    面板只露得下八九行——用户得滚着找或打字搜。但**"他此刻点在哪个框"本身就是个强信号**，
    多数情况下要找的就是其中一条。

    **判据复用 `engine.evidence_key` 和同一份 `FIELD_SYNONYMS`**，不另写一套文本相似度。
    这个仓库吃过"两份匹配实现各自分叉"的亏：``recognize_field`` 与 ``_rank_controls``
    曾经各写一份，同一个框在批量预览和实时面板里认成两个字段（记在
    ``engine.evidence_key`` 的注释里）。

    **只排顺序、不做取舍。** 没进前几名的条目仍然在下面的完整清单里，一条都没少——
    所以这里判错一条的代价只是"多看一眼"，不会让人找不到东西。
    """
    signature = normalize_option_text(control.signature())
    ranked: list[tuple[int, int, dict[str, str]]] = []
    for entry in catalog:
        label = str(entry.get("label") or "").strip()
        value = str(entry.get("value") or "").strip()
        if not label or not value:
            continue
        key = str(entry.get("key") or "")
        synonyms = FIELD_SYNONYMS.get(key, ())
        if synonyms:
            evidence = evidence_key(control, key, synonyms)
            if evidence is not None:
                ranked.append((evidence[0], evidence[1], entry))
            continue
        # 子表里有几个字段**没有同义词表**（工作内容、项目描述、担任角色…），退回按标签
        # 本身比：只认"控件的文字里明确出现了这个标签"，不做模糊。这里只是排序，但把
        # 不相干的推到顶上照样是帮倒忙。
        normalized = normalize_option_text(label)
        if normalized and normalized in signature:
            ranked.append((1, len(normalized), entry))
    ranked.sort(key=lambda item: (item[0], item[1]), reverse=True)
    return [
        {
            "group": str(entry.get("group") or ""),
            "label": str(entry.get("label") or ""),
            "value": str(entry.get("value") or ""),
        }
        for _tier, _score, entry in ranked[:limit]
    ]
