# SPDX-License-Identifier: Apache-2.0
"""T29：4 个只读质检工具（质量检测 / ATS 匹配 / 统一检查 / 版本对比）的守卫。

守的性质：

a. 注册规格：四个工具全部 ``writes=False`` / ``permission=READ_ONLY`` / ``preview=None``；
b. 只读：调用前后简历的 revision / updated_at / 正文 sha256 一个字节都不变；
c. 质量检测只走本地规则（``scan_local``），**绝不**触发远端模型增强编排；
d. ATS 结果强制带免责文案「本地规则估计，不代表真实 ATS 解析结果」；
e. 返回截断：质量点 / 检查问题每组 ≤5 条，版本对比正文差异 ≤20 行，不塞整份简历。
"""

from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

import pytest
from app import database
from app.models.resume import ResumeRecord
from app.services.assistant_tools import execute_tool, get_tool, tool_names
from app.services.assistant_tools._types import ToolPermission
from app.services.ats_check import ATS_DISCLAIMER

TOOL_NAMES = (
    "run_resume_quality_check",
    "check_ats_match",
    "get_resume_preflight",
    "compare_resume_versions",
)

CONTENT: dict[str, Any] = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "summary": "热爱技术，精通 Python，主导过从零到一的系统重构。",
    "education": [
        {"school": "清华大学", "major": "计算机科学与技术", "degree": "本科", "gpa": "3.8/4.0"}
    ],
    "experience": [
        {
            "company": "字节跳动",
            "role": "后端工程师",
            "start_date": "2022.07",
            "end_date": "至今",
            "description": [
                "主导投递平台重构，峰值吞吐从 120/分钟提升到 900/分钟。",
                "独立完成任务调度模块，100% 覆盖核心链路。",
                "参与稳定性建设，独立负责告警收敛。",
                # 重复要点 → 查重风险点
                "主导投递平台重构，峰值吞吐从 120/分钟提升到 900/分钟。",
                # 敏感数字规律 → 敏感信息风险点
                "测试环境曾使用 110101199001011234 作为示例证件号。",
                "涉密项目的细节只能在公司内网查看。",
                "精通 Java 与分布式系统，拥有专家级经验。",
                "统筹跨团队联调，全面负责上线方案。",
            ],
        }
    ],
    "projects": [
        {
            "name": "ResumeForge 简历工作台",
            "role": "独立开发",
            "description": ["文档模型 v2；完美兼容旧数据。"],
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "质检工具验证", "content": CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    resume_id = response.json()["id"]
    patched = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"page_limit": 2, "template": "classic"},
    )
    assert patched.status_code == 200, patched.text
    return resume_id


def _create_job(client) -> int:
    response = client.post(
        "/api/jobs",
        json={
            "title": "后端开发工程师",
            "company": "示例网络科技有限公司",
            "description": "负责投递平台后端服务开发与稳定性建设。",
            "requirements": "熟悉 Python、分布式系统、Redis 与 MySQL。",
        },
    )
    assert response.status_code in (200, 201), response.text
    return response.json()["id"]


def _create_two_versions(client, resume_id: int) -> tuple[int, int]:
    """旧版 → 改正文（24 条）+ 改排版 → 新版；给版本对比工具制造真实差异。"""
    old = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": "旧版", "change_summary": "初始"}
    )
    assert old.status_code == 201, old.text
    from app.services.resume.document_save import save_content

    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        document = copy.deepcopy(record.content or {})
        experience = next(
            section for section in document["sections"] if section["key"] == "experience"
        )
        experience["entries"][0]["items"].extend(
            {
                "kind": "text",
                "id": f"ob_it_quality{index:04d}",
                "style": "bullet",
                "text": f"新增要点 {index:02d}",
                "hidden": False,
            }
            for index in range(24)
        )
        save_content(session, record_id=resume_id, content=document, expected_revision=None)
    # 排版变化：页数上限 2 → 3（版本对比的「排版项增删改」才有内容）。
    layout = client.patch(f"/api/resumes/{resume_id}/layout", json={"page_limit": 3})
    assert layout.status_code == 200, layout.text
    new = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": "新版", "change_summary": "追加要点"}
    )
    assert new.status_code == 201, new.text
    return int(old.json()["id"]), int(new.json()["id"])


@pytest.fixture()
def seeded(client):
    resume_id = _create_resume(client)
    job_id = _create_job(client)
    old_version, new_version = _create_two_versions(client, resume_id)
    return {
        "resume_id": resume_id,
        "job_id": job_id,
        "old_version": old_version,
        "new_version": new_version,
    }


def _snapshot(resume_id: int) -> dict:
    """简历的只读快照：revision / updated_at / 正文 sha256（任何写入都会变）。"""
    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        content_digest = hashlib.sha256(
            json.dumps(record.content or {}, ensure_ascii=False, sort_keys=True).encode("utf-8")
        ).hexdigest()
        return {
            "revision": int(record.revision or 0),
            "updated_at": record.updated_at,
            "content_sha256": content_digest,
        }


def _run(name: str, arguments: dict) -> str:
    with database.SessionLocal() as session:
        return execute_tool(session, name, arguments).text


def _args(seeded: dict) -> dict[str, dict]:
    resume_id = seeded["resume_id"]
    return {
        "run_resume_quality_check": {"resume_id": resume_id},
        "check_ats_match": {"resume_id": resume_id, "job_id": seeded["job_id"]},
        "get_resume_preflight": {"resume_id": resume_id},
        "compare_resume_versions": {
            "resume_id": resume_id,
            "from_version": seeded["old_version"],
            "to_version": seeded["new_version"],
        },
    }


