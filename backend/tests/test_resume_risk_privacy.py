# SPDX-License-Identifier: Apache-2.0
"""风险扫描的出站隐私边界（PR-11 / RR-01）——从 ``test_resume_risk.py`` 拆出。

拆出原因是行数预算（两组合起来 534 行）；夹具沿用 ``test_resume_risk`` 里的假
Provider 与合成简历（该文件的先例：``tests/profile_relevance_fixtures.py`` 也是
这么 import 的）。这里钉住的是"进模型之前被拿掉了什么"：

- 出站消息里不得出现简历姓名/手机号/邮箱/公司；
- 台账条目**原文一律不出站**（只发结构信息），第三方姓名/客户/工号/联系方式都不得出现；
- 出站自由文本里的邮箱、链接、data URI 也要被抹掉；
- 远端增强有显式开关：``{"enhance": false}`` 时连 provider 都不创建，且响应把
  "有没有配置模型"（``remote_enhancement_available``）与"这次用没用"（``llm_used``）分开报。
"""

import json

from app.models.claim import ClaimRecord
from app.schemas.resume import ResumeContent, ResumeExperience
from app.schemas.setting import LLMConfig
from app.services.resume.resume_risk import scan_local, scan_resume_risks
from tests.test_resume_risk import (
    CapturingProvider,
    _resume_record,
    _strong_claim,
)

# ===== PR-11：出站隐私边界（远端增强 prompt 不得携带身份字段） =====


async def test_outbound_messages_do_not_contain_identity_fields():
    resume = ResumeContent(
        name="张三",
        phone="13800138000",
        email="zhangsan@example.com",
        summary="负责后端服务开发，联系我请拨打 13800138000",
        experience=[
            ResumeExperience(company="示例公司", description=["在示例公司负责撮合引擎开发"])
        ],
    )
    provider = CapturingProvider({"points": []})
    await scan_resume_risks(resume, [], provider=provider, resume_id=1)
    assert provider.captured_messages is not None
    outbound = json.dumps(provider.captured_messages, ensure_ascii=False)
    assert "张三" not in outbound
    assert "13800138000" not in outbound
    assert "zhangsan@example.com" not in outbound
    assert "示例公司" not in outbound


# ===== RR-01：台账自由文本与第三方信息的最小化（P0 隐私回归） =====


def _third_party_claim(id: int = 7) -> ClaimRecord:
    """一条"什么都有"的台账条目：客户名、对接人、内部工号、联系方式全在自由文本里。"""
    return _strong_claim(
        id=id,
        subject="示例公司",
        title="主导宇辰科技撮合项目",
        candidate_wording="主导宇辰科技撮合项目，对接人李四（13800138001）",
        boundary="甲方宇辰科技的项目负责人王五负责验收，工号 RF-88731",
        risk_notes=["宇辰科技的结算口径需现场核对", "对方财务电话 13900002222"],
        interview_details={
            "decisions": ["按宇辰科技要求改用分段撮合"],
            "difficulties": ["对方接口人赵六只在夜间联调"],
            "verification": ["以宇辰科技出具的验收单为准"],
            "result": "P99 降至 12ms",
        },
    )


def _resume_with_embedded_contacts() -> ResumeContent:
    """简历正文里混进联系方式、内部链接与内嵌图片（结构化字段之外的那一份）。

    台账里的第三方信息（客户公司/对接人/工号）**不写进这份简历**：正文自由文本无法
    用正则证明已匿名化，本用例只声明"能被规则覆盖的那部分必不出站"。正文里用户自己
    写的客户名属于用户主动投喂给模型的材料，由产品侧的远端增强开关控制（见 docstring）。
    """
    return ResumeContent(
        name="张三",
        phone="13800138000",
        email="zhangsan@example.com",
        summary=(
            "负责后端服务开发，可通过 zs.backup@corp.example.com 或 "
            "https://internal.example.com/u/42 联系；"
            "头像 data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
        ),
        experience=[
            ResumeExperience(company="示例公司", description=["在示例公司负责撮合引擎开发"]),
        ],
    )


