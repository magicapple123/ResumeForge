# SPDX-License-Identifier: Apache-2.0
"""A0 回归：任何解析/修订路径都不得悄悄丢掉已支持的栏目与稳定身份。

背景（计划 §1.1-1）：``coerce_resume`` 曾经只显式重建旧的六类栏目。于是一份含论文的
简历经过它之后论文变成 0 条；同理，条目的 ``id`` / ``point_ids`` 与
``hidden`` / ``lock_content`` / ``lock_layout`` 也会被剥掉——修订一次就"锁没了、
来源锚点没了"。这组用例先在修复前失败，修复后必须一直绿。

覆盖：
1. 解析：科研三栏（含作者顺序/is_self/状态）完整保留；
2. 解析：稳定身份与可见性/锁字段在旧六栏与科研三栏都保留；
3. 解析：未在 schema 声明的键不被无校验透传（安全边界）；
4. 修订：模型回显科研三栏时逐条保留；模型不回显 id 时由原简历按位置回填；
5. 修订：只有科研/证照类内容的有效简历不被"空简历"保护误拦（G24）；
6. 修订：真正的空输出仍然拒绝。
"""

from __future__ import annotations

import json

import pytest
from app.schemas.resume import ResumeContent
from app.services.llm.base import LLMError
from app.services.resume.resume_content import coerce_resume
from app.services.resume.resume_revision import revise_resume

RESEARCH_PAYLOAD = {
    "name": "张三",
    "publications": [
        {
            "title": "高并发交易链路稳定性实践",
            "authors": [
                {"name": "张三", "is_self": True, "corresponding": True},
                {"name": "李四"},
            ],
            "venue": "软件工程实践",
            "year": "2024",
            "status": "under_review",
            "doi": "10.1000/example",
            "url": "https://doi.example.org/10.1000/example",
            "volume_pages": "12(3): 45-67",
            "note": "通讯作者",
        }
    ],
    "research_projects": [
        {
            "name": "分布式交易一致性研究",
            "role": "负责人",
            "organization": "示例实验室",
            "start_date": "2022.09",
            "end_date": "2024.06",
            "funding": "国家自然科学基金",
            "description": ["研究跨库事务一致性。"],
            "outcomes": ["形成补偿框架。"],
        }
    ],
    "patents": [
        {
            "title": "一种交易幂等补偿方法",
            "inventors": [{"name": "张三", "is_self": True}],
            "patent_number": "CN202310000001",
            "country": "中国",
            "status": "granted",
            "filed_date": "2023.01",
            "granted_date": "2024.02",
        }
    ],
}


# ===== 1. 解析层 =====


def test_coerce_keeps_research_sections():
    resume = coerce_resume(RESEARCH_PAYLOAD)

    assert len(resume.publications) == 1
    publication = resume.publications[0]
    assert publication.title == "高并发交易链路稳定性实践"
    assert [author.name for author in publication.authors] == ["张三", "李四"]
    assert publication.authors[0].is_self is True
    assert publication.authors[0].corresponding is True
    assert publication.status == "under_review"
    assert publication.doi == "10.1000/example"

    assert len(resume.research_projects) == 1
    project = resume.research_projects[0]
    assert project.organization == "示例实验室"
    assert project.funding == "国家自然科学基金"
    assert project.description == ["研究跨库事务一致性。"]

    assert len(resume.patents) == 1
    patent = resume.patents[0]
    assert patent.patent_number == "CN202310000001"
    assert patent.status == "granted"
    assert patent.inventors[0].name == "张三"


