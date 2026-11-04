# SPDX-License-Identifier: Apache-2.0
"""条目写入按读取侧字段上限校验（2026-11 用户报告的资料页 500）。

背景：写入侧只按字段类型给上限（单行 200 / 多行 2000），而读取投影用 ``*Out`` 模型
逐字段建模（``AwardOut.name`` 128）。160 字的奖项名称此前能写进库，读取投影当场
``ValidationError``，资料页整页 500。修法：写入收口（entry_store._validated_values）
按 field_limits_catalog 的冻结上限校验，两侧永远同一套约束。

回归三步（与 QA 报告的复现路径一一对应）：
1. 160 字奖项标题 → 400 value_too_long，不落库；
2. 128 字（恰好在上限）→ 201；
3. 写入后 workspace / 旧协议投影 / 纸面投影全部 200。
"""

from __future__ import annotations

from app.services.profile.field_limits_catalog import READ_SIDE_LIMITS, limit_of

WORKSPACE_API = "/api/profile/workspace"
LEGACY_PROFILE_API = "/api/profile"
PROJECTION_API = "/api/profile/current/projection"
AWARDS_API = "/api/profile/sections/awards/entries"
SKILLS_API = "/api/profile/sections/skills/entries"
AWARD_FIELD = "awards.title"


def _post_award(client, name: str):
    return client.post(AWARDS_API, json={"values": {AWARD_FIELD: name}})


def test_over_limit_name_is_rejected_with_reason(client):
    """160 字奖项标题 → 400 + value_too_long；detail 只写原因，不出现堆栈。"""
    response = _post_award(client, "奖" * 160)

    assert response.status_code == 400, response.text
    body = response.json()
    assert body["code"] == "value_too_long"
    # 原因必须能定位：哪个字段、上限多少、当前多少。
    assert "奖项名称" in body["detail"]
    assert "128" in body["detail"]
    assert "160" in body["detail"]
    assert "Traceback" not in response.text


def test_limit_length_name_is_accepted_and_readable_everywhere(client):
    """128 字（恰好在上限）→ 201；写完三条读取路径全部 200。"""
    response = _post_award(client, "奖" * 128)
    assert response.status_code == 201, response.text

    for api in (WORKSPACE_API, LEGACY_PROFILE_API, PROJECTION_API):
        assert client.get(api).status_code == 200, api


def test_update_path_is_guarded_too(client):
    """PATCH 只提交改动字段：超限值同样进不来（合并语义绕不过收口）。"""
    created = _post_award(client, "校级奖学金").json()

    response = client.patch(
        f"{AWARDS_API}/{created['entry_id']}",
        json={"values": {AWARD_FIELD: "奖" * 160}, "expected_revision": created["revision"]},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "value_too_long"


def test_frozen_limit_matches_the_read_model_annotation(client):
    """冻结值与读取模型当前注解一致：改了 *Out 约束却没改上限表，这里会变红。"""
    from app.schemas import profile as profile_schemas

    assert limit_of(AWARD_FIELD) == 128
    # 与读取模型的注解逐字一致（改约束时必须同步改 field_limits_catalog 的冻结表）。
    assert (
        READ_SIDE_LIMITS[AWARD_FIELD]
        == profile_schemas.AwardOut.model_fields["name"].metadata[0].max_length
    )
    # 没有读取模型的位置（自建字段、照片）不额外设限，继续走类型上限。
    assert limit_of("custom:1.自定义字段") is None
    assert limit_of("basic_info.photo") is None


def test_other_sections_use_their_own_read_limits(client):
    """通用实现，不许逐板块 hack：技能名上限 64 同样生效，且不误伤其他分区。"""
    assert client.post(SKILLS_API, json={"values": {"skills.name": "技" * 65}}).status_code == 400
    assert client.post(SKILLS_API, json={"values": {"skills.name": "技" * 64}}).status_code == 201


def test_loose_read_limits_do_not_tighten_the_write_side(client):
    """读取上限比类型上限松时（tech_stack 10000 > 单行 200）不得收紧既有行为。"""
    response = client.post(
        "/api/profile/sections/projects/entries",
        json={"values": {"projects.name": "项目", "projects.tech_stack": "A" * 190}},
    )
    assert response.status_code == 201, response.text
