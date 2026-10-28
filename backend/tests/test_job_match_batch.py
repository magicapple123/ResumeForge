# SPDX-License-Identifier: Apache-2.0
"""岗位广场批量适配度分析的接口与记录测试。"""

import pytest
from app.models.job import JOB_STATUS_OPEN, Job
from app.schemas.setting import LLMConfig
from app.services.profile.entry_store import upsert_entry


def _seed_profile(db_session) -> None:
    """资料自 F2 起落在新模型：批量匹配读当前组（未隐藏）的消费快照。"""
    upsert_entry(db_session, "basic_info", values={"basic_info.name": "张示例"})
    upsert_entry(db_session, "summary", values={"summary.content": "Python 后端开发"})


def _job(db_session, title: str, description: str, requirements: str) -> Job:
    job = Job(
        title=title,
        company="示例公司",
        status=JOB_STATUS_OPEN,
        description=description,
        requirements=requirements,
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    return job


def test_local_batch_returns_sorted_items_and_keeps_a_history_record(client, db_session):
    _seed_profile(db_session)
    first = _job(db_session, "后端开发", "负责 Python 服务开发", "熟悉 Python；本科及以上")
    second = _job(db_session, "产品助理", "负责用户访谈与需求整理", "具备沟通能力")

    response = client.post(
        "/api/jobs/match-batches",
        json={"job_ids": [second.id, first.id, second.id]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["requested_count"] == 2
    assert body["completed_count"] == 2
    assert body["failed_count"] == 0
    assert all(item["analysis_source"] == "local" for item in body["items"])
    assert [item["rank"] for item in body["items"]] == [1, 2]
    assert (
        body["items"][0]["reference_score"]["score"] >= body["items"][1]["reference_score"]["score"]
    )

    history = client.get("/api/jobs/match-batches").json()
    assert len(history) == 1
    assert history[0]["id"] == body["id"]
    assert history[0]["top_score"] == body["items"][0]["reference_score"]["score"]

    detail = client.get(f"/api/jobs/match-batches/{body['id']}")
    assert detail.status_code == 200
    assert [item["job_id"] for item in detail.json()["items"]] == [
        item["job_id"] for item in body["items"]
    ]


def test_batch_requires_profile_or_resume(client, db_session):
    job = _job(db_session, "后端开发", "负责服务开发", "熟悉 Python")

    response = client.post("/api/jobs/match-batches", json={"job_ids": [job.id]})

    assert response.status_code == 400
    assert "个人资料为空" in response.json()["detail"]


def test_batch_missing_job_returns_404(client, db_session):
    _seed_profile(db_session)

    response = client.post("/api/jobs/match-batches", json={"job_ids": [999999]})

    assert response.status_code == 404


def test_batch_history_unknown_id_returns_404(client):
    assert client.get("/api/jobs/match-batches/999999").status_code == 404


@pytest.mark.asyncio
async def test_configured_model_provider_failure_keeps_items_failed_instead_of_local_fallback(
    monkeypatch,
):
    from app.services.job import job_match_batch

    item = job_match_batch.BatchMatchInput(
        job_id=1,
        job_title="后端开发",
        company="示例公司",
        payload={"title": "后端开发", "requirements": "熟悉 Python"},
        profile_text='{"summary":"Python 后端开发"}',
        resume_text="",
        existing_result=None,
        existing_model="",
    )
    config = LLMConfig(base_url="https://model.example/v1", model="test-model")

    def fail_create_provider(_config):
        raise ValueError("invalid provider")

    monkeypatch.setattr(job_match_batch, "create_provider", fail_create_provider)

    run = await job_match_batch.run_batch_match([item], config)

    assert len(run.items) == 1
    assert run.items[0].status == "failed"
    assert "无法创建模型连接" in run.items[0].error
    assert run.items[0].result is None


# ---------------------------------------------------------------------------
# 单岗位失败重试（批内 1 次）
# ---------------------------------------------------------------------------


def _input(job_id: int = 1):
    from app.services.job.job_match_batch import BatchMatchInput

    return BatchMatchInput(
        job_id=job_id,
        job_title="后端开发",
        company="示例公司",
        payload={"title": "后端开发", "requirements": "熟悉 Python"},
        profile_text='{"summary":"Python 后端开发"}',
        resume_text="",
        existing_result=None,
        existing_model="",
    )


def _ok_result():
    from app.schemas.job_match import JobMatchResult
    from app.services.job.job_match import finalize_match_result

    return finalize_match_result(JobMatchResult(notes=["证据齐备"]))


@pytest.mark.asyncio
async def test_retryable_failure_is_retried_once_and_can_succeed(monkeypatch):
    """第一次"证据无法核对"、第二次正常：最终判成功，且只多请求一次。

    这正是用户报的形态：批量里某一条红着不动，同一个岗位单独跑却一次就过。
    """
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    calls = {"count": 0}

    async def fake_analyze(_provider, _payload, _profile, _resume):
        calls["count"] += 1
        if calls["count"] == 1:
            raise LLMError("模型返回的匹配证据无法在资料或简历中核对，请重试", retryable=True)
        return _ok_result()

    monkeypatch.setattr("app.services.job.job_match.analyze_match", fake_analyze)
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: object())

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert calls["count"] == 2, "可重试的失败应当只重试一次"
    assert len(run.items) == 1
    assert run.items[0].status == "completed"
    assert run.items[0].analysis_source == "new"


@pytest.mark.asyncio
async def test_non_retryable_failure_is_not_retried(monkeypatch):
    """硬错误（未标记可重试）第一次就判失败：不在"模型名写错"上重复烧钱。"""
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    calls = {"count": 0}

    async def fake_analyze(_provider, _payload, _profile, _resume):
        calls["count"] += 1
        raise LLMError("模型返回错误：model not found")

    monkeypatch.setattr("app.services.job.job_match.analyze_match", fake_analyze)
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: object())

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert calls["count"] == 1
    assert run.items[0].status == "failed"
    assert "model not found" in run.items[0].error


@pytest.mark.asyncio
async def test_retry_stops_when_cancelled(monkeypatch):
    """取消之后不得继续重试：失败项按第一次的失败原因如实记录。"""
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    state = {"count": 0, "cancel": False}

    async def fake_analyze(_provider, _payload, _profile, _resume):
        state["count"] += 1
        # 第一次尝试失败的同时用户按了"取消"。
        state["cancel"] = True
        raise LLMError("模型返回的匹配证据无法在资料或简历中核对，请重试", retryable=True)

    monkeypatch.setattr("app.services.job.job_match.analyze_match", fake_analyze)
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: object())

    run = await job_match_batch.run_batch_match(
        [_input()],
        LLMConfig(base_url="https://model.example/v1", model="test-model"),
        should_cancel=lambda: state["cancel"],
    )

    assert state["count"] == 1, "收到取消信号后不许再发请求"
    assert run.items[0].status == "failed"


