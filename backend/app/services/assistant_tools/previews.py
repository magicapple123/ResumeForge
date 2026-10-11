"""写工具的写入预览（RF-01）。

每个 ``writes=True`` 的工具都必须注册一个 ``preview``：只读复刻 handler 的写入
意图（目标/字段差异/影响范围），**绝不提前执行写入**，也不做 handler 才做的
schema 校验（那会在执行时发生）。守卫测试钉住"writes=True 必须有 preview"。

预览是**尽力而为**的展示：目标记录读不到（不存在/已软删）时仍返回差异清单，
并在 scope 里注明"目标可能不存在"——诚实优于静默。
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models.assistant import AssistantSkill
from ...models.job import Job
from ...models.material import CandidateJob, Material
from ...models.resume import ResumeRecord
from ...models.resume_template import ResumeTemplate
from ...models.tracker import ApplicationTrack
from .. import trash
from .authorization import FieldChange, WritePreview

# ---------------------------------------------------------------------------
# 通用助手
# ---------------------------------------------------------------------------

_JOB_FIELDS = {
    "title": "岗位名称",
    "company": "公司",
    "location": "地点",
    "salary": "薪资",
    "job_type": "类型",
    "description": "职责",
    "requirements": "任职要求",
    "additional_info": "补充信息",
    "source_url": "投递链接",
    "posted_at": "发布时间",
    "status": "状态",
    "favorite": "收藏",
    "note": "备注",
}
_TRACK_FIELDS = {
    "company": "公司",
    "title": "岗位",
    "status": "状态",
    "stage_note": "阶段说明",
    "applied_at": "投递日期",
    "status_date": "状态日期",
    "next_action": "下一步",
    "next_action_date": "下一步日期",
    "note": "备注",
    "evidence": "依据摘录",
    "job_id": "关联岗位 id",
    "resume_id": "关联简历 id",
}
_PROFILE_FIELDS = {
    "name": "姓名",
    "gender": "性别",
    "birth_year": "出生年份",
    "phone": "电话",
    "email": "邮箱",
    "city": "所在城市",
    "target_city": "期望城市",
    "job_intent": "求职意向",
    "personal_website": "个人网站",
    "github": "GitHub",
    "summary": "个人总结",
}
_MATERIAL_FIELDS = {"title": "标题", "category": "分类", "content": "正文", "url": "链接", "note": "备注"}
_CLAIM_FIELDS = {
    "title": "标题",
    "subject": "主体",
    "source_fact": "原始事实",
    "candidate_wording": "简历表述",
    "responsibility_level": "承担程度",
    "boundary": "个人边界",
    "risk_notes": "风险点",
}
_CANDIDATE_FIELDS = {"title": "岗位名称", "company": "公司", "raw_text": "原文", "note": "备注"}
_SKILL_FIELDS = {"name": "名称", "description": "适用场景", "prompt": "提示词", "enabled": "启用", "files": "知识文件"}
_TEMPLATE_FIELDS = {
    "name": "模板名称",
    "description": "说明",
    "template": "版式模板",
    "page_limit": "页数上限",
    "font_scale": "字号系数",
}
_KNOWLEDGE_FIELDS = {"title": "标题", "category": "分类", "tags": "标签", "content": "正文", "source": "来源"}


def _text(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "是" if value else "否"
    text = str(value)
    return text if len(text) <= 200 else text[:200] + "…"


def _create_changes(arguments: dict, labels: dict[str, str]) -> list[FieldChange]:
    """新建类工具：把 arguments 里出现的已知字段列成"新增"差异。"""
    return [
        FieldChange(field=labels.get(key, key), before=None, after=_text(value))
        for key, value in arguments.items()
        if value not in (None, "") and (key in labels or isinstance(value, (str, int, float, bool, list)))
    ]


def _update_changes(db: Session, model: type, record_id: int, arguments: dict, labels: dict[str, str]):
    """修改类工具：读当前记录取 before 值（读不到按新增处理，scope 里注明）。"""
    record = trash.get_live(db, model, record_id) if record_id else None
    changes = []
    for key, value in arguments.items():
        if key not in labels or value is None:
            continue
        before = getattr(record, key, None) if record is not None else None
        changes.append(FieldChange(field=labels[key], before=_text(before), after=_text(value)))
    return record, changes


def _create_preview(target: str, changes: list[FieldChange]) -> WritePreview:
    return WritePreview(target=target, scope=f"新增 1 条（{len(changes)} 个字段）", changes=changes)


def _update_preview(target: str, record: Any, changes: list[FieldChange]) -> WritePreview:
    scope = f"修改 {len(changes)} 个字段"
    if record is None:
        scope += "（目标可能不存在，执行时会报错）"
    return WritePreview(target=target, scope=scope, changes=changes)


# ---------------------------------------------------------------------------
# 岗位 / 个人资料 / 求职进度（core）
# ---------------------------------------------------------------------------

def preview_create_job(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("岗位广场新岗位", _create_changes(arguments, _JOB_FIELDS))


def preview_update_job(db: Session, arguments: dict) -> WritePreview:
    record, changes = _update_changes(db, Job, int(arguments.get("job_id") or 0), arguments, _JOB_FIELDS)
    title = getattr(record, "title", None)
    return _update_preview(f"岗位「{title or arguments.get('job_id')}」", record, changes)


def preview_update_profile(db: Session, arguments: dict) -> WritePreview:
    changes = [
        FieldChange(field=_PROFILE_FIELDS.get(key, key), before=None, after=_text(value))
        for key, value in arguments.items()
        if value not in (None, "")
    ]
    return WritePreview(target="个人资料基础字段", scope=f"修改 {len(changes)} 个字段（其余字段保留）", changes=changes)


def preview_create_application_track(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("求职进度新记录", _create_changes(arguments, _TRACK_FIELDS))


def preview_update_application_track(db: Session, arguments: dict) -> WritePreview:
    record, changes = _update_changes(
        db, ApplicationTrack, int(arguments.get("track_id") or 0), arguments, _TRACK_FIELDS
    )
    name = f"{getattr(record, 'company', '')} · {getattr(record, 'title', '')}".strip(" ·")
    return _update_preview(f"求职进度「{name or arguments.get('track_id')}」", record, changes)


def preview_add_profile_entry(db: Session, arguments: dict) -> WritePreview:
    section = str(arguments.get("section") or "")
    changes = [
        FieldChange(field=key, before=None, after=_text(value))
        for key, value in arguments.items()
        if key != "section" and value not in (None, "")
    ]
    return WritePreview(target=f"个人资料「{section}」分区", scope="追加 1 条（现有条目不受影响）", changes=changes)


# ---------------------------------------------------------------------------
# 资料域（data_tools）
# ---------------------------------------------------------------------------

def preview_create_material(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("资料箱新资料", _create_changes(arguments, _MATERIAL_FIELDS))


def preview_update_material(db: Session, arguments: dict) -> WritePreview:
    record, changes = _update_changes(db, Material, int(arguments.get("material_id") or 0), arguments, _MATERIAL_FIELDS)
    return _update_preview(f"资料「{getattr(record, 'title', '') or arguments.get('material_id')}」", record, changes)


def preview_create_claim(db: Session, arguments: dict) -> WritePreview:
    preview = _create_preview("事实台账新条目（状态一律为待确认）", _create_changes(arguments, _CLAIM_FIELDS))
    return preview


def preview_update_claim(db: Session, arguments: dict) -> WritePreview:
    # Claim 不走 trash.get_live（handler 用 claim_or_none），这里保持同口径。
    from ..claims import claim_or_none

    record = claim_or_none(db, int(arguments.get("claim_id") or 0))
    changes = []
    for key, value in arguments.items():
        if key not in _CLAIM_FIELDS or value is None:
            continue
        changes.append(
            FieldChange(field=_CLAIM_FIELDS[key], before=_text(getattr(record, key, None)), after=_text(value))
        )
    return _update_preview(f"台账条目「{getattr(record, 'title', '') or arguments.get('claim_id')}」", record, changes)


def preview_create_candidate_job(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("备选岗位新记录", _create_changes(arguments, _CANDIDATE_FIELDS))


def preview_update_candidate_job(db: Session, arguments: dict) -> WritePreview:
    record, changes = _update_changes(
        db, CandidateJob, int(arguments.get("candidate_id") or 0), arguments, _CANDIDATE_FIELDS
    )
    return _update_preview(
        f"备选岗位「{getattr(record, 'title', '') or arguments.get('candidate_id')}」", record, changes
    )


def preview_import_candidate_job(db: Session, arguments: dict) -> WritePreview:
    record = trash.get_live(db, CandidateJob, int(arguments.get("candidate_id") or 0))
    name = f"{getattr(record, 'company', '')} {getattr(record, 'title', '')}".strip()
    return WritePreview(
        target=f"备选岗位「{name or arguments.get('candidate_id')}」→ 岗位广场正式岗位",
        scope="导入 1 条（重复导入会返回已有岗位，不会创建第二份）",
        changes=[],
    )


def preview_create_skill(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("助手技能新技能", _create_changes(arguments, _SKILL_FIELDS))


def preview_update_skill(db: Session, arguments: dict) -> WritePreview:
    record = db.get(AssistantSkill, int(arguments.get("skill_id") or 0))
    changes = []
    for key, value in arguments.items():
        if key not in _SKILL_FIELDS or value is None:
            continue
        changes.append(
            FieldChange(field=_SKILL_FIELDS[key], before=_text(getattr(record, key, None)), after=_text(value))
        )
    return _update_preview(
        f"助手技能「{getattr(record, 'name', '') or arguments.get('skill_id')}」"
        + ("（传 files 会整体替换知识文件）" if "files" in arguments else ""),
        record,
        changes,
    )


def preview_create_format_template(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("自制格式模板新模板（只调版式参数）", _create_changes(arguments, _TEMPLATE_FIELDS))


def preview_update_format_template(db: Session, arguments: dict) -> WritePreview:
    record = None
    template_id = arguments.get("template_id")
    if template_id:
        record = trash.get_live(db, ResumeTemplate, int(template_id))
    elif arguments.get("template_name"):
        record = (
            db.query(ResumeTemplate)
            .filter(ResumeTemplate.name == str(arguments["template_name"]))
            .first()
        )
    changes = [
        FieldChange(field=_TEMPLATE_FIELDS.get(key, key), before=_text(getattr(record, key, None)), after=_text(value))
        for key, value in arguments.items()
        if key not in {"template_id", "template_name"} and value is not None
    ]
    return _update_preview(f"格式模板「{getattr(record, 'name', '') or arguments.get('template_id')}」", record, changes)


# ---------------------------------------------------------------------------
# 报告域（report_tools / reminder_tools）
# ---------------------------------------------------------------------------

def preview_update_resume(db: Session, arguments: dict) -> WritePreview:
    labels = {"favorite": "收藏", "note": "备注"}
    record, changes = _update_changes(db, ResumeRecord, int(arguments.get("resume_id") or 0), arguments, labels)
    return _update_preview(f"简历「{getattr(record, 'title', '') or arguments.get('resume_id')}」", record, changes)


def preview_update_resume_layout(db: Session, arguments: dict) -> WritePreview:
    labels = {"template": "版式模板", "page_limit": "页数上限", "font_scale": "字号系数"}
    record, changes = _update_changes(db, ResumeRecord, int(arguments.get("resume_id") or 0), arguments, labels)
    return _update_preview(
        f"简历「{getattr(record, 'title', '') or arguments.get('resume_id')}」的版式", record, changes
    )


def preview_create_knowledge(db: Session, arguments: dict) -> WritePreview:
    return _create_preview("知识库新条目", _create_changes(arguments, _KNOWLEDGE_FIELDS))


def preview_update_knowledge(db: Session, arguments: dict) -> WritePreview:
    from ..knowledge_service import knowledge_or_none

    record = knowledge_or_none(db, int(arguments.get("knowledge_id") or 0))
    changes = []
    for key, value in arguments.items():
        if key not in _KNOWLEDGE_FIELDS or value is None:
            continue
        changes.append(
            FieldChange(field=_KNOWLEDGE_FIELDS[key], before=_text(getattr(record, key, None)), after=_text(value))
        )
    return _update_preview(f"知识库条目「{getattr(record, 'title', '') or arguments.get('knowledge_id')}」", record, changes)


def preview_create_reminder(db: Session, arguments: dict) -> WritePreview:
    labels = {"title": "标题", "remind_at": "提醒时间", "kind": "类型", "status": "状态", "note": "备注"}
    return _create_preview("日历提醒新提醒", _create_changes(arguments, labels))


def preview_update_reminder(db: Session, arguments: dict) -> WritePreview:
    from ..reminder_service import reminder_or_none

    record = reminder_or_none(db, int(arguments.get("reminder_id") or 0))
    status = str(arguments.get("status") or "")
    labels = {"pending": "待办", "done": "已完成", "dismissed": "已忽略"}
    return WritePreview(
        target=f"提醒「{getattr(record, 'title', '') or arguments.get('reminder_id')}」",
        scope=f"状态改为「{labels.get(status, status or '未指定')}」（不改提醒时间/绑定/备注）",
        changes=[
            FieldChange(field="状态", before=_text(getattr(record, "status", None)), after=_text(status or None))
        ],
    )


# ---------------------------------------------------------------------------
# p3（面经 / 内推）
# ---------------------------------------------------------------------------

def preview_create_interview_experience(db: Session, arguments: dict) -> WritePreview:
    labels = {
        "title": "标题",
        "company": "公司",
        "position": "岗位",
        "content": "正文",
        "questions": "问题清单",
        "tags": "标签",
        "source": "来源",
        "difficulty": "难度",
        "round_type": "轮次",
        "interview_date": "面试日期",
    }
    return _create_preview("面经知识库新面经", _create_changes(arguments, labels))


def preview_create_referral(db: Session, arguments: dict) -> WritePreview:
    labels = {
        "company": "公司",
        "position": "岗位",
        "referrer_name": "内推人",
        "referrer_contact": "内推人联系方式",
        "relation": "关系",
        "channel": "渠道",
        "status": "状态",
        "referral_code": "内推码",
        "submitted_at": "提交日期",
        "note": "备注",
    }
    return _create_preview("内推记录新记录", _create_changes(arguments, labels))


__all__ = [name for name in globals() if name.startswith("preview_")]
