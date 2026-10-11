"""RF-13：事实来源标注（fact_annotations）的产出与落库测试。

标注是锚定过程的副产品：grounded（值级替换成功）/ restored（匹配失败回填原文）/
enhanced_kept（美化保留）。全部离线——不调任何模型。
"""
import json

from app.schemas.job import JobOut
from app.schemas.profile import ProfileOut
from app.schemas.resume import GenerateOptions
from app.services.profile.profile_relevance import build_targeted_profile_context
from app.services.resume.resume_content import coerce_resume
from app.services.resume.resume_grounding import (
    ground_resume_facts,
    ground_resume_facts_with_annotations,
)


def make_profile() -> ProfileOut:
    return ProfileOut.model_validate(
        {
            "id": 1,
            "name": "张三",
            "email": "zhangsan@example.com",
            "experiences": [
                {
                    "id": 1,
                    "company": "某科技公司",
                    "role": "后端实习生",
                    "start_date": "2025.06",
                    "end_date": "2025.09",
                    "description": "负责 XX 服务开发，性能提升 30%",
                }
            ],
            "projects": [
                {
                    "id": 1,
                    "name": "简历通",
                    "role": "核心开发",
                    "start_date": "2025.09",
                    "end_date": "2026.08",
                    "tech_stack": "Python, FastAPI",
                    "description": "AI 定制化简历生成平台",
                    "highlights": "开源项目，已开源",
                }
            ],
            "skills": [{"id": 1, "name": "Python", "level": "熟练"}],
        }
    )


def make_job() -> JobOut:
    from datetime import datetime

    now = datetime.now()
    return JobOut.model_validate(
        {
            "id": 1,
            "title": "后端开发工程师",
            "company": "示例公司",
            "location": "北京",
            "description": "负责后端服务开发与 API 设计",
            "requirements": "熟悉 Python、FastAPI 和 React。",
            "created_at": now,
            "updated_at": now,
        }
    )


def annotations_by_path(annotations: list[dict]) -> dict[str, dict]:
    return {item["path"]: item for item in annotations}


def test_grounding_collects_grounded_restored_and_item_annotations():
    """锚定矩阵：命中的条目标 grounded；没匹配上的要点回填原文并标 restored。"""
    profile = make_profile()
    job = make_job()
    selection = build_targeted_profile_context(profile, job)
    raw = coerce_resume(
        {
            "experience": [
                {
                    "company": "某科技公司",
                    "role": "后端实习生",
                    "description": ["负责 XX 服务开发，性能提升 30%"],
                }
            ],
            "projects": [
                {
                    "name": "简历通",
                    "role": "核心开发",
                    "description": ["模型自由发挥的没有依据的要点"],
                    "highlights": [],
                }
            ],
            "skills": [{"name": "Python", "level": "精通"}],
        }
    )

    content, annotations = ground_resume_facts_with_annotations(
        raw, profile, job, selection.data
    )
    by_path = annotations_by_path(annotations)

    # 条目级：匹配成功的来源条目 → grounded，主体来自资料。
    assert by_path["experience.0"]["origin"] == "grounded"
    assert by_path["experience.0"]["source_subject"] == "某科技公司"
    assert "性能提升 30%" in (by_path["experience.0"]["source_fact"] or "")
    assert by_path["projects.0"]["origin"] == "grounded"
    assert by_path["projects.0"]["source_subject"] == "简历通"
    assert by_path["skills.0"]["origin"] == "grounded"

    # 字段级：description 完全命中 → grounded（不重复补字段级标注）。
    assert "experience.0.description" not in by_path
    # 字段级：匹配失败 → restored，source_fact 是回填的来源原文。
    assert by_path["projects.0.description"]["origin"] == "restored"
    assert "AI 定制化简历生成平台" in by_path["projects.0.description"]["source_fact"]
    # 内容值与既有行为一致：回填的是来源原文。
    assert content.projects[0].description == ["AI 定制化简历生成平台"]
    # 技能级替换成功 → grounded。
    assert content.skills[0].level == "熟练"