@pytest.mark.asyncio
async def test_attempt_budget_is_a_named_constant(monkeypatch):
    """重试上限是常量而不是散落的魔数：改口径只需要改一处。"""
    from app.services.job import job_match_batch

    assert job_match_batch.MAX_MATCH_ATTEMPTS_PER_JOB == 2
    assert job_match_batch.is_retryable_failure(Exception()) is False


@pytest.mark.asyncio
async def test_provider_auth_error_is_not_retried_end_to_end(monkeypatch):
    """D15 的端到端版：401 形态的错误从 **provider** 抛出，也只请求 1 次。

    上一条用例是 monkeypatch 掉 ``analyze_match``，绕过了解析与证据核对；这里换成
    "真实走一遍 ``analyze_match``，只把最底层的 ``provider.chat`` 换掉"，钉住的是
    "provider 抛出的 ``LLMError`` 默认不可重试"——401 走的正是这条路
    （``services/llm/payload.py`` 把它映射成「API Key 无效或已过期」）。写反的后果
    是每次批量都在用户的 key 上重复打两次请求，而界面上看不出任何区别。
    """
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    calls = {"count": 0}

    class _UnauthorizedProvider:
        async def chat(self, _messages, thinking=False):  # noqa: ARG002 - 接口对齐
            calls["count"] += 1
            raise LLMError("API Key 无效或已过期，请到「设置」页检查")

    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: _UnauthorizedProvider())

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert calls["count"] == 1, "认证失败重试永远是同一个结果，不该再花一次钱"
    assert run.items[0].status == "failed"
    assert "API Key" in run.items[0].error


