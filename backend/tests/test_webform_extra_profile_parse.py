# SPDX-License-Identifier: Apache-2.0
"""「网申资料」粘贴识别（项 12 / v1.1 Q4）：白名单优先 + 目录外转 `CUSTOM_` + 用户勾选。

三条规则都在 ``build_draft`` 里，所以**不需要模型也能逐条钉住**；端点层再补三条
（无模型降级、AI 路径、不写库）。

这一版最核心的性质在第 4 条用例：``政治面貌`` 必须归一到目录键 ``political_status``，
**不能**同时冒出一个 ``CUSTOM_政治面貌``。两个都出现的话，用户会在待确认区新增一条和自己的
资料完全重复的字段——这正是 D21「能归到目录的必须先归」要挡住的事。
"""

from __future__ import annotations

import json

import pytest
from app.database import SessionLocal
from app.models.web_form_profile import WebFormProfileEntry
from app.schemas.setting import LLMConfig
from app.services.llm.base import BaseLLMProvider
from app.services.webform.extra_profile import (
    MAX_CUSTOM_LABEL_CHARS,
    MAX_VALUE_CHARS,
    custom_key,
)
from app.services.webform.extra_profile_text import (
    MAX_CUSTOM_ITEMS,
    build_draft,
    parse_extra_profile_text,
)

ROUTE = "/api/webform/extra-profile/parse-text"
# 路由模块里 `get_llm_config` 是直接 import 的，patch 目标就是它自己。
CONFIG_PATH = "app.api.webform.extra_profile_routes.get_llm_config"
PROVIDER_PATH = "app.api.webform.extra_profile_routes.create_provider"

UNCONFIGURED = LLMConfig()
CONFIGURED = LLMConfig(base_url="https://model.example/v1", api_key="k", model="test-model")


# ===== 规则层（不依赖模型）=====


def test_whitelisted_label_lands_in_values():
    """① 白名单内：目录 label 直接命中。"""
    values, custom, warnings = build_draft([("政治面貌", "中共党员")])

    assert values == {"political_status": "中共党员"}
    assert custom == []
    assert warnings == []


def test_profile_only_field_is_dropped_entirely():
    """② 已有归属的栏目（简历资料）：既不进 values，也不进 custom。

    「姓名」属于 ``source="profile"``，不是"网申的新栏目"。放进待确认区会让用户新增一条
    与自己资料重复的字段，而重复字段在填充时还会互相抢。
    """
    values, custom, _warnings = build_draft([("姓名", "张三"), ("手机号", "13800000000")])

    assert values == {}
    assert custom == []


def test_unknown_label_becomes_custom_with_backend_key():
    """③ 目录外：进 custom，key 由后端 `custom_key(label)` 生成（D32：模型不自拼 key）。"""
    values, custom, _warnings = build_draft([("是否有驾照", "C1")])

    assert values == {}
    assert len(custom) == 1
    assert custom[0] == {
        "key": custom_key("是否有驾照"),
        "label": "是否有驾照",
        "value": "C1",
    }
    assert custom[0]["key"] == "CUSTOM_是否有驾照"


def test_synonym_is_normalized_to_catalog_key_not_custom():
    """④ 同义标签必须先归一到目录键——本改动的核心性质（D21）。

    ``FIELD_SYNONYMS["political_status"]`` 收录的是「政治面貌 / 党派 / 政治身份」三种写法。
    三种都必须归一到 ``political_status``，且 custom 里**不出现** ``CUSTOM_政治面貌``——
    两个都出现的话，用户会在待确认区新增一条与自己资料完全重复的字段。
    """
    values, custom, _warnings = build_draft(
        [("党派", "群众"), ("政治面貌", "中共党员"), ("政治身份", "党员")]
    )

    # 同一 key：先到的非空值胜出（页面上通常先出现完整的那一条）。
    assert values == {"political_status": "群众"}
    assert custom == []
    assert all(item["key"] != "CUSTOM_政治面貌" for item in custom)


def test_custom_items_are_capped_with_warning():
    """⑤ 目录外最多收 8 条，超出按出现顺序截断并给一条提示。"""
    items = [(f"自定义栏目{i}", f"值{i}") for i in range(12)]

    _values, custom, warnings = build_draft(items)

    assert len(custom) == MAX_CUSTOM_ITEMS
    assert [item["label"] for item in custom] == [f"自定义栏目{i}" for i in range(MAX_CUSTOM_ITEMS)]
    assert any(str(MAX_CUSTOM_ITEMS) in warning for warning in warnings)


def test_duplicate_custom_label_keeps_only_the_first():
    """⑥ 同标签重复只留一条（界面上是"一条待确认"，不是两条）。"""
    _values, custom, _warnings = build_draft([("是否有驾照", "C1"), ("是否有驾照", "C2")])

    assert len(custom) == 1
    assert custom[0]["value"] == "C1"


@pytest.mark.parametrize("label", ["", "   ", "：", "***", "……"])
def test_blank_or_decorative_labels_are_dropped(label):
    """⑦ 空标签 / 纯标点 / 纯装饰符：界面上没法显示，也就没法勾选。"""
    values, custom, _warnings = build_draft([(label, "随便什么值")])

    assert values == {}
    assert custom == []