def test_coerce_keeps_identity_visibility_and_lock_fields():
    payload = {
        "name": "张三",
        "education": [
            {
                "school": "示例大学",
                "id": "edu_12345678",
                "point_ids": {"courses": ["crs_12345678"]},
                "courses": ["编译原理"],
                "hidden": False,
                "hidden_points": ["crs_12345678"],
                "lock_content": True,
                "lock_layout": True,
            }
        ],
        "publications": [
            {
                "title": "论文 A",
                "id": "pub_12345678",
                "hidden": True,
                "lock_content": True,
            }
        ],
    }

    resume = coerce_resume(payload)
    education = resume.education[0]
    assert education.id == "edu_12345678"
    assert education.point_ids == {"courses": ["crs_12345678"]}
    assert education.hidden is False
    assert education.hidden_points == ["crs_12345678"]
    assert education.lock_content is True
    assert education.lock_layout is True

    publication = resume.publications[0]
    assert publication.id == "pub_12345678"
    assert publication.hidden is True
    assert publication.lock_content is True


def test_coerce_does_not_pass_through_unknown_fields():
    resume = coerce_resume(
        {
            "name": "张三",
            "education": [{"school": "示例大学", "evil": "<script>alert(1)</script>"}],
            "publications": [{"title": "论文 A", "render_context": {"injected": True}}],
        }
    )

    assert "evil" not in resume.education[0].model_dump()
    assert "render_context" not in resume.publications[0].model_dump()

# A4 扩展栏目与可选字段（契约 §4）：解析/修订都必须保留，且没值时旧键集不变。
A4_PAYLOAD = {
    "credentials": [
        {
            "name": "注册信息安全专业人员",
            "issuer": "中国信息安全测评中心",
            "issue_date": "2021-06",
            "expiry_date": "2027-06",
            "status": "active",
            "verify_url": "https://verify.example.org/cisp",
            "note": "状态以颁证机构查询结果为准",
            "id": "cred_12345678",
        }
    ],
    "projects": [
        {
            "name": "统一网关平台",
            "role": "负责人",
            "public_url": "https://example.com/gateway",
            "artifact_type": "开源工具",
            "description": ["统一接入与配额管理"],
            "id": "prj_12345678",
        }
    ],
    "experience": [
        {
            "company": "示例科技有限公司",
            "role": "示例岗位",
            "experience_kind": "contract",
            "description": ["负责示例模块开发"],
        }
    ],
}


def test_coerce_keeps_credentials_and_new_optional_fields():
    """coerce 落到 _ENTRY_MODELS 登记处：证照/作品链接/关系类型不会被解析层剥掉。"""
    resume = coerce_resume({"name": "张三", **A4_PAYLOAD})

    credential = resume.credentials[0]
    assert credential.name == "注册信息安全专业人员"
    assert credential.issuer == "中国信息安全测评中心"
    assert credential.status == "active"
    assert credential.verify_url == "https://verify.example.org/cisp"
    assert credential.id == "cred_12345678"
    # 证号不在 schema 里：即使原始 JSON 带了也不会进入模型。
    assert not hasattr(credential, "credential_number")

    assert resume.projects[0].public_url == "https://example.com/gateway"
    assert resume.projects[0].artifact_type == "开源工具"
    assert resume.experience[0].experience_kind == "contract"


# ===== 2. 修订层 =====


def _research_resume() -> ResumeContent:
    return ResumeContent.model_validate(
        {
            "name": "张三",
            "phone": "13800000000",
            "email": "zhang@example.com",
            "summary": "一段总结",
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "示例岗位",
                    "description": ["负责示例模块开发"],
                    "id": "exp_12345678",
                    "lock_content": True,
                }
            ],
            **{key: value for key, value in RESEARCH_PAYLOAD.items() if key != "name"},
        }
    )


def _model_payload(summary: str = "改过的总结") -> str:
    """模型输出：完整回显业务内容（不含身份字段，id 也故意不回显）。"""
    return json.dumps(
        {
            "summary": summary,
            "experience": [
                {
                    "company": "示例科技有限公司",
                    "role": "示例岗位",
                    "description": ["负责示例模块开发"],
                }
            ],
            **RESEARCH_PAYLOAD,
        },
        ensure_ascii=False,
    )