@pytest.mark.asyncio
async def test_retry_is_per_item_not_per_batch(monkeypatch):
    """重试预算按**岗位**算：一条重试成功不该吃掉另一条的第二次机会。"""
    from dataclasses import replace

    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    seen: dict[int, int] = {}

    async def fake_analyze(_provider, payload, _profile, _resume):
        job_key = payload["job_key"]
        seen[job_key] = seen.get(job_key, 0) + 1
        if seen[job_key] == 1:
            raise LLMError("模型未返回有效的匹配结果 JSON，请重试", retryable=True)
        return _ok_result()

    monkeypatch.setattr("app.services.job.job_match.analyze_match", fake_analyze)
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: object())

    # payload 里塞一个"这是第几条"的标记，用来分别统计每个岗位自己的调用次数。
    inputs = [
        replace(_input(job_id=1), payload={"job_key": 1}),
        replace(_input(job_id=2), payload={"job_key": 2}),
    ]

    run = await job_match_batch.run_batch_match(
        inputs, LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert seen == {1: 2, 2: 2}, "每个岗位各自获得一次重试机会"
    assert [item.status for item in run.items] == ["completed", "completed"]


# ---------------------------------------------------------------------------
# 重试的**上限**与**真实错误来源**（不 monkeypatch analyze_match）
# ---------------------------------------------------------------------------


def _match_reply(evidence: str) -> str:
    """一份能过 schema、只由 ``evidence`` 决定能否过证据核对的最小匹配结论。"""
    import json

    return json.dumps(
        {
            "hard_conditions": [],
            "core_abilities": [
                {
                    "label": "熟悉 Python",
                    "jd_quote": "",
                    "status": "matched",
                    "evidence": evidence,
                }
            ],
            "bonus_items": [],
            "hard_gate": "unknown",
            "admission": "needs_confirm",
            "advice": "",
            "notes": [],
        },
        ensure_ascii=False,
    )


class _ScriptedProvider:
    """按顺序吐出预设响应，并记下被调用了几次。"""

    def __init__(self, replies: list[str]) -> None:
        self.replies = replies
        self.calls = 0

    async def chat(self, _messages, thinking=False):  # noqa: ARG002 - 接口对齐
        self.calls += 1
        return self.replies[min(self.calls, len(self.replies)) - 1]


@pytest.mark.asyncio
async def test_retry_is_capped_at_two_attempts(monkeypatch):
    """两次都是可重试的失败 → 总共只请求 2 次，然后如实判失败。

    "重试一次"写错成"一直重试到成功"的后果是批量任务卡在一条永远过不了的岗位上来回
    烧钱（用户只看到进度条不动）。这条把上限钉死在 ``MAX_MATCH_ATTEMPTS_PER_JOB``。
    """
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    calls = {"count": 0}

    async def always_retryable(_provider, _payload, _profile, _resume):
        calls["count"] += 1
        raise LLMError("模型返回的匹配证据无法在资料或简历中核对，请重试", retryable=True)

    monkeypatch.setattr("app.services.job.job_match.analyze_match", always_retryable)
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: object())

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert calls["count"] == job_match_batch.MAX_MATCH_ATTEMPTS_PER_JOB == 2
    assert len(run.items) == 1, "重试不该在结果里留下两条同一岗位的记录"
    assert run.items[0].status == "failed"
    assert "无法在资料或简历中核对" in run.items[0].error


@pytest.mark.asyncio
async def test_evidence_check_failure_is_retried_end_to_end(monkeypatch):
    """D14 的端到端版：可重试标记来自**真实的证据核对**，不是用例手写的标记。

    前两条用例把底层的单次匹配调用（``job_match.analyze_match``）整个换掉了，所以它们
    只证明"``retryable=True`` 会被重试"，证明不了"真实失败路径上真的带着这个标记"。这里只换最底层的
    ``provider.chat``：第一次让模型编造证据（资料里根本没有 Kubernetes），
    ``validate_evidence`` 会抛可重试的 ``LLMError``；第二次如实返回 → 一次重试即成。
    """
    from app.services.job import job_match_batch

    provider = _ScriptedProvider(
        [
            _match_reply("精通 Kubernetes 与微服务治理"),
            _match_reply("Python"),
        ]
    )
    monkeypatch.setattr(job_match_batch, "create_provider", lambda _config: provider)

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="test-model")
    )

    assert provider.calls == 2, "证据核对失败属于可重试，应当只再试一次"
    assert [item.status for item in run.items] == ["completed"]
    assert run.items[0].analysis_source == "new"


