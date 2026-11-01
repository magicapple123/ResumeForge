# SPDX-License-Identifier: Apache-2.0
"""W13 命名版本与岗位变体：快照不可变、比较、恢复产生新版本、冻结、选择性同步。

全部走真实 API（client fixture）；合成数据，不涉及真实用户资料。
"""

from __future__ import annotations

import sqlite3
from contextlib import closing
from pathlib import Path

from app import database
from app.database_migrations import application_tables
from app.dataset_registry import dataset_database_file
from app.models.resume_delivery import ResumeDeliveryRecord
from app.services.datasets import create_dataset
from tests.document_test_support import body_texts


def _summary(content: dict) -> str:
    """v2 content 的个人总结文本（summary 是 text 分区里的 TextItem）。"""
    texts = body_texts(content, "summary")
    assert texts, "v2 content 里没有 summary 文本"
    return texts[0]


def _content(summary: str = "版本 A", description: str = "A") -> dict:
    return {
        "name": "张示例",
        "summary": summary,
        "experience": [
            {"company": "示例科技有限公司", "role": "后端实习生", "description": [description]}
        ],
    }


def _create_resume(client, title: str = "版本测试") -> int:
    response = client.post("/api/resumes/manual", json={"title": title, "content": _content()})
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _resume(client, resume_id: int) -> dict:
    response = client.get(f"/api/resumes/{resume_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _save_content(client, resume_id: int, content: dict) -> dict:
    current = _resume(client, resume_id)
    response = client.put(
        f"/api/resumes/{resume_id}/content",
        json={"content": content, "expected_revision": current["revision"]},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _create_version(client, resume_id: int, name: str, **extra) -> dict:
    response = client.post(f"/api/resumes/{resume_id}/versions", json={"name": name, **extra})
    assert response.status_code == 201, response.text
    return response.json()


def test_create_list_and_detail_versions(client):
    resume_id = _create_resume(client)

    version = _create_version(client, resume_id, "投递版 v1")
    assert version["name"] == "投递版 v1"
    assert version["frozen"] is False
    assert len(version["content_sha256"]) == 64
    assert len(version["params_sha256"]) == 64

    listed = client.get(f"/api/resumes/{resume_id}/versions").json()
    assert [item["id"] for item in listed["items"]] == [version["id"]]

    detail = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert _summary(detail["content"]) == "版本 A"
    assert detail["render_context"]["document_mode"] == "resume"
    assert detail["render_context"]["page_limit"] >= 1


def test_version_snapshot_is_immutable(client, db_session):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "快照")
    original_hash = version["content_sha256"]

    _save_content(client, resume_id, _content("版本 B", "B"))

    detail = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert _summary(detail["content"]) == "版本 A"
    assert detail["content_sha256"] == original_hash
    # 后续编辑只改当前简历，不回写历史版本行。
    assert _summary(_resume(client, resume_id)["content"]) == "版本 B"


def test_freeze_flag_persists(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "已投递")
    response = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/freeze", json={"frozen": True}
    )
    assert response.status_code == 200, response.text
    assert response.json()["frozen"] is True
    listed = client.get(f"/api/resumes/{resume_id}/versions").json()
    assert listed["items"][0]["frozen"] is True


def test_compare_two_versions_and_current_layout(client, db_session):
    resume_id = _create_resume(client)
    first = _create_version(client, resume_id, "v1")
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")

    compared = client.get(f"/api/resumes/{resume_id}/versions/{first['id']}/compare/{second['id']}")
    assert compared.status_code == 200, compared.text
    body = compared.json()
    assert body["content"]["stats"]["added"] > 0
    assert body["layout"]["equal"] is True

    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    record.page_limit = 2
    db_session.commit()
    current = client.get(f"/api/resumes/{resume_id}/versions/{first['id']}/compare/current").json()
    assert current["against_id"] == 0
    assert "page_limit" in current["layout"]["changed"]


