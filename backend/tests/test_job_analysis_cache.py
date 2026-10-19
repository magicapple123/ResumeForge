"""岗位解读缓存（R2）：一次模型调用，之后秒开。

为什么重要：解读是 10–60 秒、按 token 计费的调用。缓存丢掉不会报错，只会让用户
每次打开弹窗都重新等一遍、重新付一次钱——属于"坏了也没人喊"的问题，只能靠测试钉住。

覆盖：没有缓存时不发模型请求、生成后写回、内容改过标「可能过期」但结果仍可读；
以及 R2-a 的 **POST 先读缓存**（命中就不调模型、``force=true`` 才调）、
R2-b 的 **断开不写缓存**。
"""

from __future__ import annotations

import json

import pytest
from app.models.job import Job
from app.schemas.setting import LLMConfig
from app.services.job_analysis_cache import (
    analysis_fingerprint,
    read_cached_analysis,
    store_analysis,
)
from app.services.llm.base import BaseLLMProvider

RESULT = {
    "summary": "岗位重点是病区护理与执业资格。",
    "requirements": [
        {"priority": "high", "category": "资质", "requirement": "护士执业资格证", "evidence": ""}
    ],
    "advice": [{"title": "突出临床能力", "action": "写明实习经历", "rationale": ""}],
}

# 一份能通过 ``_validate_evidence`` 的模型输出：每条要求的 evidence 必须在招聘原文里
# 找得到（"持有护士执业资格证" 就是 jobs 夹具的 requirements 原文）。
PROVIDER_PAYLOAD = {
    "summary": "岗位重点考察执业资格与临床护理能力。",
    "requirements": [
        {
            "priority": "high",
            "category": "职业资格",
            "requirement": "持有护士执业资格证",
            "evidence": "持有护士执业资格证",
        }
    ],
    "advice": [
        {
            "title": "突出临床能力",
            "action": "写明病区实习经历",
            "rationale": "岗位职责直接涉及病区护理",
        }
    ],
}

# 一份**结构合法**的缓存结果（``evidence`` / ``rationale`` 不能是空串）。
# 与 ``RESULT`` 分开：``RESULT`` 故意留着空 evidence，只用于"GET 读得到就行"的路由级用例；
# POST 命中缓存要过一次响应模型校验，用不合法的那份会走进"缓存失效 → 重新生成"分支。
VALID_CACHE = {
    "summary": "上次生成的结论：病区护理与执业资格是重点。",
    "requirements": [
        {
            "priority": "high",
            "category": "资质",
            "requirement": "护士执业资格证",
            "evidence": "持有护士执业资格证",
        }
    ],
    "advice": [
        {
            "title": "突出临床能力",
            "action": "写明病区实习经历",
            "rationale": "岗位职责直接涉及病区护理",
        }
    ],
}


class _CountingProvider(BaseLLMProvider):
    """假的模型：不联网，只数自己被调了几次。"""

    def __init__(self):
        super().__init__(
            LLMConfig(base_url="http://localhost:9999", api_key="test", model="test-model")
        )
        self.calls = 0

    async def chat(self, messages: list[dict], *, thinking: bool = True) -> str:
        self.calls += 1
        return json.dumps(PROVIDER_PAYLOAD, ensure_ascii=False)

    async def stream_chat(self, messages: list[dict]):
        yield ""


def _install_provider(monkeypatch) -> _CountingProvider:
    """把端点里的 ``get_llm_config`` / ``create_provider`` 换成假 provider。"""
    provider = _CountingProvider()
    monkeypatch.setattr("app.api.jobs_analysis.get_llm_config", lambda _db: provider.config)
    monkeypatch.setattr("app.api.jobs_analysis.create_provider", lambda _config: provider)
    return provider


@pytest.fixture
def job(client, db_session):
    created = client.post(
        "/api/jobs",
        json={
            "title": "护士",
            "company": "示例医院",
            "description": "负责病区护理工作。",
            "requirements": "持有护士执业资格证。",
        },
    )
    assert created.status_code in (200, 201), created.text
    return db_session.get(Job, created.json()["id"])


def test_without_cache_the_endpoint_reports_nothing_and_calls_no_model(client, job, monkeypatch):
    def _boom(*args, **kwargs):
        raise AssertionError("读取缓存不该调用模型")

    monkeypatch.setattr("app.services.job.job_analysis.generate_job_analysis", _boom)

    response = client.get(f"/api/jobs/{job.id}/analysis")

    assert response.status_code == 200
    assert response.json() == {
        "cached": False,
        "stale": False,
        "generated_at": None,
        "result": None,
    }


def test_generated_result_is_stored_and_served_from_cache(client, db_session, job):
    store_analysis(db_session, job, RESULT)

    response = client.get(f"/api/jobs/{job.id}/analysis")

    payload = response.json()
    assert payload["cached"] is True
    assert payload["stale"] is False
    assert payload["generated_at"]
    assert payload["result"]["summary"] == RESULT["summary"]


