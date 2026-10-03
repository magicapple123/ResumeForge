"""证据强度计算（匹配共用核心）。"""
from __future__ import annotations

from ..fields import AUTOCOMPLETE_FIELDS

from .model import Control

def evidence_key(
    control: Control, field_name: str, synonyms: tuple[str, ...]
) -> tuple[int, int] | None:
    """控件相对某个字段的**证据强度**，返回 ``(档位, 得分)``；毫无关联时返回 ``None``。

    档位（**先比档位，再比得分**）：

    - **3** = ``autocomplete``：站点按 HTML 规范**主动声明**的字段类型，不是从文本猜的；
    - **2** = **占位符**：输入框自己写着"请输入导师"——它一对一属于这个框，不会被邻居污染；
    - **1** = ``label`` / ``aria-label`` / ``name``；
    - **0** = 只在**旁文**（``nearby_text``）里命中。

    得分取同义词长度（"工作经验" 比 "经验" 更具体）。

    ## 为什么占位符要单独压过 label 和旁文

    2026-09-27 在腾讯校招简历页（``join.qq.com/resumeedit.html``）取了一份真机快照，
    「导师 / 实验室 / 研究方向 / 论文」四个框紧挨着，每个框的 ``nearby_text`` 都是这四个
    标签**搅在一起**的字符串：

        idx=32 请输入导师       nearby='导师 * 导师 * 实验室 研究方向 论文 0/1000'
        idx=33 请输入实验室     nearby='实验室 导师 * 实验室 研究方向 论文 0/1000'
        idx=34 请输入研究方向   nearby='研究方向 导师 * 实验室 研究方向 论文 0/1000'
        idx=35 请输入已发表论文 nearby='0/1000 0/1000 论文 0/1000 导师 * 实验室 研究方向 论文 0/1000'

    "研究方向" 出现在**每一个**框的签名里，于是按"最长同义词"比，「实验室」「论文」双双
    被它抢走。分档救不了——它们全在旁文档，平分。

    而 ``placeholder`` 一对一、且实测在这张页面上**每一个文本控件都写对了**。所以它单独
    成一档，压过 label 与旁文。``label`` 为什么更低：这张页面上它要么是空的，要么装的是
    **单选项文字**（"男"/"女"/"无实习经历"），比占位符粗得多。

    ## 共用

    引擎的 ``_rank_controls`` 与 ``service.recognize_field`` 共用这一个实现：先前两边各写
    一份，引擎那份修了、``recognize_field`` 那份没修，同一个框在批量预览与实时面板里
    认成了两个不同的字段。
    """
    if AUTOCOMPLETE_FIELDS.get(control.autocomplete) == field_name:
        return (3, 100)
    placeholder = control.placeholder.casefold().strip()
    # 占位符自己**指明了它要什么**（"请输入导师"/"请选择学历"）时，它就是权威：
    # 命中就按它算，**没命中也不许退回旁文**。
    #
    # 否则会出这样的事：腾讯校招页「请输入实验室」的旁文里混着"研究方向"，
    # 占位符查无此字段 → 退回旁文 → 被"研究方向"抢走，于是实验室栏被报成研究方向。
    # 正确行为是**如实说"认不出"**（实验室/论文不在字段目录里，本来就没得填），
    # 而不是从邻居的标签里借一个——借来的那个，用户一眼就看得出是错的。
    #
    # 旁文兜底（档位 0）留给**没有这类占位符**的表单（美团/字节把标签放在 input 旁边，
    # 占位符是空的或通用的"选择日期"），那种页面上旁文是唯一可用的信号。
    if _states_its_field(placeholder):
        best = _longest_synonym(placeholder, synonyms)
        return (2, best) if best > 0 else None
    # 某些真实表单用「如有内推串码可在此填写」描述这个输入框，虽然不以「请输入」
    # 开头，却仍然是一对一的字段声明。只接纳短、明确包含「如有…填写」的文案；
    # 不把长段说明或邻近文字当作这个框的权威标签。
    if placeholder.startswith("如有") and "填写" in placeholder and len(placeholder) <= 40:
        best = _longest_synonym(placeholder, synonyms)
        return (2, best) if best > 0 else None
    tier1 = " ".join(
        (
            control.label,
            control.aria_label,
            control.aria_labelledby,
            control.legend,
            control.title,
            control.name,
        )
    ).casefold()
    for tier, hay in ((1, tier1), (0, control.nearby_text.casefold())):
        best = _longest_synonym(hay, synonyms)
        if best > 0:
            return (tier, best)
    return None


def _longest_synonym(hay: str, synonyms: tuple[str, ...]) -> int:
    """``hay`` 里命中的最长同义词长度；一个都没命中返回 0。"""
    best = 0
    for synonym in synonyms:
        needle = synonym.casefold()
        if needle and needle in hay:
            best = max(best, len(needle))
    return best


def _states_its_field(placeholder: str) -> bool:
    """占位符是不是在**陈述这个框要什么**（"请输入导师" / "请选择学历" / "请填写证件号码"）。

    这类占位符一对一属于输入框本身、实测在该页面上每个文本控件都写对了，
    因此可以当权威用；``nearby_text`` 则可能混进邻居的标签（见 ``evidence_key``）。

    主要认这三种前缀；「如有…填写」是少数仍然一对一指向当前输入框的网申提示，
    由 evidence_key 单独按短文案和字段同义词处理，其他说明文字仍不当作字段名。
    """
    stripped = placeholder.strip()
    return stripped.startswith(("请输入", "请选择", "请填写"))
