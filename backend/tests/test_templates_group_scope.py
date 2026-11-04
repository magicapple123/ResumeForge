# SPDX-License-Identifier: Apache-2.0
"""4-A：模板目录按**当前组**下发板块范围。

用户反馈：为某个岗位生成简历时，摘要写着「本次使用：我是测试（6 个板块）」，但「调整板块
顺序」列出了 11 个系统板块，被当前组隐藏的板块还能被排到最前面。根因是可排序清单取自
**静态目录**（`section_options`），而"当前组参与哪些板块"这个局部约束从未参与过滤。

定稿方案 A = 后端下发组范围：
- `group_section_keys`：当前组参与分区映射成简历键（过滤可选项用，与顺序无关）；
- `group_section_order`：同一份清单的顺序形态（默认顺序 + 「与资料顺序同步」用）。

本文件钉住四条性质：
1. **组内**：只下发该组参与的板块（6 个就 6 个），隐藏板块一个都不出现；
2. **跨组**：换当前组后清单随之变化，且映射只走 `PROFILE_SECTION_TO_RESUME`（映射表里没有
   对应项的内置分区不下发）；
3. **空组**：返回空数组（前端据此回退全量），旧字段仍逐字全量——组范围是**新增**字段，
   `section_options` 一个都不裁剪（`ScenarioEditor.tsx` 也在用它，与当前组无关）；
4. **自建板块**：`custom:<key>` 原样透传，不被映射表吃掉。

另有一例钉住降级：组状态读不出来时目录接口必须照常 200 且范围为空，而不是让整个生成弹窗
打不开（生成按钮不受影响）。
"""

from __future__ import annotations

CATALOG_API = "/api/resumes/templates"
GROUPS_API = "/api/profile/groups"
CURRENT_GROUP_API = "/api/profile/current-group"
WORKSPACE_API = "/api/profile/workspace"
MEMBERS_API = "/api/profile/groups/{group_id}/members"
SECTIONS_API = "/api/profile/sections"

# 「我是测试」组的 6 个参与分区（资料侧键名）→ 映射后的简历键（顺序取自全局 section_order）。
GROUP_KEYS = ("educations", "experiences", "projects", "skills", "awards", "summary")
GROUP_RESUME_KEYS = ["education", "experience", "projects", "skills", "awards", "summary"]

# 默认组参与 13 个内置分区，其中 basic_info 是页眉、不参与正文排序，
# 其余 12 个都有映射项（2026-11-04 起 publications / research_projects / patents /
# credentials 也补进了 `PROFILE_SECTION_TO_RESUME`）。
DEFAULT_GROUP_RESUME_KEYS = [
    "education",
    "experience",
    "projects",
    "skills",
    "campus_experience",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
    "credentials",
    "languages",
]


def _catalog(client) -> dict:
    response = client.get(CATALOG_API)
    assert response.status_code == 200, response.text
    return response.json()


def _workspace_revision(client) -> int:
    response = client.get(WORKSPACE_API)
    assert response.status_code == 200, response.text
    return int(response.json()["workspace_revision"])


def _default_group_id(client) -> str:
    response = client.get(GROUPS_API)
    assert response.status_code == 200, response.text
    return response.json()["default_group_id"]


def _create_group(client, name: str) -> dict:
    response = client.post(GROUPS_API, json={"name": name})
    assert response.status_code == 201, response.text
    return response.json()