@pytest.mark.asyncio
async def test_revision_keeps_research_sections():
    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return _model_payload()

    revised = await revise_resume(FakeProvider(), _research_resume(), None, "把总结改得更精炼")

    assert revised.summary == "改过的总结"
    assert len(revised.publications) == 1
    assert revised.publications[0].status == "under_review"
    assert [author.name for author in revised.publications[0].authors] == ["张三", "李四"]
    assert revised.research_projects[0].funding == "国家自然科学基金"
    assert revised.patents[0].patent_number == "CN202310000001"


@pytest.mark.asyncio
async def test_revision_restores_identity_when_model_does_not_echo_ids():
    """模型看不到/不回显 id 是常态：修订后身份必须按原简历回填，否则锁与来源断链。"""

    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return _model_payload()

    original = _research_resume()
    revised = await revise_resume(FakeProvider(), original, None, "把总结改得更精炼")

    assert revised.experience[0].id == "exp_12345678"
    assert revised.publications[0].id == original.publications[0].id



def _a4_resume() -> ResumeContent:
    return ResumeContent.model_validate({"name": "张三", "summary": "一段总结", **A4_PAYLOAD})


def _a4_model_payload() -> str:
    """模型输出：回显扩展栏目业务内容，但**不回显 id**（真实常态）。"""
    data = json.loads(json.dumps(A4_PAYLOAD, ensure_ascii=False))
    for section in ("credentials", "projects"):
        for entry in data[section]:
            entry.pop("id", None)
    data["summary"] = "改过的总结"
    return json.dumps(data, ensure_ascii=False)


@pytest.mark.asyncio
async def test_revision_keeps_credentials_and_new_fields():
    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return _a4_model_payload()

    original = _a4_resume()
    revised = await revise_resume(FakeProvider(), original, None, "把总结改得更精炼")

    assert revised.summary == "改过的总结"
    credential = revised.credentials[0]
    assert credential.name == "注册信息安全专业人员"
    assert credential.issuer == "中国信息安全测评中心"
    # 状态是事实锁字段：修订不得把它升级成"已取得"。
    assert credential.status == "active"
    assert credential.verify_url == "https://verify.example.org/cisp"
    # 模型不回显 id 时按原简历回填（锁/来源/排版的锚点不断链）。
    assert credential.id == "cred_12345678"
    assert revised.projects[0].public_url == "https://example.com/gateway"
    assert revised.projects[0].artifact_type == "开源工具"
    assert revised.projects[0].id == "prj_12345678"
    assert revised.experience[0].experience_kind == "contract"


@pytest.mark.asyncio
async def test_revision_accepts_credentials_only_resume():
    """G24 同类：只有证照的有效简历不能被"旧六栏"空简历判据误拦。"""

    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return json.dumps(
                {"credentials": [{"name": "注册会计师", "issuer": "财政部", "status": "pending"}]},
                ensure_ascii=False,
            )

    original = ResumeContent.model_validate(
        {"credentials": [{"name": "注册会计师", "issuer": "财政部", "status": "pending"}]}
    )
    revised = await revise_resume(FakeProvider(), original, None, "")
    assert revised.credentials[0].name == "注册会计师"
    assert revised.credentials[0].status == "pending"


@pytest.mark.asyncio
async def test_revision_prompt_requires_extended_section_fidelity():
    """模型整段丢弃科研/证照是真实风险：提示词必须给出逐字保留与禁止状态升级。"""
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            captured["prompt"] = messages[-1]["content"]
            return json.dumps(
                {"publications": RESEARCH_PAYLOAD["publications"]}, ensure_ascii=False
            )

    original = ResumeContent.model_validate({"publications": RESEARCH_PAYLOAD["publications"]})
    await revise_resume(FakeProvider(), original, None, "把总结改得更精炼")

    prompt = captured["prompt"]
    assert "扩展栏目保真" in prompt
    assert "状态不得升级" in prompt
    assert "不得写成已发表" in prompt
    assert "作者 / 发明人的顺序与本人标记" in prompt
    assert "不新增简历中没有提供的证照编号" in prompt