def test_grounding_enhance_keeps_rewrite_as_enhanced_kept():
    """美化模式：改写通过量化校验被保留 → enhanced_kept，来源事实单独留档。"""
    profile = make_profile()
    job = make_job()
    selection = build_targeted_profile_context(profile, job)
    raw = coerce_resume(
        {
            "experience": [
                {
                    "company": "某科技公司",
                    "role": "后端实习生",
                    "description": ["负责 XX 服务的开发与联调，保障接口稳定上线"],
                }
            ]
        }
    )

    content, annotations = ground_resume_facts_with_annotations(
        raw, profile, job, selection.data, enhance=True
    )
    by_path = annotations_by_path(annotations)

    assert content.experience[0].description == [
        "负责 XX 服务的开发与联调，保障接口稳定上线"
    ]
    assert by_path["experience.0.description"]["origin"] == "enhanced_kept"
    # source_fact 指向它所依据的来源原文，改写文本不重复进标注。
    assert "性能提升 30%" in by_path["experience.0.description"]["source_fact"]


def test_grounding_summary_replacement_is_marked_restored():
    """模型总结没有依据时被代码重建的摘要替换 → restored，标注带上摘要原文。"""
    profile = make_profile()
    job = make_job()
    selection = build_targeted_profile_context(profile, job)
    raw = coerce_resume(
        {
            "summary": "号称提升了 88% 的转化率",
            "experience": [
                {
                    "company": "某科技公司",
                    "role": "后端实习生",
                    "description": ["负责 XX 服务开发，性能提升 30%"],
                }
            ],
        }
    )

    content, annotations = ground_resume_facts_with_annotations(
        raw, profile, job, selection.data
    )
    by_path = annotations_by_path(annotations)

    assert by_path["summary"]["origin"] == "restored"
    assert by_path["summary"]["source_fact"] == content.summary
    assert content.summary != "号称提升了 88% 的转化率"


def test_ground_resume_facts_keeps_return_signature_compatible():
    """旧调用方（只取内容）不受影响：返回值仍是 ResumeContent，行为与标注版一致。"""
    profile = make_profile()
    job = make_job()
    selection = build_targeted_profile_context(profile, job)
    raw = coerce_resume(
        {
            "experience": [
                {
                    "company": "某科技公司",
                    "role": "后端实习生",
                    "description": ["负责 XX 服务开发，性能提升 30%"],
                }
            ]
        }
    )

    content = ground_resume_facts(raw, profile, job, selection.data)
    content_annotated, annotations = ground_resume_facts_with_annotations(
        raw, profile, job, selection.data
    )
    assert content == content_annotated
    assert isinstance(annotations, list)


def test_old_record_annotation_fallback_and_diff_not_polluted(db_session):
    """旧行（fact_annotations 为 NULL）读取 `or []` 兜底；diff 序列化只吃 content。"""
    from app.services.resume.resume_diff import _to_lines
    from app.services.resume.resume_record import save_record

    content = {
        "name": "张三",
        "summary": "后端开发",
        "experience": [],
        "education": [],
        "campus_experience": [],
        "projects": [],
        "skills": [],
        "awards": [],
    }
    annotations = [{"path": "summary", "origin": "grounded", "source_fact": "后端开发"}]
    record = save_record(
        db_session,
        content,
        [],
        None,
        "{}",
        "fake-model",
        False,
        "balanced",
        fact_annotations=annotations,
    )
    # 标注独立于 content 落库：diff 序列化（_to_lines 只序列化 content）不受污染。
    assert "fact_annotations" not in record.content
    db_session.refresh(record)
    assert record.fact_annotations == annotations
    lines_with = _to_lines(record.content)
    record.fact_annotations = None
    lines_without = _to_lines(record.content)
    assert lines_with == lines_without


def test_generator_done_event_carries_fact_annotations():
    """生成器 done 事件带出标注（与 coverage_notes / rationale 同一通道）。"""
    import asyncio

    from app.services.resume.resume_generator import ResumeGenerator
    from test_resume_generator import GOOD_RESUME, FakeProvider, make_job, make_profile

    provider = FakeProvider(stream_text=json.dumps(GOOD_RESUME, ensure_ascii=False))
    generator = ResumeGenerator(provider)

    async def collect():
        return [
            event
            async for event in generator.generate(
                make_profile(), make_job(), GenerateOptions()
            )
        ]

    events = asyncio.run(collect())
    done = next(event for event in events if event["type"] == "done")
    annotations = done["fact_annotations"]
    assert isinstance(annotations, list) and annotations
    by_path = annotations_by_path(annotations)
    # 教育条目在 GOOD_RESUME 与资料中完全一致 → grounded。
    assert by_path["education.0"]["origin"] == "grounded"
    assert by_path["education.0"]["source_subject"] == "天津工业大学"
