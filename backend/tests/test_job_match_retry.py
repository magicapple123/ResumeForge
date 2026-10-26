# SPDX-License-Identifier: Apache-2.0
"""岗位匹配分析（单岗）的证据核对失败自动重试。

背景：批量匹配早就有"可重试失败再试一次"的收口（job_match_batch），但单岗端点没有，
用户实测第一次 502「模型返回的匹配证据无法在资料或简历中核对，请重试」，手动再点一次
才成功。这里守三条性质：

1. 第一次可重试失败 → 服务端自动再试一次，成功即返回（用户无感）；
2. 两次都失败 → 502 且文案可读（不泄露模型原文/堆栈）；
3. 不可重试的失败（如鉴权/配置错误）不重试，避免重复计费。

全部用脚本化假 provider，不联网、不产生真实 API 费用。
"""

from __future__ import annotations

import json

from app.models.job import Job
from app.models.resume import ResumeRecord
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider, LLMError

PROFILE_TEXT_JSON = {
    "name": "张示例",
    "educations": [{"school": "示例大学", "degree": "本科"}],
    "skills": [{"name": "Python"}],
}

VALID_RESULT = {
    "hard_conditions": [
        {"label": "本科及以上", "jd_quote": "本科及以上", "status": "matched", "evidence": "本科"}
    ],
    "core_abilities": [
        {
            "label": "熟悉 Python",
            "jd_quote": "熟悉 Python",
            "status": "matched",
            "evidence": "Python",
        }
    ],
    "bonus_items": [],
    "hard_gate": "met",
    "admission": "allow",
    "advice": "建议投递。",
    "notes": [],
}

# 证据在资料/简历里根本找不到 → validate_evidence 抛可重试 LLMError。
INVALID_RESULT = json.loads(json.dumps(VALID_RESULT, ensure_ascii=False))
INVALID_RESULT["hard_conditions"][0]["evidence"] = "查无此据的学历证明"


class _ScriptedProvider(BaseLLMProvider):
    """按脚本依次返回结果或抛错，并记录被调用次数（= 真实模型请求次数）。"""

    def __init__(self, script: list[object]) -> None:
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))
        self.script = script
        self.calls = 0

    async def chat(self, messages, *, thinking: bool = True) -> str:
        item = self.script[min(self.calls, len(self.script) - 1)]
        self.calls += 1
        if isinstance(item, Exception):
            raise item
        return json.dumps(item, ensure_ascii=False)

    async def stream_chat(self, messages):
        raise AssertionError("匹配分析不应走流式")


def _seed(db_session) -> Job:
    job = Job(
        title="后端开发工程师",
        company="示例公司",
        description="负责后端服务开发",
        requirements="本科及以上；熟悉 Python",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    db_session.add(
        ResumeRecord(
            title="后端简历",
            job_id=job.id,
            content=PROFILE_TEXT_JSON,
        )
    )
    db_session.commit()
    return job


def _patch_provider(monkeypatch, provider: _ScriptedProvider) -> None:
    monkeypatch.setattr("app.api.job_match.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.job_match.create_provider", lambda _config: provider)


def test_single_match_retries_once_and_succeeds(client, db_session, monkeypatch):
    job = _seed(db_session)
    provider = _ScriptedProvider([INVALID_RESULT, VALID_RESULT])
    _patch_provider(monkeypatch, provider)

    response = client.post(f"/api/jobs/{job.id}/match-analysis")

    assert response.status_code == 200, response.text
    assert provider.calls == 2, "证据核对失败后应自动再试一次"
    # 成功结果要写回岗位（与既有单次成功路径一致）
    stored = client.get(f"/api/jobs/{job.id}/match-analysis")
    assert stored.status_code == 200
    assert stored.json()["result"]["hard_conditions"][0]["status"] == "matched"


def test_single_match_two_failures_returns_readable_error(client, db_session, monkeypatch):
    job = _seed(db_session)
    provider = _ScriptedProvider([INVALID_RESULT, INVALID_RESULT])
    _patch_provider(monkeypatch, provider)

    response = client.post(f"/api/jobs/{job.id}/match-analysis")

    assert response.status_code == 502, response.text
    detail = response.json()["detail"]
    assert "匹配分析" in detail
    assert "请重试" in detail or "重试" in detail
    # 两次都失败就停手：不无限重试、不重复计费。
    assert provider.calls == 2
    # 不把模型原始输出/堆栈返回给前端。
    assert "Traceback" not in detail
    assert "查无此据的学历证明" not in detail


def test_non_retryable_failure_is_not_retried(client, db_session, monkeypatch):
    job = _seed(db_session)
    provider = _ScriptedProvider(
        [LLMError("模型服务认证失败，请检查 API Key 配置", retryable=False)]
    )
    _patch_provider(monkeypatch, provider)

    response = client.post(f"/api/jobs/{job.id}/match-analysis")

    assert response.status_code == 502, response.text
    assert provider.calls == 1, "不可重试的失败不应再发第二次请求"
