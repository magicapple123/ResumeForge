# SPDX-License-Identifier: Apache-2.0
"""简历完整性检查：找出正文里还没写完的地方，用于拦住"带待补标记的终稿"。

事实台账把每条主张的核实状态写成了数据，但真正会出事的是**导出那一刻**：用户把一份
还写着「【待补：具体倍数】」的 PDF 投出去，自己却没注意。这里做最后一道确定性检查——
不改内容、不做判断，只回答"还有哪些地方留着未完成标记、在第几节"。

之所以用**标记**而不是"去比对台账状态"：标记就在正文里，用户看得见也删得掉；
而"这句话对应哪条台账"需要模糊匹配，判错了会拦下本来没问题的简历。宁可少拦、
不可误拦——误拦会让用户直接关掉这个功能。
"""
from __future__ import annotations

from ...models.claim import placeholder_hit
from ...schemas.resume import ResumeContent
from .resume_rich_text import strip_markers

# 一次最多回报多少处：简历里到处是【待补】时，列一百条没有意义，
# 用户只需要知道"确实还有、去哪儿改"。
MAX_REPORTED = 8


def _check(label: str, text: str) -> str:
    """命中占位符时返回一句可直接展示给用户的定位说明。

    先剥掉字符级加粗标记：``**…**`` 只是排版，占位符判定看的是**用户看到的字**。
    """
    hit = placeholder_hit(strip_markers(text or ""))
    if not hit:
        return ""
    return f"{label} 里还有「{hit}」"


def find_incomplete(resume: ResumeContent) -> list[str]:
    """返回简历里所有未完成位置的中文说明；没有则返回空列表。"""
    found: list[str] = []

    def add(label: str, text: str) -> None:
        message = _check(label, text)
        if message:
            found.append(message)

    def add_lines(label: str, lines: list[str]) -> None:
        for index, line in enumerate(lines or [], start=1):
            add(f"{label} 第 {index} 条", line)

    add("个人总结", resume.summary)
    add("求职意向", resume.job_intent)

    for item in resume.education:
        label = f"教育经历「{item.school or '未填学校'}」"
        add(f"{label} 绩点", item.gpa)
        add_lines(f"{label} 核心课程", item.courses)
        add_lines(f"{label} 在校成果", item.achievements)

    for item in resume.experience:
        label = f"实习/工作经历「{item.company or '未填公司'}」"
        add_lines(f"{label} 工作内容", item.description)

    for item in resume.campus_experience:
        label = f"校园经历「{item.organization or '未填组织'}」"
        add_lines(f"{label} 描述", item.description)

    for item in resume.projects:
        label = f"项目经历「{item.name or '未填项目名'}」"
        add_lines(f"{label} 技术栈/工具", item.tech_stack)
        add_lines(f"{label} 描述", item.description)
        add_lines(f"{label} 亮点", item.highlights)

    for item in resume.skills:
        add(f"专业技能「{item.name or '未填技能'}」", item.level)

    for item in resume.awards:
        add(f"荣誉奖项「{item.name or '未填奖项'}」", item.description)

    # ===== W14 科研三栏目（新增字段不加就静默不查，合同 §5.6）=====
    for publication in resume.publications:
        label = f"论文「{publication.title or '未填题目'}」"
        add(f"{label} 题目", publication.title)
        add(f"{label} 期刊/会议", publication.venue)
        add(f"{label} 年份", publication.year)
    for research in resume.research_projects:
        label = f"科研项目「{research.name or '未填名称'}」"
        add(f"{label} 名称", research.name)
        add(f"{label} 起始时间", research.start_date)
        add_lines(f"{label} 描述", research.description)
    for patent in resume.patents:
        label = f"专利「{patent.title or '未填名称'}」"
        add(f"{label} 名称", patent.title)
        add(f"{label} 专利号", patent.patent_number)

    # ===== A4 资格证照（状态是枚举、不参与占位符扫描；名称/机构/日期逐个查）=====
    # 注意：**不把 status=="unknown" 当成"未完成"**——unknown 是来源事实（未核实），
    # 不是用户忘了填；把它当缺失会逼用户为了消警告去编一个状态，正是"不自动认定资格"的反面。
    for credential in resume.credentials:
        label = f"资格证照「{credential.name or '未填名称'}」"
        add(f"{label} 名称", credential.name)
        add(f"{label} 颁发机构", credential.issuer)
        add(f"{label} 签发日期", credential.issue_date)
        add(f"{label} 到期日期", credential.expiry_date)
        add(f"{label} 说明", credential.note)

    return found


def incomplete_detail(found: list[str]) -> str:
    """把发现拼成一条可直接作为 409 detail 的中文说明。"""
    if not found:
        return ""
    shown = found[:MAX_REPORTED]
    lines = "；".join(shown)
    rest = len(found) - len(shown)
    tail = f"（另有 {rest} 处未列出）" if rest > 0 else ""
    return (
        f"这份简历里还有 {len(found)} 处未完成标记，导出会把这些占位符一起带出去：{lines}{tail}。"
        "请先在简历里补齐内容或删掉标记；确实只想导出一份草稿自查时，可以选择「导出草稿」。"
    )


__all__ = ["MAX_REPORTED", "find_incomplete", "incomplete_detail"]
