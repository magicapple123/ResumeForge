# SPDX-License-Identifier: Apache-2.0
"""#38：简历文档工具的注册/只读读数/写入提案与撤销点。

三档需求的守卫都在这一个文件里：
- P0：get_resume_status 必须返回**真实**页数/溢出/截断位置（真排一遍 PDF），并指向
  「页面概览」面板；文档索引必须覆盖 CHANGELOG 与界面语言包；
- P1：list_versions / list_variants / get_entry 能读到真实数据；
- P2：四个写工具的 preview 不改库（revision 不变）、用户批准后才落库（revision +1），
  且执行前自动留一份 source=assistant 的「助手修改前」命名版本（撤销点）。
"""

from __future__ import annotations

import asyncio
import copy
import json
import time

from app import database
from app.models.resume import ResumeRecord
from app.models.versions import VERSION_SOURCE_ASSISTANT, ResumeVersion
from app.services.assistant_docs import DOC_PATHS, DOC_ROOT, search_product_docs
from app.services.assistant_tools import authorization as auth
from app.services.assistant_tools import execute_tool, get_tool, tool_names
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools.authorization import create_proposal

CONTENT = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "education": [
        {
            "school": "清华大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "start_date": "2018.09",
            "end_date": "2022.06",
            "gpa": "3.8/4.0",
        },
        {
            "school": "北京大学",
            "major": "软件工程（辅修）",
            "end_date": "2022.06",
            "gpa": "3.7/4.0",
        },
    ],
    "experience": [
        {
            "company": "字节跳动",
            "role": "后端工程师",
            "start_date": "2022.07",
            "end_date": "至今",
            "description": ["主导投递平台重构，峰值吞吐从 120/分钟提升到 900/分钟。"],
        }
    ],
    "projects": [
        {"name": "ResumeForge 简历工作台", "role": "独立开发", "description": ["文档模型 v2。"]}
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}

NEW_TOOLS = (
    "get_resume_status",
    "list_versions",
    "list_variants",
    "get_entry",
    "update_resume_field",
    "add_resume_entry",
    "reorder_sections",
    "set_entry_layout",
)
WRITE_TOOLS = (
    "update_resume_field",
    "add_resume_entry",
    "reorder_sections",
    "set_entry_layout",
)


def _create_resume(client, *, page_limit: int = 1) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "助手工具验证", "content": CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    resume_id = response.json()["id"]
    patched = client.patch(
        f"/api/resumes/{resume_id}/layout",
        json={"page_limit": page_limit, "template": "classic"},
    )
    assert patched.status_code == 200, patched.text
    return resume_id


def _revision(resume_id: int) -> int:
    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        return int(record.revision or 0)


def _content(resume_id: int) -> dict:
    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        return dict(record.content or {})


def _section(content: dict, key: str) -> dict:
    return next(section for section in content["sections"] if section["key"] == key)


def _first_item_path(content: dict, section_key: str = "education", entry_index: int = 0) -> str:
    entry = _section(content, section_key)["entries"][entry_index]
    item = entry["items"][0]
    return f"{section_key}.{entry['id']}.{item['id']}"


def _gpa_path(content: dict, entry_index: int = 0) -> str:
    entry = _section(content, "education")["entries"][entry_index]
    item = next(item for item in entry["items"] if item.get("key") == "gpa")
    return f"education.{entry['id']}.{item['id']}"


def _run(name: str, arguments: dict) -> str:
    with database.SessionLocal() as session:
        return execute_tool(session, name, arguments).text


# ===== 注册与规格 =====


def test_new_document_tools_are_registered_with_previews():
    names = set(tool_names())
    assert set(NEW_TOOLS) <= names
    for name in NEW_TOOLS:
        tool = get_tool(name)
        assert tool is not None
        assert tool.writes is (name in WRITE_TOOLS), name
        if tool.writes:
            assert tool.preview is not None, f"写工具 {name} 缺 preview"


