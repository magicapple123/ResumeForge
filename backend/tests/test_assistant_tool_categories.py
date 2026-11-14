# SPDX-License-Identifier: Apache-2.0
"""助手工具的分类元数据来自注册表分组：新增分组无需前端映射表就能出现在清单里。

守的是"别手写第二份分类"：分类写死在前端或单独常量里，注册表一加工具就会出现
"工具在、分类里没有"的幽灵。
"""

from dataclasses import replace

from app.services.assistant_tools import _registry as registry


def test_inventory_categories_match_registry_groups(client):
    response = client.get("/api/assistant/tools")
    assert response.status_code == 200
    body = response.json()
    expected = {tool.name: category for category, group in registry._TOOL_GROUPS for tool in group}
    assert body["count"] == len(body["items"])
    assert all(item["category"] == expected[item["name"]] for item in body["items"])
    assert tuple(tool for _, group in registry._TOOL_GROUPS for tool in group) == registry._TOOLS


def test_new_spec_group_is_exposed_without_frontend_tool_mapping(client, monkeypatch):
    new_tool = replace(registry._TOOLS[0], name="future_spec_probe")
    monkeypatch.setattr(
        registry, "_TOOL_GROUPS", (*registry._TOOL_GROUPS, ("future_domain", (new_tool,)))
    )
    monkeypatch.setattr(registry, "_TOOLS", (*registry._TOOLS, new_tool))
    body = client.get("/api/assistant/tools").json()
    added = next(item for item in body["items"] if item["name"] == "future_spec_probe")
    assert added["category"] == "future_domain"
    assert body["count"] == len(body["items"])
