# SPDX-License-Identifier: Apache-2.0
"""R40 设置自检落账：点「测试连接」后用量账本必须 +1 条 settings_probe。

设置页路径在中间件里**刻意**不发业务任务名（task_for_path 对 /api/settings 返回 None），
所以自检的落账由端点显式 ``set_ambient_task(TASK_SETTINGS_PROBE)`` 完成——provider 调用
结束时的自动记账机制与业务端点完全同一条链路。用例走真实 HTTP 路由（TestClient），
provider 是纯内存假实现，不联网、不 sleep。
"""

from __future__ import annotations

import time

import pytest
from app.models.llm_usage import LLMUsageRecord
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.llm.usage import FINISH_STOP


class _UsageRecordingProvider(BaseLLMProvider):
    """纯内存 provider：每次调用都走基类 _record_usage（等价真实 provider 的收尾）。"""

    def __init__(self) -> None:
        super().__init__(LLMConfig(base_url="http://fake", api_key="fake", model="fake-model"))

    async def chat(self, messages, *, thinking: bool = True):
        self._record_usage(
            started=time.monotonic(),
            finish_reason=FINISH_STOP,
            prompt_tokens=7,
            completion_tokens=3,
        )
        return "正常"

    async def stream_chat(self, messages):
        self._record_usage(
            started=time.monotonic(),
            finish_reason=FINISH_STOP,
            prompt_tokens=7,
            completion_tokens=3,
        )
        yield "正常"


def _probe_rows(db_session) -> list[LLMUsageRecord]:
    db_session.rollback()
    return db_session.query(LLMUsageRecord).filter(LLMUsageRecord.task == "settings_probe").all()


@pytest.fixture()
def _fake_provider(client, monkeypatch):
    provider = _UsageRecordingProvider()
    monkeypatch.setattr(
        "app.api.settings.resolve_llm_config_api_key",
        lambda _db, payload: LLMConfig(
            base_url="https://synthetic.invalid/v1", api_key="", model="fake-model"
        ),
    )
    monkeypatch.setattr("app.api.settings.create_provider", lambda _config: provider)
    return provider


def test_llm_test_endpoint_records_settings_probe_usage(client, db_session, _fake_provider):
    response = client.post(
        "/api/settings/llm/test",
        json={"base_url": "https://synthetic.invalid/v1", "api_key": "", "model": "fake-model"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["ok"] is True

    rows = _probe_rows(db_session)
    assert len(rows) == 1
    assert rows[0].total_tokens == 10
    assert rows[0].finish_reason == FINISH_STOP
    assert rows[0].resume_id is None


def test_llm_test_endpoint_records_one_row_per_click(client, db_session, _fake_provider):
    for _ in range(2):
        response = client.post(
            "/api/settings/llm/test",
            json={"base_url": "https://synthetic.invalid/v1", "api_key": "", "model": "fake-model"},
        )
        assert response.status_code == 200, response.text

    assert len(_probe_rows(db_session)) == 2