def _set_members(client, group: dict, section_keys: list[str]) -> dict:
    response = client.put(
        MEMBERS_API.format(group_id=group["group_id"]),
        json={"section_keys": section_keys, "expected_revision": group["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _switch_current_group(client, group_id: str) -> None:
    response = client.put(
        CURRENT_GROUP_API,
        json={"group_id": group_id, "expected_revision": _workspace_revision(client)},
    )
    assert response.status_code == 200, response.text


def _group_with(client, name: str, section_keys: list[str]) -> dict:
    """建组 + 设置参与清单 + 切为当前组（一次做完，用例里只剩断言）。"""
    group = _set_members(client, _create_group(client, name), section_keys)
    _switch_current_group(client, group["group_id"])
    return group


def test_group_scope_lists_only_participating_sections(client):
    """组内：6 个板块的组 → 只下发 6 个，隐藏板块不出现（用户报的那一幕）。"""
    _group_with(client, "我是测试", list(GROUP_KEYS))

    body = _catalog(client)
    assert body["group_section_keys"] == GROUP_RESUME_KEYS
    assert body["group_section_order"] == GROUP_RESUME_KEYS

    # 静态目录仍是全量（旧字段一个都不裁剪）：场景编辑与"生成后手动添加板块"都靠它。
    option_keys = [item["key"] for item in body["section_options"]]
    hidden = [
        "campus_experience",
        "languages",
        "publications",
        "research_projects",
        "patents",
        "credentials",
    ]
    for key in hidden:
        assert key in option_keys, key  # 目录里还在
        assert key not in body["group_section_keys"], key  # 但不在组范围里
    # 老字段逐字不变：内置默认顺序仍是 12 项完整排列。
    assert body["default_section_order"][:3] == ["education", "experience", "projects"]
    assert len(body["default_section_order"]) == 12


def test_group_scope_follows_the_current_group(client):
    """跨组：切回默认组后清单随之变化，且四条科研/证照分区也在清单里。"""
    _group_with(client, "我是测试", list(GROUP_KEYS))
    assert _catalog(client)["group_section_keys"] == GROUP_RESUME_KEYS

    _switch_current_group(client, _default_group_id(client))
    body = _catalog(client)

    assert body["group_section_keys"] == DEFAULT_GROUP_RESUME_KEYS
    # 2026-11-04（4-A 收口）：映射表补齐了这四栏，它们与其它正文分区一样可排序。
    for key in ("publications", "research_projects", "patents", "credentials"):
        assert key in body["group_section_keys"], key
    # `basic_info` 仍是页眉：即使组里有它，也不进可排序清单（差 1 项是设计，不是漏项）。
    assert "basic_info" not in body["group_section_keys"]
    # `profile_section_order` 仍是"翻译后的完整排列"（12 项），与本条无关，不能跟着裁剪。
    assert set(body["default_section_order"]) <= set(body["profile_section_order"])


def test_empty_group_yields_empty_scope_and_full_static_catalog(client):
    """空组：范围为空（前端回退全量），旧字段不受影响。"""
    group = _create_group(client, "空组")
    # 参与清单为空是合法状态（R-18/R-23）；服务端会强制补回 basic_info（页眉）。
    group = _set_members(client, group, [])
    _switch_current_group(client, group["group_id"])

    body = _catalog(client)
    assert body["group_section_keys"] == []
    assert body["group_section_order"] == []
    # 旧字段照常：列表不能因为组为空而变空，否则「调整板块顺序」整块消失。
    assert len(body["section_options"]) == len(body["default_section_order"])
    assert body["profile_section_order"]


def test_custom_section_is_passed_through_verbatim(client):
    """自建板块：`custom:<section_id>` 原样进组范围，不参与映射表查找。"""
    created = client.post(SECTIONS_API, json={"name": "开源贡献"})
    assert created.status_code == 201, created.text
    custom_key = created.json()["key"]
    assert custom_key.startswith("custom:")

    body = _catalog(client)
    # 新建自建分区会同时加入当前组（这里是默认组）并追加到全局顺序末尾。
    assert custom_key in body["group_section_keys"]
    assert body["group_section_order"][-1] == custom_key
    # 静态目录里它仍在（旧行为），并带 custom 标记。
    assert custom_key in [item["key"] for item in body["section_options"]]


def test_unreadable_group_degrades_to_empty_scope(client, monkeypatch):
    """降级：组状态读不出来时目录接口照常 200，范围为空（前端回退全量）。"""
    from app.api.resumes import templates_routes

    def _broken(db):  # noqa: ANN001 - 只用于模拟"投影读取失败"
        raise RuntimeError("模拟组状态损坏")

    monkeypatch.setattr(templates_routes, "resolve_current_group_scope", _broken)

    body = _catalog(client)
    assert body["group_section_keys"] == []
    assert body["group_section_order"] == []
    assert body["section_options"], "回退全量清单：列表不能为空"
    assert body["templates"] and body["pdf_direct_available"] in (True, False)