def test_restore_creates_new_current_version_and_keeps_history(client, db_session):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "回滚点")
    _save_content(client, resume_id, _content("版本 B", "B"))
    before = _resume(client, resume_id)
    delivery_before = db_session.query(ResumeDeliveryRecord).count()

    restored = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": before["revision"]},
    )

    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["revision"] == before["revision"] + 1
    assert body["version"]["source"] == "restore"
    assert body["version"]["parent_version_id"] == version["id"]
    after = _resume(client, resume_id)
    assert _summary(after["content"]) == "版本 A"
    # 历史版本与已冻结的交付记录都不变；版本列表多了一条 restore。
    original = client.get(f"/api/resumes/{resume_id}/versions/{version['id']}").json()
    assert _summary(original["content"]) == "版本 A"
    versions = client.get(f"/api/resumes/{resume_id}/versions").json()["items"]
    assert len(versions) == 2
    assert db_session.query(ResumeDeliveryRecord).count() == delivery_before


def test_restore_revision_conflict_does_not_write(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "回滚点")
    stale_revision = _resume(client, resume_id)["revision"]
    _save_content(client, resume_id, _content("版本 B", "B"))

    response = client.post(
        f"/api/resumes/{resume_id}/versions/{version['id']}/restore",
        json={"expected_revision": stale_revision},
    )

    assert response.status_code == 409, response.text
    assert response.json()["code"] == "resume_revision_conflict"
    assert _summary(_resume(client, resume_id)["content"]) == "版本 B"
    assert len(client.get(f"/api/resumes/{resume_id}/versions").json()["items"]) == 1


def test_variant_is_independent_from_current_resume(client):
    resume_id = _create_resume(client)
    version = _create_version(client, resume_id, "v1")

    created = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "后端岗变体", "base_version_id": version["id"]},
    )
    assert created.status_code == 201, created.text
    variant = created.json()
    assert variant["base_version_id"] == version["id"]

    _save_content(client, resume_id, _content("版本 B", "B"))
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert _summary(detail["content"]) == "版本 A"
    assert len(client.get(f"/api/resumes/{resume_id}/variants").json()["items"]) == 1


def test_selective_sync_only_changes_listed_paths(client):
    resume_id = _create_resume(client)
    first = _create_version(client, resume_id, "v1")
    variant = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "变体", "base_version_id": first["id"]},
    ).json()
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")

    response = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={
            "source_version_id": second["id"],
            "variant_ids": [variant["id"]],
            "paths": ["summary"],
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["items"][0]["applied_paths"] == ["summary"]
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert _summary(detail["content"]) == "版本 B"
    # 没列出的路径保留岗位定制（还是 v1 的内容）。
    assert body_texts(detail["content"], "experience") == ["A"]
    assert detail["last_synced_version_id"] == second["id"]


def test_compare_returns_field_level_changes(client):
    """#28b：比较给字段级「旧值 → 新值」，不给整份文档序列化后的行级 JSON。"""
    resume_id = _create_resume(client)
    first = _create_version(client, resume_id, "v1")
    _save_content(client, resume_id, _content("版本 B", "B"))
    second = _create_version(client, resume_id, "v2")

    body = client.get(
        f"/api/resumes/{resume_id}/versions/{first['id']}/compare/{second['id']}"
    ).json()
    changes = body["changes"]
    assert body["changes_truncated"] is False
    assert changes, "两份内容不同，字段级变更集不能为空"
    scopes = {change["scope"] for change in changes}
    # 个人总结是 summary 分区里的 text item，改文本 = 一条 item 级「修改」。
    item_changes = [change for change in changes if change["scope"] == "item"]
    assert item_changes, scopes
    changed_values = {
        (change["old_value"], change["new_value"])
        for change in item_changes
        if change["kind"] == "changed"
    }
    assert ("版本 A", "版本 B") in changed_values
    # 旧值/新值是可读文本，不是文档 JSON 片段。
    assert all("{" not in (old or "") + (new or "") for old, new in changed_values)

    # 反过来比（选新版、与旧版比）也要按时间序输出「旧值 → 新值」。
    reverse = client.get(
        f"/api/resumes/{resume_id}/versions/{second['id']}/compare/{first['id']}"
    ).json()
    reverse_changes = [change for change in reverse["changes"] if change["scope"] == "item"]
    assert ("版本 A", "版本 B") in {
        (change["old_value"], change["new_value"]) for change in reverse_changes
    }
    # 排版相同时不报字段变化以外的噪声。
    assert body["layout"]["equal"] is True


def test_selective_sync_writes_header_field_by_id(client):
    """#29c：基本信息走 header.<item id>；只改勾选的页眉字段，其余逐字节不变。"""
    resume_id = _create_resume(client)
    content = _resume(client, resume_id)["content"]
    header = content["header"]
    header["items"].extend(
        [
            {
                "kind": "field",
                "id": "ob_hd90000001",
                "key": "phone",
                "label": "",
                "value": "13800000000",
                "placement": "contact",
                "format": "text",
            },
            {
                "kind": "field",
                "id": "ob_hd90000002",
                "key": "email",
                "label": "",
                "value": "zhang@example.com",
                "placement": "contact",
                "format": "text",
            },
        ]
    )
    _save_content(client, resume_id, content)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "页眉同步变体"}).json()
    variant_detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    name_item = next(
        item for item in variant_detail["content"]["header"]["items"] if item["key"] == "name"
    )

    # 改当前简历的姓名（v2 文档原样写回），再按 id 路径同步到变体。
    current = _resume(client, resume_id)["content"]
    next(
        item for item in current["header"]["items"] if item["key"] == "name"
    )["value"] = "张同步"
    _save_content(client, resume_id, current)

    response = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [variant["id"]], "paths": [f"header.{name_item['id']}"]},
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["applied_paths"] == [f"header.{name_item['id']}"]

    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    by_key = {item["key"]: item["value"] for item in detail["content"]["header"]["items"]}
    assert by_key["name"] == "张同步"
    # 未勾选的页眉字段与当前简历保持一致（没有被同步动作改掉）。
    assert by_key["phone"] == "13800000000"
    assert by_key["email"] == "zhang@example.com"
    assert detail["last_synced_version_id"] is None

    bad_path = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [variant["id"]], "paths": ["header.ob_hd0000dead"]},
    )
    assert bad_path.status_code == 400