# ===== a. 注册规格：只读 =====


def test_quality_tools_are_registered_as_read_only():
    """四个工具必须在注册表里，且 writes=False / permission=READ_ONLY / preview=None。"""
    registered = set(tool_names())
    assert set(TOOL_NAMES) <= registered, f"没注册的工具：{sorted(set(TOOL_NAMES) - registered)}"
    for name in TOOL_NAMES:
        tool = get_tool(name)
        assert tool is not None, name
        assert tool.writes is False, f"{name} 必须只读（writes=False），不能进写入确认流程"
        assert tool.permission is ToolPermission.READ_ONLY, (
            f"{name} 的权限级别是 {tool.permission}，期望 ToolPermission.READ_ONLY"
        )
        assert tool.preview is None, f"{name} 是只读工具，不应该有写入预览"


# ===== b. 只读：调用前后简历不变 =====


def test_quality_tools_do_not_touch_the_resume(seeded):
    """四个工具都跑一遍，简历的 revision / updated_at / 正文 sha256 必须一个字节不变。"""
    resume_id = seeded["resume_id"]
    before = _snapshot(resume_id)
    for name, arguments in _args(seeded).items():
        result = _run(name, arguments)
        assert result.strip(), f"{name} 返回为空"
    after = _snapshot(resume_id)
    assert after == before, f"只读工具改动了简历：{before} → {after}"


# ===== c. 质量检测不触发远端增强 =====


def test_quality_check_never_calls_remote_enhancement(seeded, monkeypatch):
    """把远端增强编排入口换成"一调用就失败"，工具仍要能正常返回本地规则结果。"""
    from app.services import llm
    from app.services.assistant_tools import quality_tools
    from app.services.resume import resume_risk

    def _forbidden(*_args, **_kwargs):
        raise AssertionError("质量检测触发了远端模型增强（T29 要求纯本地规则）")

    monkeypatch.setattr(resume_risk, "scan_resume_risks", _forbidden)
    monkeypatch.setattr(resume_risk, "_llm_deep_dive", _forbidden)
    monkeypatch.setattr(llm, "create_provider", _forbidden)
    calls = {"scan_local": 0}
    real_scan_local = quality_tools.scan_local

    def _spy(*args, **kwargs):
        calls["scan_local"] += 1
        return real_scan_local(*args, **kwargs)

    monkeypatch.setattr(quality_tools, "scan_local", _spy)
    payload = json.loads(_run("run_resume_quality_check", {"resume_id": seeded["resume_id"]}))
    assert calls["scan_local"] == 1, "质量检测必须且只调一次本地规则 scan_local"
    assert payload["total"] >= 0
    assert "未调用模型增强" in payload["reading"]


# ===== d. ATS 免责文案 =====


def test_ats_match_carries_the_mandatory_disclaimer(seeded):
    """ATS 结果必须逐字带免责文案，且分项/总分的结构完整。"""
    arguments = _args(seeded)["check_ats_match"]
    text = _run("check_ats_match", arguments)
    payload = json.loads(text)
    assert payload["disclaimer"] == ATS_DISCLAIMER
    assert "本地规则估计，不代表真实 ATS 解析结果" in text
    assert set(payload["subscores"]) <= {"format", "keyword", "position"}
    if payload["score"] is not None:
        assert 0 <= payload["score"] <= 100
    assert isinstance(payload["issues"], list)
    assert payload["job"]["id"] == seeded["job_id"]


# ===== e. 返回截断 =====


def test_quality_check_returns_at_most_five_points(seeded):
    payload = json.loads(_run("run_resume_quality_check", {"resume_id": seeded["resume_id"]}))
    assert payload["total"] > 5, "用例前提：样例简历要能扫出 5 条以上风险点"
    assert payload["returned"] == 5
    assert len(payload["points"]) == 5
    assert payload["truncated"] is True
    assert payload["summary"], "五类计数必须返回"


def test_preflight_returns_at_most_five_issues_per_group(seeded):
    payload = json.loads(_run("get_resume_preflight", {"resume_id": seeded["resume_id"]}))
    assert payload["layers_run"] == ["content", "layout", "product"]
    assert [group["severity"] for group in payload["groups"]] == [
        "blocker",
        "verify",
        "suggestion",
    ]
    for group in payload["groups"]:
        assert group["returned"] <= 5, group
        assert len(group["items"]) == group["returned"], group
        assert group["count"] >= group["returned"], group
    assert "必须解决" in payload["reading"] and "需核对" in payload["reading"]


def test_compare_versions_returns_truncated_diff(seeded):
    payload = json.loads(_run("compare_resume_versions", _args(seeded)["compare_resume_versions"]))
    assert payload["from"]["name"] == "旧版"
    assert payload["to"]["name"] == "新版"
    assert payload["stats"]["added"] >= 24
    assert payload["content_diff"]["total_changed"] > 20
    assert len(payload["content_diff"]["lines"]) == 20
    assert payload["content_diff"]["truncated"] is True
    assert len(payload["changes"]) <= 5
    # 排版项增删改：两版之间改了 page_limit。
    assert "page_limit" in payload["layout"]["changed"]
    assert payload["layout"]["equal"] is False
