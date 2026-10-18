"""简历风险扫描：五类风险、只提示不改写、强主张台账联动、LLM 降级与提示词登记。"""

import asyncio
import json

from app import preflight
from app.models.claim import (
    RESPONSIBILITY_LED,
    RESPONSIBILITY_OWNER,
    RESPONSIBILITY_PARTICIPATED,
    VERIFICATION_CONFIRMED,
    VERIFICATION_REJECTED,
    ClaimRecord,
)
from app.models.resume import ResumeRecord
from app.schemas.resume import ResumeContent, ResumeProject
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMError
from app.services.resume import resume_risk as risk_module
from app.services.resume.resume_risk import MAX_DUPLICATE_RISKS, scan_local, scan_resume_risks


class RiskProvider(BaseLLMProvider):
    """返回预设 JSON 的假模型，用于可选增强路径。"""

    def __init__(self, payload):
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.payload = payload

    async def chat(self, messages, *, thinking: bool = True):
        return json.dumps(self.payload, ensure_ascii=False)

    async def stream_chat(self, messages):
        yield ""


class BrokenProvider(RiskProvider):
    async def chat(self, messages, *, thinking: bool = True):
        raise LLMError("模型调用失败")


class CapturingProvider(RiskProvider):
    """记录出站 messages 的假模型，用于断言隐私边界。"""

    def __init__(self, payload):
        super().__init__(payload)
        self.captured_messages: list | None = None

    async def chat(self, messages, *, thinking: bool = True):
        self.captured_messages = messages
        return json.dumps(self.payload, ensure_ascii=False)