@pytest.mark.asyncio
async def test_revision_prompt_has_no_extended_block_without_new_sections():
    """没有扩展字段时旧提示词逐字节不变：不得出现扩展栏目保真块。"""
    captured: dict[str, str] = {}

    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            captured["prompt"] = messages[-1]["content"]
            return json.dumps(
                {"summary": "改过的总结", "experience": [{"company": "甲公司"}]},
                ensure_ascii=False,
            )

    original = ResumeContent(
        name="张三", summary="总结", experience=[{"company": "甲公司"}]
    )
    await revise_resume(FakeProvider(), original, None, "改一下")

    prompt = captured["prompt"]
    assert "扩展栏目保真" not in prompt
    assert "证照编号" not in prompt
    assert prompt.count("## 修改要求") == 1


def test_revise_api_restores_locks_and_research_fields(client, monkeypatch):
    """API 级：修订一次之后，锁标记、稳定 id、科研三栏都还在（不是只有纯函数对）。"""
    from app.database import SessionLocal
    from app.models.resume import ResumeRecord
    from app.schemas.setting import LLMConfig

    config = LLMConfig(
        base_url="https://api.example.com/v1",
        api_key="integration-secret",
        model="integration-model",
    )
    assert client.put("/api/settings/llm", json=config.model_dump()).status_code == 200

    created = client.post(
        "/api/resumes/manual",
        json={
            "job_id": None,
            "content": {
                "name": "张示例",
                "summary": "原始总结",
                "experience": [
                    {
                        "company": "示例公司",
                        "role": "工程师",
                        "description": ["原有要点"],
                        "id": "exp_12345678",
                        "lock_content": True,
                    }
                ],
                "publications": [
                    {
                        "title": "论文 A",
                        "authors": [{"name": "张示例", "is_self": True}],
                        "status": "under_review",
                        "id": "pub_12345678",
                    }
                ],
            },
        },
    )
    assert created.status_code == 201, created.text
    record_id = created.json()["id"]

    class FakeProvider:
        async def chat(self, _messages, *, thinking: bool = True):
            return json.dumps(
                {
                    "summary": "修订后的总结",
                    "experience": [
                        {"company": "示例公司", "role": "工程师", "description": ["原有要点"]}
                    ],
                    "publications": [
                        {
                            "title": "论文 A",
                            "authors": [{"name": "张示例", "is_self": True}],
                            "status": "under_review",
                        }
                    ],
                },
                ensure_ascii=False,
            )

    monkeypatch.setattr("app.api.resumes.create_provider", lambda _config: FakeProvider())
    response = client.post(f"/api/resumes/{record_id}/revise", json={"instructions": "改总结"})
    assert response.status_code == 200, response.text
    content = response.json()["content"]
    assert content["summary"] == "修订后的总结"
    assert content["experience"][0]["id"] == "exp_12345678"
    assert content["experience"][0]["lock_content"] is True
    assert content["publications"][0]["id"] == "pub_12345678"
    assert content["publications"][0]["status"] == "under_review"

    # 落库后重新读取仍是同一份（不是只在响应里临时拼好）。
    db = SessionLocal()
    try:
        stored = db.get(ResumeRecord, record_id).content
    finally:
        db.close()
    assert stored["publications"][0]["id"] == "pub_12345678"
    assert stored["experience"][0]["lock_content"] is True


@pytest.mark.asyncio
async def test_revision_accepts_research_only_resume():
    """G24：只有科研内容的有效简历不能被"只检查旧六栏"的空简历保护误拦。"""

    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return json.dumps(RESEARCH_PAYLOAD, ensure_ascii=False)

    original = ResumeContent.model_validate(RESEARCH_PAYLOAD)
    revised = await revise_resume(FakeProvider(), original, None, "")

    assert len(revised.publications) == 1
    assert len(revised.research_projects) == 1
    assert len(revised.patents) == 1


@pytest.mark.asyncio
async def test_revision_still_rejects_truly_empty_output():
    class FakeProvider:
        async def chat(self, messages, *, thinking: bool = True):
            return "{}"

    with pytest.raises(LLMError):
        await revise_resume(FakeProvider(), _research_resume(), None, "只改总结")
