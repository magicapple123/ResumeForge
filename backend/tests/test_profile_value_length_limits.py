# SPDX-License-Identifier: Apache-2.0
"""资料文本长度上限三处一致：写入校验、工作区默认值、DTO 默认值。

多行与单行各有边界，超限要说出**具体**的界值（不是笼统的"太长"）；
导入 8000 字描述这类历史数据不能被静默截断。
"""

import pytest


@pytest.mark.parametrize("length", [5000, 8000, 20000])
def test_multiline_text_roundtrips_at_the_new_limit(client, length):
    text = "字" * length
    response = client.post(
        "/api/profile/sections/projects/entries",
        json={"values": {"projects.name": "length probe", "projects.description": text}},
    )
    assert response.status_code == 201, response.text
    entry_id = response.json()["entry_id"]
    entries = client.get("/api/profile/workspace").json()["entries"]
    saved = next(item for item in entries if item["entry_id"] == entry_id)
    assert saved["values"]["projects.description"] == text
    assert client.get("/api/profile").status_code == 200
    assert client.get("/api/profile/current/projection").status_code == 200


def test_multiline_over_limit_explains_the_exact_boundary(client):
    response = client.post(
        "/api/profile/sections/projects/entries",
        json={"values": {"projects.description": "字" * 20001}},
    )
    assert response.status_code == 400, response.text
    assert response.json()["code"] == "value_too_long"
    assert "不能超过 20000 个字符" in response.json()["detail"]


def test_custom_single_line_accepts_201_and_500_but_rejects_501(client):
    field = client.post(
        "/api/profile/sections/projects/fields",
        json={"label": "length probe", "field_type": "single_line"},
    )
    assert field.status_code == 201, field.text
    field_id = field.json()["field_id"]
    for length in (201, 500):
        response = client.post(
            "/api/profile/sections/projects/entries",
            json={"values": {field_id: "字" * length}},
        )
        assert response.status_code == 201, response.text
        assert response.json()["values"][field_id] == "字" * length
    response = client.post(
        "/api/profile/sections/projects/entries", json={"values": {field_id: "字" * 501}}
    )
    assert response.status_code == 400, response.text
    assert "不能超过 500 个字符" in response.json()["detail"]


def test_workspace_and_dto_defaults_publish_the_same_new_limits(client):
    from app.schemas.profile import MAX_PROFILE_DETAIL_CHARS
    from app.schemas.profile_workspace import LimitsOut

    limits = client.get("/api/profile/workspace").json()["limits"]
    assert limits["single_line_chars"] == LimitsOut().single_line_chars == 500
    assert limits["multi_line_chars"] == LimitsOut().multi_line_chars == 20000
    assert MAX_PROFILE_DETAIL_CHARS == 200000


def test_recognized_8000_character_description_can_be_imported(client, monkeypatch):
    from app.api import profile

    monkeypatch.setattr(profile, "llm_is_configured", lambda config: False)
    text = "字" * 8000
    parsed = client.post(
        "/api/profile/parse-text",
        json={"text": "项目经历\n长度验收项目｜产品经理\n项目描述：" + text},
    )
    assert parsed.status_code == 200, parsed.text
    section = next(item for item in parsed.json()["sections"] if item["key"] == "projects")
    values = {item["field_id"]: item["value"] for item in section["fields"]}
    assert values["projects.description"] == text
    saved = client.post("/api/profile/sections/projects/entries", json={"values": values})
    assert saved.status_code == 201, saved.text
    assert saved.json()["values"]["projects.description"] == text
