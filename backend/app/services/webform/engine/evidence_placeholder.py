# SPDX-License-Identifier: Apache-2.0
"""占位符语义助手（从 ``engine/evidence.py`` 迁出，导入路径保持兼容）。"""

from __future__ import annotations

import re

# 「请输入 / 请选择 / 请填写」之后什么都不剩，就说明占位符没在陈述任何字段。
_EMPTY_PLACEHOLDER_TAIL = " 　*＊:：,，.。…·-—_()（）[]【】"
# 长说明文里的指导语：出现它说明这段文字在教用户怎么填，而不是在点名一个字段。
_INSTRUCTION_MARKERS = ("您可以", "建议", "例如", "格式填写", "如：", "比如")


def _placeholder_prefix_tail(placeholder: str) -> str | None:
    """「请输入 / 请选择 / 请填写」之后的剩余文字；不以这三种开头时返回 ``None``。"""
    stripped = placeholder.strip()
    for prefix in ("请输入", "请选择", "请填写"):
        if stripped.startswith(prefix):
            return stripped[len(prefix) :]
    return None


def _bare_prefix_placeholder(placeholder: str) -> bool:
    """光杆「请输入 / 请选择 / 请填写」：有前缀，但后面不含任何字段信息。"""
    tail = _placeholder_prefix_tail(placeholder)
    return tail is not None and not tail.strip(_EMPTY_PLACEHOLDER_TAIL)


def _states_its_field(placeholder: str) -> bool:
    """占位符是不是在**陈述这个框要什么**（"请输入导师" / "请选择学历" / "请填写证件号码"）。

    这类占位符一对一属于输入框本身、实测在该页面上每个文本控件都写对了，
    因此可以当权威用；``nearby_text`` 则可能混进邻居的标签（见 ``evidence_key``）。

    主要认这三种前缀；「如有…填写」是少数仍然一对一指向当前输入框的网申提示，
    由 evidence_key 单独按短文案和字段同义词处理，其他说明文字仍不当作字段名。

    **两种"有前缀但不算陈述"的情形**（2026-10-05 真机实测后补）：

    - **光杆「请输入 / 请选择」**：不含任何字段信息，是装饰不是陈述。京东校招页的
      姓名 / 手机号码 / 电子邮箱三个框占位符都是"请输入"，真标签在旁文（"*姓名:"）里——
      当成权威会把三个最基础的框全拦成"认不出"。
    - **长说明文**（多行，或带"您可以…建议…"这类指导语）：它在教怎么填，不是点名字段。
      腾讯校招的"补充信息"框实测：占位符把 自我评价 / 爱好特长 / 补充信息 三个概念揉进
      一段建议里，按权威解析会因"并列"整个放弃；退回旁文后由它的真标签（"补充信息*"）
      一对一命中。
    """
    stripped = placeholder.strip()
    tail = _placeholder_prefix_tail(stripped)
    if tail is None or not tail.strip(_EMPTY_PLACEHOLDER_TAIL):
        return False
    return not (
        len(stripped) > 40
        and ("\n" in stripped or any(marker in stripped for marker in _INSTRUCTION_MARKERS))
    )


def _leading_label_segment(text: str) -> str:
    """旁文开头的一段（第一个空白之前）——光杆占位符控件的真标签通常就在这儿。

    只在光杆占位符的回退里用：**不能拿整段旁文**——那可能是区块/整表级文本，
    会把属于别的控件的词带进来（鹰角页实测：学历框的旁文里带着整块教育背景的
    "就读时间"，用整段会把学历填成入学时间）。
    """
    head = re.split(r"[\s　]+", text.strip(), maxsplit=1)[0]
    return head.strip(" 　-—*＊:：")