def test_long_label_is_truncated_and_shared_prefix_dedupes():
    """⑧ 标签截到 40 字；前 40 字相同、尾巴不同的两个标签只产出一条。

    截断之后再生成 key，否则两条会得到**同一个 key** 却都留在列表里（输出里出现重复 key，
    前端渲染成两条同 id 的行）。
    """
    base = "导师姓名" + "长" * (MAX_CUSTOM_LABEL_CHARS * 2)
    _values, custom, _warnings = build_draft([(base, "王老师"), (f"{base}尾巴", "李老师")])

    assert len(custom) == 1
    assert len(custom[0]["label"]) == MAX_CUSTOM_LABEL_CHARS
    assert len(custom[0]["key"]) < 64  # 与 `field_key` 列宽一致（前缀也占位置）


def test_overlong_value_is_truncated_with_warning():
    """⑨ 值超过 2000 字：截断 + 一条提示（不逐条刷屏）。"""
    values, _custom, warnings = build_draft([("政治面貌", "党" * (MAX_VALUE_CHARS + 10))])

    assert len(values["political_status"]) == MAX_VALUE_CHARS
    assert any(str(MAX_VALUE_CHARS) in warning for warning in warnings)


def test_local_parser_only_produces_catalog_keys():
    """D22：本地规则 ``custom`` 恒空——它没有"这是个新栏目"的可靠判据。"""
    text = "政治面貌：中共党员\n是否有驾照：C1\n身高/视力：1.65/1.0"

    values, custom = parse_extra_profile_text(text)

    assert values == {"political_status": "中共党员"}
    assert custom == []


# ===== 端点层 =====


class StubProvider(BaseLLMProvider):
    """只回一段固定 JSON，用来验证"key 由后端决定"这条接线。"""

    def __init__(self, response: str):
        super().__init__(CONFIGURED)
        self.response = response
        self.messages: list[dict] = []

    async def chat(self, messages, *, thinking: bool = True) -> str:
        self.messages = messages
        return self.response

    async def stream_chat(self, _messages):
        yield ""


def _entry_count() -> int:
    with SessionLocal() as db:
        return db.query(WebFormProfileEntry).count()


def test_endpoint_without_model_returns_local_draft(client, monkeypatch):
    """⑩ 没配模型：``parse_engine="local"``、``custom == []``，但目录内的照样解析出来。"""
    monkeypatch.setattr(CONFIG_PATH, lambda _db: UNCONFIGURED)

    response = client.post(ROUTE, json={"text": "政治面貌：中共党员\n是否有驾照：C1"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["parse_engine"] == "local"
    assert body["values"] == {"political_status": "中共党员"}
    # 本地规则不猜新栏目（D22）。用户在界面上仍可手动新增，只是识别不会替他造。
    assert body["custom"] == []
    assert any("未配置大模型" in warning for warning in body["warnings"])
    assert body["recognized_text"] == "政治面貌：中共党员\n是否有驾照：C1"


def test_endpoint_with_model_splits_values_and_custom(client, monkeypatch):
    """AI 路径：模型只回 label/value，目录内进 values、目录外进 custom（待勾选）。"""
    provider = StubProvider(
        json.dumps(
            {
                "items": [
                    {"label": "政治面貌", "value": "中共党员"},
                    {"label": "是否有驾照", "value": "C1"},
                    {"label": "姓名", "value": "张三"},
                    {"label": 123, "value": "格式不对的项"},
                ]
            },
            ensure_ascii=False,
        )
    )
    monkeypatch.setattr(CONFIG_PATH, lambda _db: CONFIGURED)
    monkeypatch.setattr(PROVIDER_PATH, lambda _config: provider)

    response = client.post(ROUTE, json={"text": "政治面貌：中共党员"})

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["parse_engine"] == "ai"
    assert body["values"] == {"political_status": "中共党员"}
    assert [item["key"] for item in body["custom"]] == ["CUSTOM_是否有驾照"]
    # 「姓名」属于简历资料：既不进 values 也不进 custom。
    assert "name" not in body["values"]
    assert all("姓名" not in item["label"] for item in body["custom"])
    # 格式不对的那条被丢掉，但有提示（不静默）。
    assert any("格式不对" in warning for warning in body["warnings"])
    # 模型看到的系统提示里有栏目清单，但契约要求它只回 label/value。
    assert "items" in provider.messages[0]["content"]


def test_endpoint_does_not_write_to_database(client, monkeypatch):
    """⑪ 只回草稿、**不写库**（D20）：调完接口，网申资料表一行都没多。"""
    monkeypatch.setattr(CONFIG_PATH, lambda _db: UNCONFIGURED)
    before = _entry_count()

    response = client.post(
        ROUTE,
        json={"text": "政治面貌：中共党员\n紧急联系人：张三 13800000000"},
    )

    assert response.status_code == 200
    assert response.json()["values"]
    assert _entry_count() == before
