# SPDX-License-Identifier: Apache-2.0
"""CR-02：所有来源都因「配置问题」失败时，聚合层必须说「去改 Key」而不是「没找到」。

拆成独立文件是因为 ``test_search_aggregate.py`` 已接近 500 行的仓库上限；
这里只钉住归因与公开白名单两条性质，聚合/融合细节仍在原文件。
"""

from __future__ import annotations

import pytest
from app.schemas.setting import SearchConfig
from app.services.assistant.assistant_web_search import AssistantSearchError
from app.services.search import aggregate as aggregate_module
from app.services.search.aggregate import aggregate_search


def _config_key_copy(failure: str) -> str:
    if failure == "missing_key":
        return "还没有配置联网搜索的 API Key。到「设置 → 助手行为 → 联网搜索」填一把。"
    return (
        "联网搜索用的 API Key 无效或无权限。到「设置 → 助手行为 → 联网搜索」更换"
        "——它和「AI 模型」里的 Key 是分开配置的。"
    )


@pytest.mark.asyncio
async def test_deepseek_401_is_reported_as_a_key_problem(monkeypatch):
    """唯一的来源 401 时，用户要看到「去改 Key」，不是「换个关键词再搜」。"""
    from app.services.search.deepseek import DeepSeekResults

    async def unauthorized_deepseek(*_args, **_kwargs):
        return DeepSeekResults(failure="unauthorized")

    monkeypatch.setattr(aggregate_module, "search_deepseek", unauthorized_deepseek)

    with pytest.raises(AssistantSearchError) as excinfo:
        await aggregate_search(
            "401 归因 深圳 后端招聘",
            SearchConfig(sources=["deepseek"], deepseek_api_key="sk-test"),
        )

    assert excinfo.value.public_message == _config_key_copy("unauthorized")
    assert "没有找到" not in excinfo.value.public_message


@pytest.mark.asyncio
@pytest.mark.parametrize("failure", ["missing_key", "unauthorized", "forbidden"])
async def test_config_failure_copy_is_registered_in_the_public_whitelist(monkeypatch, failure):
    """新文案必须进白名单：未登记的整句会退化成兜底话术。"""
    from app.services.search.deepseek import DeepSeekResults

    async def failing_deepseek(*_args, **_kwargs):
        return DeepSeekResults(failure=failure)

    monkeypatch.setattr(aggregate_module, "search_deepseek", failing_deepseek)

    with pytest.raises(AssistantSearchError) as excinfo:
        await aggregate_search(
            f"{failure} 白名单 上海 数据分析",
            SearchConfig(sources=["deepseek"], deepseek_api_key="sk-test"),
        )

    assert excinfo.value.public_message == _config_key_copy(failure)
    assert excinfo.value.public_message != "联网搜索服务暂时不可用，请稍后重试"


@pytest.mark.asyncio
async def test_empty_search_without_a_failure_keeps_the_original_copy(monkeypatch):
    """真的没搜到（来源正常返回空列表）时，仍保留原来那句「没找到」。"""
    from app.services.search.deepseek import DeepSeekResults

    async def empty_deepseek(*_args, **_kwargs):
        return DeepSeekResults()

    monkeypatch.setattr(aggregate_module, "search_deepseek", empty_deepseek)

    generic = (
        "没有找到与当前问题直接相关的公开来源。可以换成更具体的公司名、岗位名或技术方向再搜一次。"
    )
    with pytest.raises(AssistantSearchError) as excinfo:
        await aggregate_search(
            "空结果 保留原文案 北京 产品经理",
            SearchConfig(sources=["deepseek"], deepseek_api_key="sk-test"),
        )

    assert excinfo.value.public_message == generic
