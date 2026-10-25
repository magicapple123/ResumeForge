# SPDX-License-Identifier: Apache-2.0
"""C6/R-43/R-76：仅素材字段的保存前回声阻断（MaterialOnlyEchoError）。

只素材字段（基本信息/知识产权/语言能力里没有纸面槽位的字段 + 自定义字段）可以进
模型提示词当素材，但被模型抄进 summary/项目描述等纸面正文时必须阻断保存：
- 正例：知识产权"成果类型"被抄进 summary/项目描述 → 抛结构化错误、不写库；
- 反例：同一个字符串本来就是可上纸面字段的值（如项目成果类型）→ 误报抑制；
- 反例：干净正文 → 通过；
- 端到端：后台任务（失败任务 + 无简历落库）与 SSE（error 事件 + 无记录）两条入口。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.schemas.resume import ResumeContent, ResumeProject
from app.services.resume.generation_postprocess import (
    MaterialOnlyEchoError,
    block_material_only_echo,
    enforce_material_only_echo,
)
from app.services.resume.resume_generate_runner import reset_resume_generate_runner
from tests.resume_generate_task_support import (
    _configure,
    _seed_profile,
    _wait_terminal,
)

ECHO_VALUE = "示例独有成果类型"


@pytest.fixture(autouse=True)
def _isolate_runner(clean_db):
    reset_resume_generate_runner()
    yield
    reset_resume_generate_runner()


def _spec(
    field_id: str,
    key: str,
    label: str,
    field_type: str = "single_line",
    *,
    is_builtin: bool = True,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id=field_id,
        key=key,
        label=label,
        field_type=field_type,
        order=1,
        llm_allowed=True,
        webform_allowed=True,
        private=False,
        is_builtin=is_builtin,
    )


def _section(
    key: str,
    name: str,
    fields: list[ConsumedFieldSpec],
    entries: list[ConsumedEntry],
    *,
    form: str = "multi",
    material_only: bool = False,
) -> ConsumedSection:
    return ConsumedSection(
        key=key,
        name=name,
        form=form,
        carrier_field_id=None,
        material_only=material_only,
        primary_field_id=None,
        fields=tuple(fields),
        entries=tuple(entries),
        revision=1,
    )


def _entry(entry_id: str, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=0, values=values)


def _consumed() -> ConsumedProfile:
    patents = _section(
        "patents",
        "知识产权",
        [
            _spec("patents.title", "title", "名称"),
            _spec("patents.outcome_type", "outcome_type", "成果类型"),
            _spec("cf-patent", "note", "合作方", is_builtin=False),
        ],
        [_entry("p1", {"patents.title": "示例专利", "patents.outcome_type": ECHO_VALUE})],
        material_only=True,
    )
    languages = _section(
        "languages",
        "语言能力",
        [
            _spec("languages.language", "language", "语言"),
            _spec("languages.level", "level", "水平/等级"),
        ],
        [_entry("l1", {"languages.language": "英语", "languages.level": "熟练"})],
        material_only=True,
    )
    projects = _section(
        "projects",
        "项目经历",
        [_spec("projects.name", "name", "项目名称")],
        [_entry("pr1", {"projects.name": "简历通"})],
    )
    sections = {"patents": patents, "languages": languages, "projects": projects}
    return ConsumedProfile(
        group_id="g1",
        group_name="默认组",
        is_default=True,
        participating_keys=("patents", "languages", "projects"),
        section_order=("patents", "languages", "projects"),
        workspace_revision=1,
        sections=sections,
    )


def test_material_only_value_echoed_in_summary_is_blocked():
    resume = ResumeContent(
        summary=f"本人参与研发，{ECHO_VALUE}，具备扎实工程能力。",
        projects=[ResumeProject(name="简历通", description=["开发接口"])],
    )
    with pytest.raises(MaterialOnlyEchoError) as exc:
        block_material_only_echo(resume, _consumed())
    error = exc.value
    assert error.section_key == "patents"
    assert error.field_id == "patents.outcome_type"
    assert error.path == "summary"
    assert "只作为生成素材" in error.detail
    assert ECHO_VALUE in error.detail
    assert "请在正文中删除" in error.detail
    # 传入字典封装（保存入口）返回可展示错误而不是抛异常。
    detail = enforce_material_only_echo(resume, _consumed())
    assert detail and "只作为生成素材" in detail


def test_material_only_value_echoed_in_project_description_is_blocked():
    resume = ResumeContent(
        projects=[ResumeProject(name="简历通", description=["开发接口", ECHO_VALUE])]
    )
    with pytest.raises(MaterialOnlyEchoError) as exc:
        block_material_only_echo(resume, _consumed())
    assert exc.value.section_key == "patents"
    assert exc.value.path == "projects.0.description.1"


def test_same_value_from_legal_paper_source_is_not_flagged():
    """误报抑制：同一字符串本来就在可上纸面的项目字段里 → 不算仅素材独有回声。"""
    consumed = _consumed()
    projects = consumed.sections["projects"]
    entries = (
        _entry(
            "pr1",
            {"projects.name": "简历通", "projects.outcome_type": ECHO_VALUE},
        ),
    )
    projects = ConsumedSection(
        key=projects.key,
        name=projects.name,
        form=projects.form,
        carrier_field_id=projects.carrier_field_id,
        material_only=projects.material_only,
        primary_field_id=projects.primary_field_id,
        fields=(
            _spec("projects.name", "name", "项目名称"),
            _spec("projects.outcome_type", "outcome_type", "成果类型"),
        ),
        entries=entries,
        revision=1,
    )
    consumed = ConsumedProfile(
        group_id=consumed.group_id,
        group_name=consumed.group_name,
        is_default=consumed.is_default,
        participating_keys=consumed.participating_keys,
        section_order=consumed.section_order,
        workspace_revision=consumed.workspace_revision,
        sections={**consumed.sections, "projects": projects},
    )
    resume = ResumeContent(
        summary=f"本人参与研发，{ECHO_VALUE}。",
        projects=[ResumeProject(name="简历通", description=[ECHO_VALUE])],
    )
    block_material_only_echo(resume, consumed)  # 不抛 = 通过


def test_clean_resume_passes():
    resume = ResumeContent(
        summary="具备扎实的后端工程能力。",
        projects=[ResumeProject(name="简历通", description=["开发接口"])],
    )
    assert enforce_material_only_echo(resume, _consumed()) is None


# ===== 端到端：两条保存入口都拦截且不写库 =====

_ECHO_PAYLOAD = {
    "summary": f"参与研发，{ECHO_VALUE}。",
    "projects": [
        {
            "name": "简历通",
            "role": "核心开发",
            "description": ["开发简历生成接口", ECHO_VALUE],
        }
    ],
}


class _EchoProvider(
    __import__("app.services.llm.base", fromlist=["BaseLLMProvider"]).BaseLLMProvider
):
    async def chat(self, _messages, *, thinking: bool = True):  # pragma: no cover
        raise AssertionError("合法流式 JSON 不应触发修复调用")

    async def stream_chat(self, _messages):
        yield json.dumps(_ECHO_PAYLOAD, ensure_ascii=False)


def _seed_material_source(client) -> None:
    _seed_profile(client)
    response = client.post(
        "/api/profile/sections/patents/entries",
        json={
            "values": {
                "patents.title": "示例专利",
                "patents.outcome_type": ECHO_VALUE,
            }
        },
    )
    assert response.status_code == 201, response.text


def test_background_task_blocks_echo_and_writes_no_resume(client, monkeypatch):
    _seed_material_source(client)
    _configure(client)
    monkeypatch.setattr(
        "app.services.resume.resume_generate_runner.create_provider",
        lambda resolved: _EchoProvider(resolved),
    )
    # enhance=True：允许模型改写正文，回声才会进入最终内容（关闭美化时 summary 会被回填）。
    options = {"enhance": True, "enhancement_level": "balanced"}
    started = client.post("/api/resumes/generate/tasks", json={"options": options})
    assert started.status_code == 201, started.text
    final = _wait_terminal(client, started.json()["id"])
    assert final["status"] == "failed"
    assert final["resume_id"] is None
    assert "只作为生成素材" in final["error"]
    assert client.get("/api/resumes").json()["total"] == 0


def test_sse_blocks_echo_and_writes_no_resume(client, monkeypatch):
    _seed_material_source(client)
    _configure(client)
    monkeypatch.setattr(
        "app.api.resumes.create_provider",
        lambda resolved: _EchoProvider(resolved),
    )
    response = client.post(
        "/api/resumes/generate",
        json={"options": {"enhance": True, "enhancement_level": "balanced"}},
    )
    assert response.status_code == 200
    assert '"type": "error"' in response.text or '"type":"error"' in response.text
    assert "只作为生成素材" in response.text
    assert '"saved"' not in response.text
    assert client.get("/api/resumes").json()["total"] == 0