async def test_outbound_carries_no_ledger_free_text_or_third_party_details():
    """P0 回归：出站消息里不得出现台账原文里的第三方姓名/客户/工号/联系方式。"""
    provider = CapturingProvider({"points": []})
    await scan_resume_risks(
        _resume_with_embedded_contacts(), [_third_party_claim()], provider=provider, resume_id=1
    )
    assert provider.captured_messages is not None
    outbound = json.dumps(provider.captured_messages, ensure_ascii=False)
    for forbidden in (
        # 台账自由文本里的第三方信息（修复前这些都原样外发）。
        "宇辰科技",
        "李四",
        "王五",
        "赵六",
        "RF-88731",
        "13800138001",
        "13900002222",
        "结算口径",
        "验收单",
        "分段撮合",
        "夜间联调",
        "主导宇辰科技撮合项目",
        # 简历结构化字段与正文里的联系方式 / 链接 / 内嵌图片。
        "张三",
        "13800138000",
        "zhangsan@example.com",
        "zs.backup@corp.example.com",
        "internal.example.com",
        "base64",
        "示例公司",
    ):
        assert forbidden not in outbound, forbidden
    # 台账条目本身仍被识别为"与简历关联"，只是以结构信息的形式出现。
    assert "条目 1" in outbound
    assert "风险备注 2 条" in outbound


def test_local_scan_keeps_full_ledger_text_for_the_user():
    """最小化只作用于出站：本地风险提示仍要带台账原文，用户才看得到完整依据。"""
    points = scan_local(_resume_with_embedded_contacts(), [_third_party_claim()])
    follow_up = " ".join(item for point in points for item in point.follow_up)
    assert "宇辰科技" in follow_up
    assert "RF-88731" in follow_up
    # 敏感联系方式在本地提示里也如实保留（本地扫描的职责就是发现问题）。
    assert "13900002222" in follow_up


# ===== RR-01：远端增强由用户显式控制（开关 + 如实回答"是否可用"） =====


def test_risk_scan_without_body_keeps_remote_enhancement(client, db_session):
    """老调用方（没有请求体）：行为与历史一致——配置了模型就增强。"""
    from app.services.settings_service import save_llm_config

    save_llm_config(
        db_session,
        LLMConfig(base_url="http://127.0.0.1:1", api_key="k", model="fake-model"),
    )
    record = _resume_record(db_session, content={"name": "张三", "summary": "精通后端开发"})
    response = client.post(f"/api/resumes/{record.id}/risk-scan")
    assert response.status_code == 200, response.text
    body = response.json()
    # 模型地址不可达 → 增强失败降级，但"配置过模型"这件事要如实报出来。
    assert body["remote_enhancement_available"] is True
    assert body["llm_used"] is False
    assert any("本地规则" in note for note in body["notes"])


def test_risk_scan_enhance_false_never_touches_the_provider(client, db_session, monkeypatch):
    """``{"enhance": false}``：只跑本地规则——连 provider 都不创建。"""
    from app.api import resume_risk as endpoint
    from app.services.settings_service import save_llm_config

    save_llm_config(
        db_session,
        LLMConfig(base_url="http://127.0.0.1:1", api_key="k", model="fake-model"),
    )
    created: list[int] = []

    def _spy(config=None, **kwargs):
        created.append(1)
        raise AssertionError("关掉远端增强后不该再创建 provider")

    monkeypatch.setattr(endpoint, "create_provider", _spy)

    record = _resume_record(db_session, content={"name": "张三", "summary": "精通后端开发"})
    response = client.post(f"/api/resumes/{record.id}/risk-scan", json={"enhance": False})
    assert response.status_code == 200, response.text
    body = response.json()
    assert created == [], "enhance=false 必须在建 provider 之前就短路"
    assert body["llm_used"] is False
    assert body["remote_enhancement_available"] is True  # 配置了，只是用户关掉了
    assert any(point["category"] == "exaggeration" for point in body["points"])


def test_risk_scan_reports_absence_of_model_honestly(client, db_session):
    """没配置模型：``remote_enhancement_available`` 为 False（不是"你关掉了"）。"""
    record = _resume_record(db_session, content={"name": "张三"})
    body = client.post(f"/api/resumes/{record.id}/risk-scan").json()
    assert body["remote_enhancement_available"] is False
