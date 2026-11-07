# SPDX-License-Identifier: Apache-2.0
"""T28：list_user_files 的旧实现委托样板（route_runner / tool_runner / tool_fields）。"""

from __future__ import annotations

import json

from app.services.actions import get_action
from app.services.assistant_tools import execute_tool, get_tool


def test_list_user_files_is_registered_as_pair():
    spec = get_action("list_user_files")
    assert spec is not None
    assert (spec.http.method, spec.http.path) == ("GET", "/api/user-files")
    assert get_tool("list_user_files") is not None


def test_tool_schema_hides_route_pagination_fields():
    properties = set(get_tool("list_user_files").parameters.get("properties") or {})
    assert properties == {"keyword", "source_type", "limit"}


def test_route_and_tool_agree_on_the_same_filtered_total(client, db_session):
    from app.models.user_file import UserFile

    db_session.add(
        UserFile(sha256="a" * 64, disk_name="f1", original_name="简历.pdf", source_type="material")
    )
    db_session.add(
        UserFile(sha256="b" * 64, disk_name="f2", original_name="照片.png", source_type="photo")
    )
    db_session.commit()
    response = client.get("/api/user-files", params={"source_type": "material"})
    assert response.status_code == 200, response.text
    body = response.json()
    payload = json.loads(
        execute_tool(db_session, "list_user_files", {"source_type": "material"}).text
    )
    assert body["total"] == 1
    assert body["items"][0]["original_name"] == "简历.pdf"
    assert payload["返回"] == 1


def test_tool_defaults_keep_limit_and_keyword_filter(client, db_session):
    from app.models.user_file import UserFile

    for index in range(3):
        db_session.add(
            UserFile(
                sha256=f"{index:064d}",
                disk_name=f"file-{index}",
                original_name=f"报告{index}.pdf",
                source_type="material",
            )
        )
    db_session.commit()
    payload = json.loads(execute_tool(db_session, "list_user_files", {"limit": 2}).text)
    assert payload["返回"] == 2
    keyword_payload = json.loads(
        execute_tool(db_session, "list_user_files", {"keyword": "报告1"}).text
    )
    assert keyword_payload["返回"] == 1


def test_invalid_limit_is_rejected_on_both_sides(client, db_session):
    response = client.get("/api/user-files", params={"page_size": 0})
    assert response.status_code == 422
    import pytest

    with pytest.raises(ValueError):
        execute_tool(db_session, "list_user_files", {"limit": 0})
