# SPDX-License-Identifier: Apache-2.0
"""详情页正文的本地切分（自 ``extractor.py`` 拆出：文件行数预算）。

只做"页面文本 → 三段 JD + 标签字段"的纯文本处理，不认识 ``page`` 对象、不联网、不调模型：

- ``split_lines`` / ``title_neighborhood``：标题邻域证据（CR-39 的岗位类型标签）；
- ``trim_detail_text``：截出正文（从第一个 JD 小标题附近到相关推荐/页脚之前）；
- ``local_detail``：切分 JD + 标签字段（公司/地点/薪资/发布时间）+ 状态。

``extractor.py`` 仍从本模块再导出 ``DetailResult`` 与 ``trim_detail_text``——测试与调用方
一直按那个路径导入，搬走而不留出口会让它们静默失去约束力。
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .field_rules import clip_field, heading_kind, infer_status, split_jd_sections


@dataclass
class DetailResult:
    fields: dict[str, str] = field(default_factory=dict)
    evidence: dict[str, str] = field(default_factory=dict)
    jd_split: bool = False
    warnings: list[str] = field(default_factory=list)
    #: 平台适配器认出来的 ATS 名（R-15 B：greenhouse / lever / workday）；空串 = 通用路径。
    platform: str = ""


def split_lines(text: str) -> list[str]:
    return [line for line in (text or "").splitlines() if line.strip()]


#: 「标题附近」取几行（不含标题行）：岗位类型标签就贴在标题旁边。
_TITLE_NEIGHBOR_LINES = 5


def title_neighborhood(text: str, title: str) -> str:
    """标题行 + 其后 5 行，作为岗位类型的「页面明确标签」证据。

    只往后取、不往前取：页头导航里也有「校园招聘」，往前取会把实习岗误判成校招（CR-39）。
    浏览器渲染时标题与标签可能被并进同一行（``AI产品实习生实习-日常实习``），所以整行
    匹配不上时再按「包含」找；仍找不到就返回空串，让上层退回 URL 频道推断。
    """
    wanted = re.sub(r"\s+", "", title or "")
    if not wanted:
        return ""
    lines = split_lines(text)
    index = next((i for i, line in enumerate(lines) if re.sub(r"\s+", "", line) == wanted), -1)
    if index < 0:
        # 容纳「标题 + 标签」并排的同一行：只接受长度接近标题的行，避免命中整段正文。
        index = next(
            (
                i
                for i, line in enumerate(lines)
                if wanted in re.sub(r"\s+", "", line)
                and len(re.sub(r"\s+", "", line)) <= len(wanted) + 24
            ),
            -1,
        )
    if index < 0:
        return ""
    return "\n".join(lines[index : index + _TITLE_NEIGHBOR_LINES + 1])


#: 详情页正文里的「正文结束」标记：命中后不再往下读（相关推荐/页脚噪声）。
_DETAIL_STOP_MARKERS = (
    "相似职位",
    "相关推荐",
    "推荐职位",
    "热门职位",
    "猜你喜欢",
    "看过该职位的人还看了",
    "投递该职位",
    "立即投递",
    "申请职位",
    "分享到",
    "举报该职位",
    "公司信息",
    "工商信息",
    "注册协议",
    "隐私协议",
    "Copyright ©",
    "版权所有",
    "ICP备",
)
_LABELED_FIELDS = {
    "company": r"(?:公司名称|公司全称|企业名称|公司)\s*[:：]\s*([^\n]{1,64})",
    "location": r"(?:工作地点|工作城市|办公地点|职位地点|地点)\s*[:：]\s*([^\n]{1,64})",
    "salary": r"(?:薪资范围|薪酬范围|薪资|月薪|年薪)\s*[:：]\s*([^\n]{1,64})",
    "posted_at": r"(?:发布时间|发布日期|更新时间|上线时间)\s*[:：]\s*([^\n]{1,64})",
}
_LABELED_RE = {field_name: re.compile(pattern) for field_name, pattern in _LABELED_FIELDS.items()}
#: 标题定位要用「工作地点」标签判右边界，调用方只需正则本身。
LABELED_RE = _LABELED_RE


def trim_detail_text(text: str) -> str:
    """截出详情页的「正文部分」：从第一个 JD 小标题附近开始，遇到相关推荐/页脚截止。"""
    lines = split_lines(text)
    if not lines:
        return ""
    start = 0
    for index, line in enumerate(lines):
        kind = heading_kind(line)
        if kind:
            # 其他信息类标题（部门介绍/公司简介）从它自己那行开始：往前留 4 行会把
            # 「更新时间/工作地点/部门」这些元信息一起拖进正文（CR-32）。职责/要求类
            # 仍保留前 4 行，标题区上方的岗位名/公司/薪资要跟着进描述。
            start = index if kind == "additional" else max(0, index - 4)
            break
    end = len(lines)
    for index in range(start, len(lines)):
        if any(marker in lines[index] for marker in _DETAIL_STOP_MARKERS):
            end = index
            break
    return "\n".join(lines[start:end]).strip()


def labeled_values(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for name, pattern in _LABELED_RE.items():
        match = pattern.search(text or "")
        if match:
            values[name] = clip_field(name, match.group(1).strip())
    return values


def local_detail(text: str) -> tuple[DetailResult, bool]:
    """本地规则抽详情：切分 JD + 标签字段 + 状态。返回 (结果, 是否找到小标题)。"""
    content = trim_detail_text(text)
    result = DetailResult()
    if not content:
        return result, False
    split = split_jd_sections(content)
    has_heading = bool(split["split"]) or any(heading_kind(line) for line in split_lines(content))
    # 四个详情字段永远有键：空字符串 = 页面未提供（17B 的 not_on_page），
    # 不用「键缺失」表达缺失，避免调用方把没抓到当没这个字段。
    fields: dict[str, str] = {
        "description": str(split["description"]).strip(),
        "requirements": str(split["requirements"]).strip(),
        "additional_info": str(split["additional_info"]).strip(),
        "status": infer_status(text),
    }
    fields.update(labeled_values(text))
    result.fields = fields
    result.jd_split = bool(split["split"])
    result.evidence = {name: value[:160] for name, value in fields.items() if value}
    return result, has_heading


#: 详情四段里算「正文长度」的三段（status 不算）。
_JD_FIELDS = ("description", "requirements", "additional_info")


def jd_total_len(fields: dict[str, str]) -> int:
    """三段合计长度：只看 description 会把「职责 161 字 + 要求 151 字」误判成正文太短（CR-32）。"""
    return sum(len(str(fields.get(name, ""))) for name in _JD_FIELDS)


__all__ = [
    "DetailResult",
    "jd_total_len",
    "local_detail",
    "split_lines",
    "title_neighborhood",
    "trim_detail_text",
]
