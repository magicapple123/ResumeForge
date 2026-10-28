# SPDX-License-Identifier: Apache-2.0
"""F2-E：三链外剩余旧表消费者的迁移回归。

背景：F2-D 之后旧 `user_profile`/旧六表不再被写入，但批量匹配、投递取数、AI 建议、
审阅预检等链路仍直接读旧表——"新模型里编辑的资料"在这些链路不可见。这里逐个钉住：
新模型数据可见、旧表数据不再影响。

**取数边界在 2026-10-28 收窄**：AI 链路（批量匹配、建议、审阅）跟随「我的资料」当前组且
剔除隐藏字段；投递取数（`build_apply_data`）属于表单自动填充、不是 AI 取数，仍读全量。
"""

from __future__ import annotations

import json

from app.models.job import Job
from app.models.profile import Education, Project, UserProfile
from app.models.resume import ResumeRecord
from app.schemas.setting import LLMConfig
from app.services.apply._queue import build_apply_data
from app.services.job.job_match_batch import build_batch_inputs
from app.services.llm.base import BaseLLMProvider
from app.services.profile import entry_store, group_store

_NEW_NAME = "新姓名"
_NEW_PHONE = "13900000000"


def _seed_new_model(db) -> None:
    entry_store.upsert_entry(
        db,
        "basic_info",
        values={
            "basic_info.name": _NEW_NAME,
            "basic_info.phone": _NEW_PHONE,
            "basic_info.city": "天津",
            "basic_info.target_city": "北京",
            "basic_info.job_intention": "后端开发",
        },
    )
    entry_store.upsert_entry(db, "summary", values={"summary.content": "新总结"})
    entry_store.upsert_entry(
        db, "projects", values={"projects.name": "新项目", "projects.description": "新项目描述"}
    )
    entry_store.upsert_entry(db, "skills", values={"skills.name": "Python"})
    entry_store.upsert_entry(db, "educations", values={"educations.school": "新大学"})


def _seed_old_tables(db) -> None:
    """旧表里放一套明显不同的资料：任何链路若读旧表，断言会命中这些值。"""
    profile = UserProfile(
        name="旧姓名",
        phone="旧电话",
        summary="旧总结",
        section_order=["basic_info", "awards"],
    )
    db.add(profile)
    db.flush()
    db.add(Education(profile_id=profile.id, school="旧学校"))
    db.add(Project(profile_id=profile.id, name="旧项目"))
    db.commit()


def _switch_to_basic_only_group(db) -> None:
    """当前组只含基本信息：AI 链路据此裁剪，投递取数不受影响。"""
    group = group_store.create_group(db, "只有基本信息")
    row = group_store.get_group(db, group.group_id)
    group_store.set_group_members(
        db, group.group_id, ["basic_info"], expected_revision=int(row.revision or 1)
    )
    state = group_store.read_state(db)
    group_store.switch_current_group(db, group.group_id, expected_revision=int(state.revision or 1))