def _resume_record(db_session, **kwargs):
    record = ResumeRecord(
        title=kwargs.get("title", "张三-后端开发工程师"),
        job_title="后端开发工程师",
        company="示例公司",
        content=kwargs.get("content", {"name": "张三"}),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record


def _strong_claim(**overrides):
    values = {
        "id": 42,
        "title": "主导交易系统",
        "subject": "交易系统",
        "candidate_wording": "主导交易系统从0到1建设",
        "responsibility_level": RESPONSIBILITY_LED,
        "verification_status": VERIFICATION_CONFIRMED,
        "boundary": "团队负责整体架构，我负责撮合引擎",
        "risk_notes": ["撮合延迟数据需现场核对"],
        "interview_details": {
            "decisions": ["放弃一致性哈希改用分段撮合"],
            "result": "P99 延迟降至 12ms",
        },
    }
    values.update(overrides)
    return ClaimRecord(**values)


def test_duplicate_points_are_detected():
    resume = ResumeContent(
        projects=[
            ResumeProject(name="项目A", description=["负责后端服务开发"]),
            ResumeProject(name="项目B", description=["负责后端服务开发"]),
        ]
    )
    points = scan_local(resume, [])
    duplicates = [p for p in points if p.category == "duplicate"]
    assert duplicates
    assert any("项目A" in p.location and "项目B" in p.location for p in duplicates)


def test_no_duplicate_when_points_are_unique():
    resume = ResumeContent(
        projects=[
            ResumeProject(name="项目A", description=["负责后端服务开发"]),
            ResumeProject(name="项目B", description=["负责前端页面开发"]),
        ]
    )
    points = scan_local(resume, [])
    assert not [p for p in points if p.category == "duplicate"]


def test_sensitive_risk_detected():
    resume = ResumeContent(summary="身份证号 110101199001011234，请勿泄露")
    points = scan_local(resume, [])
    sensitive = [p for p in points if p.category == "sensitive"]
    assert sensitive
    assert any(p.text == "110101199001011234" for p in sensitive)


def test_exaggeration_risk_detected():
    resume = ResumeContent(summary="精通后端开发，性能提升 300%")
    points = scan_local(resume, [])
    exaggerations = [p for p in points if p.category == "exaggeration"]
    assert any(p.text == "精通" for p in exaggerations)
    assert any(p.text == "300%" for p in exaggerations)


def test_compliance_risk_detected():
    resume = ResumeContent(summary="参与保密协议约束的核心项目")
    points = scan_local(resume, [])
    compliance = [p for p in points if p.category == "compliance"]
    assert any(p.text == "保密协议" for p in compliance)


def test_compliance_no_hit_when_clean():
    resume = ResumeContent(summary="负责后端服务开发")
    points = scan_local(resume, [])
    assert not [p for p in points if p.category == "compliance"]


def test_scan_never_mutates_resume():
    resume = ResumeContent(
        summary="精通后端开发，身份证 110101199001011234",
        projects=[
            ResumeProject(name="项目A", description=["负责后端服务开发", "负责后端服务开发"]),
        ],
    )
    snapshot = resume.model_dump()
    scan_local(resume, [])
    assert resume.model_dump() == snapshot


def test_strong_claim_linking_injects_follow_up():
    claim = _strong_claim()
    points = scan_local(ResumeContent(), [claim])
    linked = [p for p in points if p.category == "deep_dive" and p.claim_id == 42]
    assert linked
    point = linked[0]
    assert "个人边界：团队负责整体架构，我负责撮合引擎" in point.follow_up
    assert "风险备注：撮合延迟数据需现场核对" in point.follow_up
    assert any(item.startswith("关键决策：") for item in point.follow_up)
    assert any(item.startswith("结果：") for item in point.follow_up)


def test_non_strong_claim_is_not_linked():
    claim = _strong_claim(id=1, responsibility_level=RESPONSIBILITY_PARTICIPATED)
    points = scan_local(ResumeContent(), [claim])
    assert not [p for p in points if p.claim_id == 1]


def test_rejected_claim_is_not_linked():
    claim = _strong_claim(id=2, verification_status=VERIFICATION_REJECTED)
    points = scan_local(ResumeContent(), [claim])
    assert not [p for p in points if p.claim_id == 2]


def test_owner_level_is_also_a_strong_claim():
    claim = _strong_claim(id=7, responsibility_level=RESPONSIBILITY_OWNER)
    points = scan_local(ResumeContent(), [claim])
    assert [p for p in points if p.claim_id == 7]


async def test_llm_enhancement_marks_llm_used_and_merges_points():
    provider = RiskProvider(
        {
            "points": [
                {
                    "severity": "medium",
                    "text": "模型补充的深挖点",
                    "location": "正文",
                    "suggestion": "补充依据",
                    "follow_up": ["怎么验证"],
                }
            ]
        }
    )
    result = await scan_resume_risks(
        ResumeContent(summary="负责后端服务开发"), [], provider=provider, resume_id=1
    )
    assert result.llm_used is True
    assert any(p.text == "模型补充的深挖点" for p in result.points)


async def test_llm_error_degrades_to_local():
    resume = ResumeContent(summary="精通后端开发")
    result = await scan_resume_risks(resume, [], provider=BrokenProvider({}), resume_id=1)
    assert result.llm_used is False
    assert any("本地规则" in note for note in result.notes)
    assert any(p.category == "exaggeration" for p in result.points)


def test_risk_scan_endpoint_degrades_without_llm(client, db_session):
    record = _resume_record(db_session, content={"name": "张三", "summary": "精通后端开发"})
    response = client.post(f"/api/resumes/{record.id}/risk-scan")
    assert response.status_code == 200
    data = response.json()
    assert data["llm_used"] is False
    assert data["resume_id"] == record.id
    assert any(p["category"] == "exaggeration" for p in data["points"])


def test_risk_scan_endpoint_404s_for_missing_resume(client):
    response = client.post("/api/resumes/9999/risk-scan")
    assert response.status_code == 404


def test_risk_prompt_registered_in_preflight():
    covered = {relative for relative, _ in preflight._REQUIRED_FILES}
    assert "app/prompts/resume_risk.md" in covered


# ===== PR-11：畸形模型返回的降级矩阵（一律本地结果 + 降级原因，不 500） =====


async def _scan_with(provider) -> object:
    return await scan_resume_risks(
        ResumeContent(summary="精通后端开发，性能提升 300%"), [], provider=provider, resume_id=1
    )


def _assert_degraded_to_local(result) -> None:
    assert result.llm_used is False
    assert any("本地规则" in note for note in result.notes)
    assert any(p.category == "exaggeration" for p in result.points)


async def test_malformed_follow_up_degrades_to_local():
    # follow_up 期望字符串数组，模型却给了 int：修复前这里 TypeError → 整个扫描 500。
    result = await _scan_with(RiskProvider({"points": [{"text": "test", "follow_up": 42}]}))
    _assert_degraded_to_local(result)


async def test_follow_up_nested_entries_are_dropped_not_fatal():
    payload = {"points": [{"text": "有效深挖点", "follow_up": ["怎么验证", {"嵌套": "对象"}, 7]}]}
    result = await _scan_with(RiskProvider(payload))
    assert result.llm_used is True
    point = next(p for p in result.points if p.text == "有效深挖点")
    assert point.follow_up == ["怎么验证", "7"]


async def test_points_as_object_is_wrapped_into_array():
    result = await _scan_with(
        RiskProvider({"points": {"text": "对象形式的深挖点", "severity": "high"}})
    )
    assert result.llm_used is True
    assert any(p.text == "对象形式的深挖点" for p in result.points)


async def test_points_as_string_degrades_to_local():
    result = await _scan_with(RiskProvider({"points": "不是数组"}))
    _assert_degraded_to_local(result)


async def test_overlong_points_are_truncated_with_note():
    payload = {"points": [{"text": f"深挖点{index}", "severity": "low"} for index in range(30)]}
    result = await _scan_with(RiskProvider(payload))
    assert result.llm_used is True
    enhanced = [p for p in result.points if p.text.startswith("深挖点")]
    assert len(enhanced) == 20
    assert any("上限" in note for note in result.notes)


async def test_oversized_text_fields_are_truncated():
    payload = {"points": [{"text": "长" * 5000, "suggestion": "建" * 5000}]}
    result = await _scan_with(RiskProvider(payload))
    assert result.llm_used is True
    point = next(p for p in result.points if p.text.startswith("长"))
    assert len(point.text) <= 2000
    assert len(point.suggestion) <= 2000


async def test_bad_json_degrades_to_local():
    result = await _scan_with(RiskProvider("这不是 JSON"))
    _assert_degraded_to_local(result)


async def test_unexpected_internal_error_degrades_to_local():
    class ExplodingProvider(RiskProvider):
        async def chat(self, messages, *, thinking: bool = True):
            raise RuntimeError("意外内部错误")

    result = await _scan_with(ExplodingProvider({}))
    _assert_degraded_to_local(result)


# ===== PR-11：查重去重边界与预算 =====


def test_exact_duplicate_reported_once_and_not_repeated_in_similarity():
    resume = ResumeContent(
        projects=[
            ResumeProject(name="项目A", description=["负责后端服务开发与数据库设计"]),
            ResumeProject(name="项目B", description=["负责后端服务开发与数据库设计"]),
        ]
    )
    points = scan_local(resume, [])
    duplicates = [p for p in points if p.category == "duplicate"]
    # 修复前：精确重复 1 条 + 相似重复 1 条（同一对要点报两次）= 2 条。
    assert len(duplicates) == 1
    assert "项目A" in duplicates[0].location and "项目B" in duplicates[0].location


async def test_long_input_similarity_scan_is_bounded():
    lines = [f"负责第{index:03d}号模块的开发工作并完成性能优化与稳定性保障" for index in range(200)]
    resume = ResumeContent(projects=[ResumeProject(name="项目A", description=lines)])
    result = await scan_resume_risks(resume, [], provider=None, resume_id=1)
    duplicates = [p for p in result.points if p.category == "duplicate"]
    assert 0 < len(duplicates) <= MAX_DUPLICATE_RISKS
    assert any("查重" in note for note in result.notes)


# ===== PR-11：台账条目收敛（远端增强只带与当前简历关联的条目） =====


async def test_llm_prompt_only_includes_resume_linked_claims():
    linked = _strong_claim(id=1, subject="交易系统", title="主导交易系统")
    generic = _strong_claim(
        id=2,
        subject="外卖调度平台",
        title="无关主张",
        candidate_wording="主导外卖调度平台建设",
        boundary="无关边界",
    )
    resume = ResumeContent(
        projects=[ResumeProject(name="交易系统", description=["负责撮合引擎开发"])]
    )
    provider = CapturingProvider({"points": []})
    await scan_resume_risks(resume, [linked, generic], provider=provider, resume_id=1)
    assert provider.captured_messages is not None
    outbound = json.dumps(provider.captured_messages, ensure_ascii=False)
    # RR-01：台账条目**原文一律不出站**，只发结构信息（类别/承担程度/计数）。
    assert "撮合延迟数据需现场核对" not in outbound
    assert "个人边界" in outbound  # 结构字段名还在（作为"填没填"的提示）
    # 关联关系仍然可辨：只有 1 条进入 prompt（两条都发就会出现"条目 2"）。
    assert "条目 1" in outbound
    assert "条目 2" not in outbound
    assert "外卖" not in outbound  # 未关联条目不外发


async def test_llm_prompt_labels_generic_suggestions_when_no_linked_claims():
    provider = CapturingProvider({"points": []})
    await scan_resume_risks(
        ResumeContent(summary="负责后端服务开发"), [], provider=provider, resume_id=1
    )
    assert provider.captured_messages is not None
    outbound = json.dumps(provider.captured_messages, ensure_ascii=False)
    assert "全库通用准备建议" in outbound


# ===== R12：AI 增强硬上限（超时降级，不等真实 45s） =====


class SlowProvider(RiskProvider):
    """永远不返回的假模型：用来触发 ``asyncio.wait_for`` 的超时分支。"""

    def __init__(self, delay_s: float = 1.0):
        super().__init__({})
        self.delay_s = delay_s
        self.closed = False

    async def chat(self, messages, *, thinking: bool = True):
        await asyncio.sleep(self.delay_s)
        return json.dumps(self.payload, ensure_ascii=False)

    async def aclose(self):
        self.closed = True


async def test_llm_enhancement_times_out_and_degrades(monkeypatch):
    """超时必须**排在自己的异常分支**里降级，而不是当成"模型返回内容异常"。

    预算被 monkeypatch 成 50ms：真实 45s 会让这条用例变成整轮回归里最慢的一条。
    """
    monkeypatch.setattr(risk_module, "LLM_ENHANCE_TIMEOUT_S", 0.05)
    provider = SlowProvider()
    result = await scan_resume_risks(
        ResumeContent(summary="精通后端开发"), [], provider=provider, resume_id=1
    )
    assert result.llm_used is False
    assert any("超时" in note for note in result.notes)
    # 超时后仍返回本地规则结果（不是空结果，也不是 500）。
    assert any(p.category == "exaggeration" for p in result.points)
    # provider 声明了 aclose()：超时路径必须把连接收掉，否则重扫会一直占着它。
    assert provider.closed is True


async def test_llm_error_still_degrades_after_timeout_branch_added(monkeypatch):
    """加了超时分支后，LLMError 的降级语义不变（回归守卫）。"""
    monkeypatch.setattr(risk_module, "LLM_ENHANCE_TIMEOUT_S", 5.0)
    result = await scan_resume_risks(
        ResumeContent(summary="精通后端开发"), [], provider=BrokenProvider({}), resume_id=1
    )
    assert result.llm_used is False
    assert any("本地规则" in note for note in result.notes)
    assert not any("超时" in note for note in result.notes)


async def test_no_provider_stays_local_without_enhancement_notes():
    """``enhance=false`` 路径不建 provider，也就不该有任何超时/降级提示。"""
    result = await scan_resume_risks(ResumeContent(summary="精通后端开发"), [], provider=None)
    assert result.llm_used is False
    assert not any("超时" in note for note in result.notes)
    assert not any("AI 增强" in note for note in result.notes)