def test_docs_index_covers_changelog_docs_subdirs_and_i18n():
    paths = {path.relative_to(DOC_ROOT).as_posix() for path in DOC_PATHS}
    assert "CHANGELOG.md" in paths
    assert any(path.startswith("docs/adr/") for path in paths)
    assert any(path.startswith("frontend/src/i18n/messages/zh-CN.") for path in paths)
    # 界面文案的唯一真相在语言包里：搜当前按钮名必须命中 i18n 文件。
    # 用「获取分页报告」而不是「页面概览」：前者是分页面板上真实存在的按钮名，只出现在
    # 语言包那一段；后者是长词，docs/README 里都提到过，文档措辞一改（多写一次、或换个
    # 小节）它就会被同分挤出 top-8，把这条断言变成对文案排版的约束。
    hits = search_product_docs("获取分页报告", limit=8)
    assert any("i18n/messages/zh-CN." in hit.path for hit in hits)


# ===== P0：版面状态 =====


def test_get_resume_status_reports_real_pages_and_overflow(client):
    resume_id = _create_resume(client, page_limit=1)
    payload = json.loads(_run("get_resume_status", {"resume_id": resume_id}))
    assert payload["pages"] == 1
    assert payload["page_limit"] == 1
    assert payload["pages_needed"] >= payload["pages"]
    assert isinstance(payload["overflow"], bool)
    assert payload["pagination_panel"]["name"] == "页面概览"
    assert "获取分页报告" in payload["pagination_panel"]["where"]
    assert payload["preflight"]["layers_run"] == ["content", "layout"]
    # 只读：工具不推进 revision。
    assert payload["revision"] == _revision(resume_id)
    assert payload["reading"].startswith("按当前排版需要")


def test_get_resume_status_locates_the_truncated_content(client):
    resume_id = _create_resume(client, page_limit=1)
    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        long_text = "负责投递平台任务调度子系统的重构，把串行消费改成按优先级分片。" * 12
        long_items = [
            {
                "kind": "text",
                "id": f"ob_it_long{index:04d}",
                "style": "bullet",
                "text": long_text,
                "hidden": False,
            }
            for index in range(12)
        ]
        # 直接写长正文：走的是与制作台相同的写收口（v2 文档 → 分页报告真排一遍）。
        from app.services.resume.document_save import save_content

        document = copy.deepcopy(record.content or {})
        experience = next(s for s in document["sections"] if s["key"] == "experience")
        experience["entries"][0]["items"].extend(long_items)
        save_content(session, record_id=resume_id, content=document, expected_revision=None)
    payload = json.loads(_run("get_resume_status", {"resume_id": resume_id}))
    assert payload["overflow"] is True
    assert payload["pages"] == 1
    truncated = payload["truncated_at"]
    assert truncated is not None
    assert truncated["section"]
    assert truncated["section_label"]


# ===== P1：版本 / 变体 / 单条 =====


def test_list_versions_and_variants_read_real_records(client):
    resume_id = _create_resume(client, page_limit=2)
    version = client.post(
        f"/api/resumes/{resume_id}/versions", json={"name": "投递版", "change_summary": "首版"}
    )
    assert version.status_code == 201, version.text
    variant = client.post(f"/api/resumes/{resume_id}/variants", json={"name": "字节变体"})
    assert variant.status_code == 201, variant.text

    versions = json.loads(_run("list_versions", {"resume_id": resume_id}))["versions"]
    assert [item["name"] for item in versions] == ["投递版"]
    variants = json.loads(_run("list_variants", {"resume_id": resume_id}))["variants"]
    assert [item["name"] for item in variants] == ["字节变体"]