def _job_and_resume(db) -> tuple[Job, ResumeRecord]:
    job = Job(
        title="后端开发工程师",
        company="示例公司",
        description="负责 FastAPI 服务开发",
        requirements="熟悉 Python 和 FastAPI",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    record = ResumeRecord(
        title="张三-后端开发工程师",
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        content={"name": "张三", "projects": [{"name": "简历项目"}]},
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return job, record


def _assert_new_model_visible(text: str) -> None:
    assert _NEW_NAME in text or "新项目" in text
    assert "旧姓名" not in text and "旧项目" not in text and "旧学校" not in text


def test_interview_is_no_longer_a_profile_consumer():
    """模拟面试自 0066 起**不再读个人资料**：它只读「关联简历 + 关联岗位」。

    真实面试里面试官手里只有候选人提交的简历与招聘的 JD，多喂资料会让它问出两份材料
    之外的东西。这条断言防止有人把 `_profile_text` 悄悄加回来（那会同时破坏信息边界与
    本文件"面试读新模型资料"的旧前提——后者已不成立，所以这条用例改成守边界）。
    """
    from app.api import interview as interview_api

    assert not hasattr(interview_api, "_profile_text")
    assert not hasattr(interview_api, "project_legacy_profile")


def test_job_match_batch_reads_new_model(db_session):
    _seed_old_tables(db_session)
    _seed_new_model(db_session)
    _switch_to_basic_only_group(db_session)
    job, _record = _job_and_resume(db_session)

    inputs = build_batch_inputs(db_session, [job], force=True)

    assert len(inputs) == 1
    personal_text = inputs[0].profile_text
    assert _NEW_NAME in personal_text
    assert "新项目" not in personal_text, "批量匹配没有按当前组裁剪"
    _assert_new_model_visible(personal_text)

    # 切回默认组（含 projects）：同一调用下一次就应看到新项目，证明"后续任务跟着组走"。
    default_group = next(group for group in group_store.list_groups(db_session) if group.is_default)
    state = group_store.read_state(db_session)
    group_store.switch_current_group(
        db_session, default_group.group_id, expected_revision=int(state.revision or 1)
    )
    inputs = build_batch_inputs(db_session, [job], force=True)
    assert "新项目" in inputs[0].profile_text


def test_apply_queue_build_apply_data_reads_new_model(db_session):
    _seed_old_tables(db_session)
    _seed_new_model(db_session)
    _switch_to_basic_only_group(db_session)

    data = build_apply_data(db_session, None)

    assert data["name"] == _NEW_NAME
    assert data["phone"] == _NEW_PHONE
    assert data["city"] == "北京"  # target_city 优先，与旧口径一致
    assert data["job_intent"] == "后端开发"
    assert data["summary"] == "新总结"


class _SuggestionProvider(BaseLLMProvider):
    def __init__(self) -> None:
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.messages: list[list[dict]] = []

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.messages.append(messages)
        return json.dumps(
            {
                "suggestions": [
                    {
                        "priority": "high",
                        "section": "项目经历",
                        "issue": "项目描述可以更具体",
                        "suggestion": "补充 FastAPI 的具体职责",
                        "evidence": ["FastAPI"],
                    }
                ]
            },
            ensure_ascii=False,
        )

    async def stream_chat(self, messages: list[dict]):
        yield ""


def test_resume_suggestions_use_new_model_profile(monkeypatch, client, db_session):
    _seed_old_tables(db_session)
    _seed_new_model(db_session)
    # 不切组：默认组包含 projects，这里守的是"建议读新模型而不是旧表"。
    _job, record = _job_and_resume(db_session)
    provider = _SuggestionProvider()
    monkeypatch.setattr("app.api.resumes.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: provider)

    response = client.post(f"/api/resumes/{record.id}/suggestions")

    assert response.status_code == 200, response.text
    prompt_text = "\n".join(item["content"] for item in provider.messages[0])
    assert "新项目" in prompt_text
    assert "旧项目" not in prompt_text


def test_review_prepare_uses_new_model_profile(monkeypatch, client, db_session):
    _seed_old_tables(db_session)
    _seed_new_model(db_session)
    _job, record = _job_and_resume(db_session)

    from app.api.resumes import review_routes

    captured: dict = {}
    original = review_routes.build_profile_prompt_data

    def capture(profile):
        captured["profile"] = profile
        return original(profile)

    monkeypatch.setattr(review_routes, "build_profile_prompt_data", capture)
    response = client.post(
        f"/api/resumes/{record.id}/review/prepare",
        json={"changes": [{"path": "summary", "before": "", "after": "新总结"}]},
    )

    assert response.status_code == 200, response.text
    assert captured["profile"].name == _NEW_NAME
    assert [item.name for item in captured["profile"].projects] == ["新项目"]


def test_content_hints_use_new_model_profile(monkeypatch, db_session):
    _seed_old_tables(db_session)
    _seed_new_model(db_session)
    _job, record = _job_and_resume(db_session)

    from app.services.resume import content_relevance_hints as hints_module

    captured: dict = {}
    original = hints_module.build_job_focus

    def capture(job_out, profile):
        captured["profile"] = profile
        return original(job_out, profile)

    monkeypatch.setattr(hints_module, "build_job_focus", capture)
    hints_module.build_content_hints(db_session, record)

    assert captured["profile"].name == _NEW_NAME
    assert [item.name for item in captured["profile"].projects] == ["新项目"]


def test_templates_catalog_reads_workspace_order_not_old_profile(client, db_session):
    _seed_old_tables(db_session)  # 旧 user_profile.section_order = basic_info, awards
    updated = client.put(
        "/api/profile",
        json={"section_order": ["basic_info", "projects", "educations", "summary"]},
    )
    assert updated.status_code == 200, updated.text

    catalog = client.get("/api/resumes/templates").json()
    assert catalog["profile_section_order"][:3] == ["projects", "education", "summary"]
    # 资料页可排序的 key 来自新模型全局顺序（含 projects），不被旧表的 awards 顺序污染。
    assert "projects" in catalog["profile_section_keys"]
    assert "basic_info" in catalog["profile_section_keys"]

    from app.services.resume.resume_sections import default_section_order_config

    db_session.rollback()
    materialized = default_section_order_config(db_session)
    assert materialized is not None
    assert materialized["section_order"][:3] == ["projects", "education", "summary"]