def test_changed_job_content_marks_the_cache_stale_but_keeps_the_result(client, db_session, job):
    store_analysis(db_session, job, RESULT)
    before = analysis_fingerprint(job)

    # 改一下岗位描述（用户补充了信息）。
    job.description = "负责病区护理工作，另需参与排班。"
    db_session.commit()
    db_session.refresh(job)

    assert analysis_fingerprint(job) != before
    payload = client.get(f"/api/jobs/{job.id}/analysis").json()
    assert payload["stale"] is True
    # 旧结果不丢：用户可能只是补了个标签，仍然值得看一眼。
    assert payload["result"]["summary"] == RESULT["summary"]


def test_fingerprint_ignores_surrounding_whitespace(job):
    """前后空格不算"内容变了"——否则用户在标题末尾多打一个空格就被判过期。"""
    before = analysis_fingerprint(job)
    job.description = f"  {job.description}  "
    assert analysis_fingerprint(job) == before


def test_corrupt_cache_reads_as_missing(job):
    job.analysis_cache = {"fingerprint": "x"}  # 没有 result
    assert read_cached_analysis(job) is None


# ===== R2-a：POST 先读缓存，别为"再看一眼"重复计费 =====


def test_post_returns_cache_without_calling_the_model(client, db_session, job, monkeypatch):
    """已有指纹一致、未过期的缓存时，POST 直接返回它并标 ``cached=true``。

    这是"配置了无效 Key 也能打开解读"的那条路：以前每次 POST 都打模型，Key 一坏就 502，
    用户以为自己存的结论丢了。
    """
    store_analysis(db_session, job, VALID_CACHE)
    provider = _install_provider(monkeypatch)

    response = client.post(f"/api/jobs/{job.id}/analysis")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cached"] is True
    assert payload["summary"] == VALID_CACHE["summary"]
    assert provider.calls == 0, "命中缓存时不该调用模型"


def test_post_with_force_calls_the_model_even_when_cached(client, db_session, job, monkeypatch):
    """``force=true`` 是「重新生成」的唯一含义：明确要求重算，就必须打到模型。"""
    store_analysis(db_session, job, VALID_CACHE)
    provider = _install_provider(monkeypatch)

    response = client.post(f"/api/jobs/{job.id}/analysis?force=true")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["cached"] is False
    assert payload["summary"] == PROVIDER_PAYLOAD["summary"]
    assert provider.calls == 1


def test_post_regenerates_when_the_cache_is_stale(client, db_session, job, monkeypatch):
    """岗位内容改过（指纹不同）时不再拿旧结论充数，而是重新生成一次。"""
    store_analysis(db_session, job, VALID_CACHE)
    job.description = "负责病区护理工作，另需参与排班。"
    db_session.commit()
    provider = _install_provider(monkeypatch)

    response = client.post(f"/api/jobs/{job.id}/analysis")

    assert response.status_code == 200, response.text
    assert response.json()["cached"] is False
    assert provider.calls == 1


def test_post_does_not_write_cache_when_the_client_already_left(
    client, db_session, job, monkeypatch
):
    """客户端断开后生成完的结果**不落缓存**（R2-b 的落地点）。

    否则用户点了「取消生成」走开，回来却看到一份"已完成"的解读——那是他明确放弃的那次
    请求，界面却在替它邀功。
    """
    provider = _install_provider(monkeypatch)

    async def _disconnected(_self) -> bool:
        return True

    monkeypatch.setattr("starlette.requests.Request.is_disconnected", _disconnected)

    response = client.post(f"/api/jobs/{job.id}/analysis")

    assert response.status_code == 200, response.text
    # 结果是正常返回的（模型已经跑完了，丢掉浪费）……
    assert response.json()["summary"] == PROVIDER_PAYLOAD["summary"]
    assert provider.calls == 1
    # ……但没有写进缓存：下一次读还是"没有缓存"。
    db_session.expire_all()
    assert read_cached_analysis(db_session.get(Job, job.id)) is None
    assert client.get(f"/api/jobs/{job.id}/analysis").json()["cached"] is False


def test_post_writes_cache_when_the_client_stays(client, db_session, job, monkeypatch):
    """对照用例：连着的时候照常写缓存，否则上一条会因为"永远不写"而假绿。"""
    _install_provider(monkeypatch)

    assert client.post(f"/api/jobs/{job.id}/analysis").status_code == 200

    db_session.expire_all()
    cached = read_cached_analysis(db_session.get(Job, job.id))
    assert cached is not None
    assert cached["stale"] is False
    assert cached["result"]["summary"] == PROVIDER_PAYLOAD["summary"]