def test_get_entry_reads_one_entry_and_one_field(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    entry_path = _first_item_path(content).rsplit(".", 1)[0]
    entry_payload = json.loads(_run("get_entry", {"resume_id": resume_id, "path": entry_path}))
    assert entry_payload["entry"]["object_id"] == entry_path.split(".")[1]
    assert entry_payload["entry"]["index"] == 1
    assert entry_payload["entry"]["layout"]["head"] == "split"
    assert entry_payload["value"]["items"]

    gpa_path = _gpa_path(content)
    gpa_payload = json.loads(_run("get_entry", {"resume_id": resume_id, "path": gpa_path}))
    assert gpa_payload["item"]["key"] == "gpa"
    assert gpa_payload["value"] == "3.8/4.0"


def test_get_entry_reports_unknown_path_with_sample_paths(client):
    resume_id = _create_resume(client, page_limit=2)
    with database.SessionLocal() as session:
        try:
            execute_tool(session, "get_entry", {"resume_id": resume_id, "path": "nope.1"})
        except ValueError as exc:
            assert "找不到路径" in str(exc)
            assert "education" in str(exc)
        else:  # pragma: no cover - 路径不存在必须报错
            raise AssertionError("未知 path 应当报错")


# ===== P2：preview → 确认 → apply，未确认 revision 不变 =====


def test_update_field_preview_does_not_touch_the_resume(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    path = _gpa_path(content)
    before_revision = _revision(resume_id)
    tool = get_tool("update_resume_field")
    assert tool is not None and tool.preview is not None
    with database.SessionLocal() as session:
        preview = tool.preview(session, {"resume_id": resume_id, "path": path, "value": "3.9/4.0"})
    assert preview.changes[0].before == "3.8/4.0"
    assert preview.changes[0].after == "3.9/4.0"
    assert "只改这一个字段" in preview.scope
    # preview 只读：简历一个字节都没动。
    assert _revision(resume_id) == before_revision
    assert (
        json.loads(_run("get_entry", {"resume_id": resume_id, "path": path}))["value"] == "3.8/4.0"
    )


def test_update_field_apply_increments_revision_and_leaves_undo_version(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    path = _gpa_path(content)
    before_revision = _revision(resume_id)
    payload = json.loads(
        _run("update_resume_field", {"resume_id": resume_id, "path": path, "value": "3.9/4.0"})
    )
    assert payload["revision"] == before_revision + 1
    assert payload["before"] == "3.8/4.0"
    assert payload["after"] == "3.9/4.0"
    assert "助手修改前" in payload["undo"]
    with database.SessionLocal() as session:
        snapshot = (
            session.query(ResumeVersion)
            .filter(
                ResumeVersion.resume_id == resume_id,
                ResumeVersion.source == VERSION_SOURCE_ASSISTANT,
            )
            .one()
        )
        assert "助手修改前" in snapshot.name
        assert snapshot.source_revision == before_revision


def test_add_entry_preview_then_apply(client):
    resume_id = _create_resume(client, page_limit=2)
    before_revision = _revision(resume_id)
    arguments = {
        "resume_id": resume_id,
        "section": "education",
        "entry": {
            "fields": {"school": "浙江大学", "major": "软件工程", "gpa": "3.9/4.0"},
            "body": ["辅修方向：分布式系统"],
        },
    }
    tool = get_tool("add_resume_entry")
    assert tool is not None and tool.preview is not None
    with database.SessionLocal() as session:
        preview = tool.preview(session, arguments)
    assert preview.target.endswith("教育经历」新条目")
    assert any(change.after == "浙江大学" for change in preview.changes)
    assert _revision(resume_id) == before_revision

    payload = json.loads(_run("add_resume_entry", arguments))
    assert payload["revision"] == before_revision + 1
    assert payload["section"] == "education"
    entry = json.loads(_run("get_entry", {"resume_id": resume_id, "path": payload["path"]}))
    assert entry["value"]["items"][0]["value"] == "浙江大学"


def test_reorder_sections_preview_then_apply(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    keys = [section["key"] for section in content["sections"]]
    assert len(keys) >= 2
    new_order = list(reversed(keys))
    before_revision = _revision(resume_id)
    tool = get_tool("reorder_sections")
    assert tool is not None and tool.preview is not None
    with database.SessionLocal() as session:
        preview = tool.preview(session, {"resume_id": resume_id, "order": new_order})
    assert preview.changes[0].field == "板块顺序"
    assert _revision(resume_id) == before_revision

    payload = json.loads(_run("reorder_sections", {"resume_id": resume_id, "order": new_order}))
    assert payload["after"] == new_order
    assert _revision(resume_id) == before_revision + 1
    assert [section["key"] for section in _content(resume_id)["sections"]] == new_order


def test_set_entry_layout_preview_then_apply(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    entry_path = _first_item_path(content).rsplit(".", 1)[0]
    before_revision = _revision(resume_id)
    arguments = {
        "resume_id": resume_id,
        "path": entry_path,
        "layout": {"start_on_new_page": True, "keep_together": True},
    }
    tool = get_tool("set_entry_layout")
    assert tool is not None and tool.preview is not None
    with database.SessionLocal() as session:
        preview = tool.preview(session, arguments)
    assert preview.changes[0].before == "否"
    assert preview.changes[0].after == "是"
    assert _revision(resume_id) == before_revision

    payload = json.loads(_run("set_entry_layout", arguments))
    assert payload["revision"] == before_revision + 1
    assert payload["after"]["start_on_new_page"] is True
    assert payload["after"]["keep_together"] is True


def test_apply_without_change_is_rejected_before_writing(client):
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    path = _gpa_path(content)
    before_revision = _revision(resume_id)
    with database.SessionLocal() as session:
        try:
            execute_tool(
                session,
                "update_resume_field",
                {"resume_id": resume_id, "path": path, "value": "3.8/4.0"},
            )
        except ValueError as exc:
            assert "内容一致" in str(exc)
        else:  # pragma: no cover
            raise AssertionError("无变化的写入应当被拒绝")
    assert _revision(resume_id) == before_revision


def test_http_approval_flow_writes_only_after_confirm(client, monkeypatch):
    """真实 HTTP：流层生成待确认提案 → 未确认 revision 不变 → 批准后 +1。"""
    auth.reset_store()
    resume_id = _create_resume(client, page_limit=2)
    content = _content(resume_id)
    path = _gpa_path(content)
    before_revision = _revision(resume_id)

    from app.api.assistant_tool_exec import run_tool_call

    ctx = tool_policy.build_context(writable=False)
    call = {
        "id": "call_doc_1",
        "function": {
            "name": "update_resume_field",
            "arguments": json.dumps({"resume_id": resume_id, "path": path, "value": "3.9/4.0"}),
        },
    }
    record = asyncio.run(run_tool_call(call, None, database.SessionLocal, ctx))
    assert record["ok"] is True
    proposal = record["proposal"]
    assert proposal["status"] == "pending"
    assert proposal["preview"]["changes"][0]["before"] == "3.8/4.0"
    assert _revision(resume_id) == before_revision

    approved = client.post(f"/api/assistant/write-proposals/{proposal['proposal_id']}/approve")
    assert approved.status_code == 200, approved.text
    body = approved.json()
    assert body["proposal"]["status"] == "executed"
    assert body["changed"] is True
    assert _revision(resume_id) == before_revision + 1
    time.sleep(0.01)  # 让 SQLite 写完再读（approve 端点内部已 commit）
    assert (
        json.loads(_run("get_entry", {"resume_id": resume_id, "path": path}))["value"] == "3.9/4.0"
    )
    auth.reset_store()


def test_proposal_creation_keeps_revision_when_rejected(client):
    auth.reset_store()
    resume_id = _create_resume(client, page_limit=2)
    path = _gpa_path(_content(resume_id))
    before_revision = _revision(resume_id)
    tool = get_tool("update_resume_field")
    assert tool is not None and tool.preview is not None
    ctx = tool_policy.build_context(writable=False)
    with database.SessionLocal() as session:
        preview = tool.preview(session, {"resume_id": resume_id, "path": path, "value": "3.9/4.0"})
    proposal = create_proposal(
        ctx,
        "update_resume_field",
        {"resume_id": resume_id, "path": path, "value": "3.9/4.0"},
        preview,
    )
    rejected = client.post(f"/api/assistant/write-proposals/{proposal.proposal_id}/reject")
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["proposal"]["status"] == "rejected"
    assert _revision(resume_id) == before_revision
    auth.reset_store()