def test_sync_rejects_unknown_path_and_foreign_variant(client):
    resume_id = _create_resume(client)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "变体"}).json()

    bad_path = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [variant["id"]], "paths": ["summary.absent"]},
    )
    assert bad_path.status_code == 400

    other_resume = _create_resume(client, "另一份")
    other_variant = client.post(
        f"/api/resumes/{other_resume}/variants", json={"name": "别人的变体"}
    ).json()
    foreign = client.post(
        f"/api/resumes/{resume_id}/variants/sync",
        json={"variant_ids": [other_variant["id"]], "paths": ["summary"]},
    )
    assert foreign.status_code == 404


def test_version_and_variant_404s(client):
    resume_id = _create_resume(client)
    assert client.get(f"/api/resumes/{resume_id}/versions/9999").status_code == 404
    assert client.get(f"/api/resumes/{resume_id}/variants/9999").status_code == 404
    # 空白名称通过 pydantic 的 min_length（长度 1）但在服务层 strip 后为空 → 400。
    assert client.post(f"/api/resumes/{resume_id}/versions", json={"name": " "}).status_code == 400


def test_versions_are_dataset_scoped_and_backed_up(client, db_session):
    resume_id = _create_resume(client)
    _create_version(client, resume_id, "隔离版本")

    def _count(database_file: Path, table: str) -> int:
        with closing(sqlite3.connect(str(database_file))) as connection:
            return connection.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]

    active_file = Path(database.engine.url.database)
    assert _count(active_file, "resume_version") == 1

    other = create_dataset("版本隔离检查", database.engine)
    other_file = dataset_database_file(other["id"])
    assert _count(other_file, "resume_version") == 0
    assert _count(other_file, "resume_variant") == 0
    # 新表自动进入备份清单（清单从 Base.metadata 推导）。
    assert {"resume_version", "resume_variant"} <= set(application_tables())


# ===== W16：变体独立排版（0060 resume_variant.layout）+ 导出/预览快照 =====


