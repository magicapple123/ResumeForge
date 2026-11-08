# SPDX-License-Identifier: Apache-2.0
"""回收站注册表：二十三类软删内容的描述、展示名与顺序（services/trash.py 的静态一半）。

**为什么单独成模块**：trash.py 已贴 500 行硬闸门，而注册表是**纯数据 + 两个展示辅助
函数**——与软删/恢复/彻底删除的行为无关。拆出去后 trash.py 只需保留行为；注册表本身
也更容易被测试与前端契约直接引用。本次是纯搬迁：类、元组、标签、顺序与注释逐字搬来，
行为零改动。

**完整性红线**：凡是模型里带 ``deleted_at`` 列的表，都必须在本注册表登记，否则就会出现
"半软删"——列表里消失、回收站里也找不到、既不能恢复也无法彻底删除，形成永久僵尸行。
``tests/test_trash.py::test_every_deleted_at_table_is_registered`` 用 ``Base.metadata``
扫全库钉住这层一一对应。
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..models.apply import ApplyTaskItem
from ..models.assistant import ChatConversation
from ..models.claim import ClaimRecord
from ..models.glossary import ResumeGlossaryTerm
from ..models.interview_experience import InterviewExperience
from ..models.interview_review_record import InterviewReviewRecord
from ..models.job import Job
from ..models.job_preference import JobPreference
from ..models.knowledge_entry import KnowledgeEntry
from ..models.material import CandidateJob, Material
from ..models.phrase import ResumePhrase
from ..models.profile_definition import ProfileCustomField, ProfileCustomSection
from ..models.profile_entry import ProfileEntry
from ..models.profile_group import ProfileGroup
from ..models.question_bank_record import QuestionBankRecord
from ..models.referral import Referral
from ..models.reminder import Reminder
from ..models.resume import ResumeRecord
from ..models.share_package import SharePackage
from ..models.tracker import ApplicationTrack
from ..models.web_form_record import WebFormFillRecord


@dataclass(frozen=True)
class TrashSpec:
    """一类可回收内容的描述。新增一类只需要在这里加一行。

    大多数类型的标题就是某个字段（``title_field``）；个别类型（如内推）的标题由多个字段拼成，
    用 ``title_builder`` 给一个纯函数即可（优先于 ``title_field``）。
    """

    key: str
    label: str
    model: Any
    title_field: str
    subtitle_field: str = ""
    title_builder: Callable[[Any], str] | None = None


def _profile_entry_title(item: Any) -> str:
    """条目的展示标题：values 里第一个非空文本（条目没有固定的"标题列"）。

    用保存顺序（JSON 对象的插入顺序）而不是字段定义顺序：回收站只需要"让我认出这是哪一条"，
    用户填的第一项通常最能认出它；全部为空时如实显示无标题，不猜内容。
    """
    values = item.values if isinstance(item.values, dict) else {}
    for value in values.values():
        text = str(value or "").strip()
        if text:
            return text
    return "（无标题）"


def _referral_title(item: Any) -> str:
    """内推的展示标题：内推人 · 岗位（缺项时逐段省略）。"""
    parts = [
        str(getattr(item, "referrer_name", "") or "").strip(),
        str(getattr(item, "position", "") or "").strip(),
    ]
    return " · ".join(part for part in parts if part) or "（无标题）"


# 顺序即回收站的展示顺序（越靠前越常用）。
# 前六类来自迁移 0016，中四类来自迁移 0018，后三类来自迁移 0019，再两类来自迁移 0027
# （``apply_record`` / ``web_form_record``），最后是 0050 的 ``candidate_job`` 与
# 0064 的资料组/自建定义/条目——**全部含 ``deleted_at`` 列**，缺一类就是"半软删"。
TRASH_SPECS: tuple[TrashSpec, ...] = (
    TrashSpec("job", "岗位", Job, "title", "company"),
    # 备选岗位紧挨着岗位：两者只差一步导入，用户在回收站里找它们时想的是同一件事
    # （"我刚才删的那个岗位去哪了"），中间夹一堆别的类型只会让它更难找。
    TrashSpec("candidate_job", "备选岗位", CandidateJob, "title", "company"),
    TrashSpec("resume", "简历记录", ResumeRecord, "title", "company"),
    TrashSpec("track", "投递记录", ApplicationTrack, "title", "company"),
    TrashSpec("claim", "事实台账", ClaimRecord, "title", "category"),
    # 0008（T10）：求职偏好也进回收站。紧挨事实台账之后：两者都是"一行一条设定/事实"，
    # 又都不能插进岗位与备选岗位之间（那两类的相邻关系是刻意的）。
    TrashSpec("job_preference", "求职偏好", JobPreference, "kind"),
    TrashSpec("material", "资料箱材料", Material, "title", "category"),
    TrashSpec("conversation", "助手会话", ChatConversation, "title"),
    TrashSpec("interview_experience", "面经", InterviewExperience, "title", "company"),
    TrashSpec(
        "referral", "内推", Referral, "referrer_name", "company", title_builder=_referral_title
    ),
    TrashSpec("reminder", "提醒", Reminder, "title"),
    TrashSpec("share_package", "分享包", SharePackage, "title"),
    TrashSpec("question_bank_record", "题库历史", QuestionBankRecord, "resume_title", "company"),
    TrashSpec(
        "interview_review_record",
        "复盘历史",
        InterviewReviewRecord,
        "resume_title",
        "company",
    ),
    TrashSpec("knowledge_entry", "知识库", KnowledgeEntry, "title"),
    # 投递记录：一条 = 批次内的一个岗位。界面上按批次折叠，整批删就是逐条软删该批次的记录
    # （批次 ``ApplyTask`` 本身不删——删了列表会缺组、统计会跳变）。
    TrashSpec("apply_record", "投递记录", ApplyTaskItem, "job_title", "company"),
    TrashSpec("web_form_record", "网申填充记录", WebFormFillRecord, "page_title", "url"),
    # 0056（W17）：私有表达资产。标题取正文首段，副标题是类型。
    TrashSpec("phrase", "表达资产", ResumePhrase, "text", "kind"),
    # 0058（W16）：数据集级术语表。标题取原文词，副标题是目标语言。
    TrashSpec("glossary_term", "术语表", ResumeGlossaryTerm, "source_term", "language_to"),
    # 0064（F1）：新资料模型的四类用户内容。组名/自建大字段名/自建字段标签直接取列；
    # 条目没有固定标题列，取 values 里第一个非空文本（``_profile_entry_title``）。
    TrashSpec("profile_group", "组", ProfileGroup, "name"),
    TrashSpec("profile_custom_section", "自建大字段", ProfileCustomSection, "name"),
    TrashSpec("profile_custom_field", "自建小字段", ProfileCustomField, "label", "section_key"),
    TrashSpec(
        "profile_entry",
        "资料条目",
        ProfileEntry,
        "entry_id",
        "section_key",
        title_builder=_profile_entry_title,
    ),
)

# 英文界面下的类型名。键是 ``TrashSpec.key``（与语言无关），中文名仍是 ``spec.label``——
# 后者被日志、测试与中文界面直接引用，不能动。前端把这一份当"标签表"渲染筛选器，
# 所以只有在这里给出英文，en-US 下的筛选器才不会露中文。
TRASH_LABELS_EN: dict[str, str] = {
    "job": "Jobs",
    "candidate_job": "Candidate jobs",
    "resume": "Resumes",
    "track": "Applications",
    "claim": "Fact ledger",
    "job_preference": "Job preferences",
    "material": "Material library",
    "conversation": "Assistant chats",
    "interview_experience": "Interview notes",
    "referral": "Referrals",
    "reminder": "Reminders",
    "share_package": "Share packages",
    "question_bank_record": "Question bank history",
    "interview_review_record": "Review history",
    "knowledge_entry": "Knowledge base",
    "apply_record": "Apply records",
    "web_form_record": "Form fill records",
    "phrase": "Phrase assets",
    "glossary_term": "Glossary",
    "profile_group": "Profile plans",
    "profile_custom_section": "Custom Sections",
    "profile_custom_field": "Custom Fields",
    "profile_entry": "Profile entries",
}


def labels(locale: str | None) -> dict[str, str]:
    """回收站类型名：en-US 用英文表，其余（含未设置）保持中文原文。"""
    if locale == "en-US":
        return {spec.key: TRASH_LABELS_EN.get(spec.key, spec.label) for spec in TRASH_SPECS}
    return {spec.key: spec.label for spec in TRASH_SPECS}


TRASH_SPEC_BY_KEY: dict[str, TrashSpec] = {spec.key: spec for spec in TRASH_SPECS}

# 注册表里的表名。**由注册表推导**而不是再写一份清单：迁移（``0016``）也要声明"给哪些表加了
# deleted_at"，两处各写一份必然漂移——漂移的后果是某张表有列却没进回收站（删了就直接消失），
# 或者进了回收站却没有列（一删就报错）。有测试把两边对齐。
TRASHED_TABLES: tuple[str, ...] = tuple(spec.model.__tablename__ for spec in TRASH_SPECS)


__all__ = [
    "TRASHED_TABLES",
    "TRASH_LABELS_EN",
    "TRASH_SPECS",
    "TRASH_SPEC_BY_KEY",
    "TrashSpec",
    "labels",
]