@pytest.mark.asyncio
async def test_a_hard_error_from_the_provider_is_not_retried_end_to_end(monkeypatch):
    """对照项：同一个端到端路径上的**硬错误不重试**（未配置模型名的 404 走这里）。

    两条端到端用例只差"模型第一次说了什么"，所以它们一起把 ``retryable`` 这个开关
    钉在"由错误来源决定"上——而不是由批量层"看到失败就重试"。
    """
    from app.services.job import job_match_batch
    from app.services.llm.base import LLMError

    calls = {"count": 0}

    class _ModelNotFoundProvider:
        async def chat(self, _messages, thinking=False):  # noqa: ARG002 - 接口对齐
            calls["count"] += 1
            raise LLMError("模型返回错误：model not found")

    monkeypatch.setattr(
        job_match_batch, "create_provider", lambda _config: _ModelNotFoundProvider()
    )

    run = await job_match_batch.run_batch_match(
        [_input()], LLMConfig(base_url="https://model.example/v1", model="not-exist")
    )

    assert calls["count"] == 1, "模型名写错重试永远是同一个结果"
    assert run.items[0].status == "failed"
    assert "model not found" in run.items[0].error


# ---------------------------------------------------------------------------
# ``retryable`` 标记的**来源**：哪些失败带标记、默认值是什么
# ---------------------------------------------------------------------------


def test_llm_error_defaults_to_not_retryable():
    """``LLMError`` 的默认必须是**不重试**。

    默认值写反是这批改动最贵的一种错：provider 抛的每一类错误（401、余额不足、429 用尽）
    都会变成"再花一次钱"，而界面上完全看不出区别。默认保守，只有明确知道"再要一次产出
    有机会变好"的那几处才标 ``retryable=True``。
    """
    from app.services.llm.base import LLMError

    assert LLMError("随便什么错").retryable is False
    assert LLMError("随便什么错", retryable=True).retryable is True


@pytest.mark.parametrize(
    ("raw", "case", "expected"),
    [
        ("", "空响应", "为空或过长"),
        ("这不是 JSON", "不是 JSON", "未返回有效的匹配结果 JSON"),
        ("[]", "顶层不是对象", "结构无效"),
        ('{"hard_conditions": "不是数组"}', "字段类型不对", "字段不完整或超出限制"),
        ("x" * 125_000, "超长响应", "为空或过长"),
    ],
    # 显式 id：超长那条的默认 id 会把整段十几万字符塞进环境变量（PYTEST_CURRENT_TEST）。
    ids=["empty", "not-json", "not-object", "wrong-field-type", "too-long"],
)
def test_every_provider_output_failure_is_marked_retryable(raw, case, expected):
    """模型**产出不合格**的每一条路径都必须带 ``retryable=True``。

    参数化而不是逐个写：解析失败的出口有五个（空/超长、非 JSON、非对象、字段校验），
    只钉其中一两个的话，以后新加一个出口（比如"发现禁用的评分字段"）很容易忘记带标记
    ——那种遗漏不会报错，只会让批量任务失去本来该有的那一次重试。

    每条都断言**错误文案片段**（而不只是"抛了 LLMError"）：否则某一列的输入先被前一个
    分支拦下时，用例会变成"五个 id、实际只测了三个出口"的假绿灯。
    """
    from app.services.job.job_match import parse_match_result
    from app.services.llm.base import LLMError

    with pytest.raises(LLMError) as excinfo:
        parse_match_result(raw)

    assert expected in str(excinfo.value), f"{case} 没走到预期的分支：{excinfo.value}"
    assert excinfo.value.retryable is True, (
        f"{case} 属于模型产出不合格，应当可重试：{excinfo.value}"
    )


def test_missing_jd_quote_is_marked_retryable():
    """``validate_evidence`` 的另一条出口（JD 原文摘录在 JD 里找不到）同样可重试。"""
    from app.schemas.job_match import JobMatchResult
    from app.services.job.job_match import validate_evidence
    from app.services.llm.base import LLMError

    result = JobMatchResult.model_validate(
        {
            "hard_conditions": [
                {
                    "label": "本科及以上",
                    "jd_quote": "硕士及以上学历",
                    "status": "matched",
                    "evidence": "",
                }
            ]
        }
    )

    with pytest.raises(LLMError) as excinfo:
        validate_evidence(result, jd_source="熟悉 Python；本科及以上学历", personal_source="本科")

    assert excinfo.value.retryable is True