def _export_input(client, resume_id: int, variant_id: int) -> dict:
    response = client.get(
        f"/api/resumes/{resume_id}/variants/{variant_id}/export-input"
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_variant_layout_is_independent_from_current_resume(client, db_session):
    resume_id = _create_resume(client)
    variant = client.post(
        f"/api/resumes/{resume_id}/variants", json={"name": "英文排版变体"}
    ).json()
    # 旧行为：不传 layout = 继承；列表用 has_layout 标记，详情给原始 None。
    assert variant["has_layout"] is False
    detail = client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}").json()
    assert detail["layout"] is None
    baseline = _export_input(client, resume_id, variant["id"])
    assert baseline["layout_source"] == "snapshot"
    assert _summary(baseline["content"]) == "版本 A"

    # PATCH 独立排版：只改变体，不动当前简历。
    layout = {"template": "classic", "format_config": {"font_size": 11}, "page_limit": 2}
    patched = client.patch(
        f"/api/resumes/{resume_id}/variants/{variant['id']}", json={"layout": layout}
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["layout"] == layout
    assert patched.json()["has_layout"] is True
    assert _resume(client, resume_id)["page_limit"] == 1  # 当前简历未被改

    # 当前简历随后改了内容与页数：导出快照仍取变体自己的内容 + 独立排版。
    _save_content(client, resume_id, _content("版本 B", "B"))
    from app.models.resume import ResumeRecord

    record = db_session.get(ResumeRecord, resume_id)
    record.page_limit = 3
    db_session.commit()
    snapshot = _export_input(client, resume_id, variant["id"])
    assert snapshot["layout_source"] == "variant"
    assert _summary(snapshot["content"]) == "版本 A"
    assert snapshot["layout"]["page_limit"] == 2
    assert snapshot["layout"]["format_config"] == {"font_size": 11}
    assert len(snapshot["content_sha256"]) == 64

    # 显式传 null = 清除独立排版、回到继承（旧变体兼容路径）。
    cleared = client.patch(
        f"/api/resumes/{resume_id}/variants/{variant['id']}", json={"layout": None}
    )
    assert cleared.status_code == 200, cleared.text
    assert cleared.json()["layout"] is None
    assert cleared.json()["has_layout"] is False
    assert _export_input(client, resume_id, variant["id"])["layout_source"] == "snapshot"


def test_variant_created_with_layout_keeps_it(client):
    resume_id = _create_resume(client)
    layout = {"format_name": "compact", "page_limit": 2, "language": "en-US"}
    created = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "直接带排版", "layout": layout},
    )
    assert created.status_code == 201, created.text
    assert created.json()["has_layout"] is True
    detail = client.get(f"/api/resumes/{resume_id}/variants/{created.json()['id']}").json()
    assert detail["layout"] == layout
    snapshot = _export_input(client, resume_id, created.json()["id"])
    assert snapshot["layout_source"] == "variant"
    assert snapshot["layout"]["format_name"] == "compact"


def test_legacy_variant_without_layout_or_snapshot_falls_back_to_resume(client, db_session):
    """旧变体无 layout（0060 之前）：优先用派生时的 render_context 快照，不报错。"""
    resume_id = _create_resume(client)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "旧变体"}).json()
    from app.models.resume import ResumeRecord
    from app.models.versions import ResumeVariant

    # 更老的数据连 render_context 都是空 {}：按当前简历排版兜底。
    row = db_session.get(ResumeVariant, variant["id"])
    row.render_context = {}
    record = db_session.get(ResumeRecord, resume_id)
    record.template = "scholar"
    record.page_limit = 2
    db_session.commit()

    snapshot = _export_input(client, resume_id, variant["id"])
    assert snapshot["layout_source"] == "resume"
    assert snapshot["layout"]["template"] == "scholar"
    assert snapshot["layout"]["page_limit"] == 2


def test_variant_export_input_rejects_bad_layout_and_404s(client):
    resume_id = _create_resume(client)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "校验"}).json()
    bad_page = client.patch(
        f"/api/resumes/{resume_id}/variants/{variant['id']}", json={"layout": {"page_limit": 99}}
    )
    assert bad_page.status_code == 400
    bad_shape = client.patch(
        f"/api/resumes/{resume_id}/variants/{variant['id']}", json={"layout": [1, 2]}
    )
    assert bad_shape.status_code == 422
    assert (
        client.get(f"/api/resumes/{resume_id}/variants/9999/export-input").status_code == 404
    )
    other = _create_resume(client, "另一份")
    foreign = client.post(f"/api/resumes/{other}/variants", json={"name": "别人的变体"}).json()
    assert (
        client.get(
            f"/api/resumes/{resume_id}/variants/{foreign['id']}/export-input"
        ).status_code
        == 404
    )


def test_variant_export_input_rejects_deleted_resume(client):
    resume_id = _create_resume(client)
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "已删"}).json()
    assert client.delete(f"/api/resumes/{resume_id}").status_code in (200, 204)
    assert (
        client.get(f"/api/resumes/{resume_id}/variants/{variant['id']}/export-input").status_code
        == 404
    )
