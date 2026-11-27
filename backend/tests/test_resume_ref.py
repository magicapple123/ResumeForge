# SPDX-License-Identifier: Apache-2.0
"""T29：`resolve_resume_ref` 的四类结局（成功 / 缺文字 / 缺文件 / id 不存在）。

守的性质（对应验收「对 text/file/document 分别返回或给『为什么没有 + 怎么办』」）：

a. **成功**：内部简历的 `text` / `document`、外部简历的 `text` / `file` 都能拿到，
   `reason is None`；旧写法 `r:` / `e:` 与新的 `internal:` / `external:` 解析结果一致；
b. **缺文字**：扫描件（`text=""`）与空草稿都给 `reason`，且说明里必须出现「怎么办」——
   这是验收原话，不给下一步等于把问题丢回给用户；
c. **缺文件**：内部简历没有原件、外部简历的原件被从磁盘删掉，各自给不同的 `reason`；
d. **id 不存在 / ref 写错**：`internal:9999` 与 `external:9999` 说「不存在或已删除」，
   `abc` / `internal:0` / `internal:-3` / `k:v` 这类串一律按「看不出是哪一份」处理，
   **不抛异常**（助手工具与任务都依赖这个约定）。

跑在真实应用 + 真实 SQLite 上（`conftest.clean_db` 每例重建表），外部简历真的落盘，
「原件缺失」是真的把文件从 `user_files/` 删掉，不是打桩。
"""

from __future__ import annotations

import pytest
from app import database
from app.models.external_resume import ExternalResume
from app.models.resume import ResumeRecord
from app.models.user_file import UserFile
from app.services.resume_ref import (
    EXTERNAL_NO_DOCUMENT,
    EXTERNAL_NO_FILE,
    EXTERNAL_NO_TEXT,
    INTERNAL_NO_FILE,
    INTERNAL_NO_TEXT,
    INVALID_REF,
    encode_resume_ref,
    parse_resume_ref,
    resolve_resume_ref,
)
from app.services.user_files import user_files_dir
from tests.test_document_text import build_pdf

#: 一份真正有文字的 TXT（上传时本地提取，正文立刻可用）。
TXT_BODY = "张三\n手机：13800138000\n负责后端接口开发，接口耗时下降 30%"

#: v2 文档：内部简历的「有正文」样本（直接用 ORM 落库，避开生成链路）。
#: 对象 id 必须符合 W01 口径（8-32 位字母/数字/_/-），所以用固定串而不是 "h1"。
DOCUMENT = {
    "version": 2,
    "header": {"items": [{"id": "ob_header_name0001", "key": "name", "value": "张示例"}]},
    "sections": [
        {
            "key": "summary",
            "kind": "entries",
            "entries": [
                {
                    "id": "ob_entry_summary001",
                    "items": [
                        {
                            "id": "ob_item_summary0001",
                            "kind": "text",
                            "label": "个人优势",
                            "text": "六年后端经验",
                        }
                    ],
                }
            ],
        }
    ],
}


def _add_internal(db_session, *, title: str, content: dict) -> int:
    """建一条内部简历（已保存，不是草稿），返回 id。"""
    record = ResumeRecord(title=title, content=content, source="manual", draft=False)
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return int(record.id)


def _upload(client, content: bytes, filename: str, mime: str) -> int:
    response = client.post(
        "/api/external-resumes",
        files={"file": (filename, content, mime)},
        data={"name": ""},
    )
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def _assert_has_next_step(reason: str | None) -> None:
    """每条缺失说明都必须回答「怎么办」（验收原话）。"""
    assert reason, "缺东西时必须给 reason，不能只返回 None / 空串"
    assert "怎么办" in reason, f"reason 没说怎么办：{reason}"


# ===== a. 成功 =====


def test_internal_text_and_document_are_resolved(db_session):
    resume_id = _add_internal(db_session, title="后端-通用", content=DOCUMENT)
    ref = encode_resume_ref("internal", resume_id)
    assert ref == f"internal:{resume_id}"

    text = resolve_resume_ref(db_session, ref, "text")
    assert text.ok and text.reason is None
    assert text.kind == "internal" and text.id == resume_id
    assert text.name == "后端-通用"
    assert "六年后端经验" in (text.text or "")
    # 只看要的东西：要 text 时不该顺带把文档塞进来。
    assert text.document is None and text.file_id is None

    document = resolve_resume_ref(db_session, ref, "document")
    assert document.ok and document.reason is None
    assert isinstance(document.document, dict)
    assert document.document.get("version") == 2
    assert document.text is None


def test_external_text_and_file_are_resolved(client, db_session):
    resume_id = _upload(client, TXT_BODY.encode("utf-8"), "外部-张.txt", "text/plain")
    ref = encode_resume_ref("external", resume_id)

    text = resolve_resume_ref(db_session, ref, "text")
    assert text.ok
    assert text.kind == "external" and text.id == resume_id
    assert "接口耗时下降" in (text.text or "")

    file_ref = resolve_resume_ref(db_session, ref, "file")
    assert file_ref.ok
    row = db_session.get(ExternalResume, resume_id)
    assert file_ref.file_id == int(row.file_id)
    assert file_ref.text is None


def test_legacy_prefixes_resolve_to_the_same_ref(db_session):
    resume_id = _add_internal(db_session, title="旧写法", content=DOCUMENT)
    assert parse_resume_ref(f"r:{resume_id}") == ("internal", resume_id)
    assert parse_resume_ref(f"e:{resume_id}") == ("external", resume_id)
    resolved = resolve_resume_ref(db_session, f"r:{resume_id}", "text")
    assert resolved.ok
    # 回写一律用新写法：旧前缀只进不出。
    assert resolved.ref == f"internal:{resume_id}"


# ===== b. 缺文字 =====


def test_scanned_external_resume_explains_why_and_what_next(client, db_session):
    """扫描件：行照建、正文为空 —— 解析必须说「没有文字层」并给下一步。"""
    resume_id = _upload(client, build_pdf(blank=True), "扫描件.pdf", "application/pdf")
    resolved = resolve_resume_ref(db_session, f"external:{resume_id}", "text")
    assert resolved.ok is False
    assert resolved.text == ""
    _assert_has_next_step(resolved.reason)
    assert resolved.reason == EXTERNAL_NO_TEXT
    assert "文字层" in resolved.reason and "文本检查" in resolved.reason


def test_empty_internal_draft_explains_why_and_what_next(db_session):
    """空草稿（没有任何可见文本）不能说「分析完成但没发现问题」，要说清楚是空的。"""
    resume_id = _add_internal(db_session, title="刚建的空白", content={})
    resolved = resolve_resume_ref(db_session, f"internal:{resume_id}", "text")
    assert resolved.ok is False
    _assert_has_next_step(resolved.reason)
    assert resolved.reason == INTERNAL_NO_TEXT


# ===== c. 缺文件 =====


def test_internal_resume_has_no_original_file(db_session):
    """内部简历是结构化文档：`need="file"` 明确说明「没有原件，去导出」。"""
    resume_id = _add_internal(db_session, title="需要导出", content=DOCUMENT)
    resolved = resolve_resume_ref(db_session, f"internal:{resume_id}", "file")
    assert resolved.ok is False
    assert resolved.file_id is None
    _assert_has_next_step(resolved.reason)
    assert resolved.reason == INTERNAL_NO_FILE
    assert "导出" in resolved.reason


def test_external_original_file_deleted_from_disk(client, db_session):
    """原件从磁盘上没了（备份只回库不回文件）→ 说「原件不在」并指到历史版本。"""
    resume_id = _upload(client, TXT_BODY.encode("utf-8"), "会被删掉.txt", "text/plain")
    row = db_session.get(ExternalResume, resume_id)
    user_file = db_session.get(UserFile, row.file_id)
    path = user_files_dir(database.engine) / user_file.disk_name
    assert path.is_file(), "上传后原件应当真的落盘"
    path.unlink()

    resolved = resolve_resume_ref(db_session, f"external:{resume_id}", "file")
    assert resolved.ok is False
    assert resolved.file_id is None
    _assert_has_next_step(resolved.reason)
    assert resolved.reason == EXTERNAL_NO_FILE

    # 同一份记录的正文仍在（核对两条路径互不牵连）。
    text = resolve_resume_ref(db_session, f"external:{resume_id}", "text")
    assert text.ok and "接口耗时下降" in (text.text or "")


def test_external_resume_has_no_structured_document(client, db_session):
    resume_id = _upload(client, TXT_BODY.encode("utf-8"), "没有文档.txt", "text/plain")
    resolved = resolve_resume_ref(db_session, f"external:{resume_id}", "document")
    assert resolved.ok is False
    assert resolved.document is None
    _assert_has_next_step(resolved.reason)
    assert resolved.reason == EXTERNAL_NO_DOCUMENT
    assert "块编辑" in resolved.reason


# ===== d. id 不存在 / ref 写错 =====


@pytest.mark.parametrize(
    ("ref", "kind"),
    [
        ("internal:9999", "internal"),
        ("external:9999", "external"),
    ],
)
def test_missing_ids_are_reported_not_raised(db_session, ref: str, kind: str):
    resolved = resolve_resume_ref(db_session, ref, "text")
    assert resolved.ok is False
    assert resolved.kind == kind and resolved.id == 9999
    _assert_has_next_step(resolved.reason)
    assert "不存在" in resolved.reason


def test_deleted_internal_resume_is_treated_as_missing(db_session):
    """进了回收站的记录对解析来说是「不存在」（与列表 / 详情同一口径）。"""
    from app.services import trash

    resume_id = _add_internal(db_session, title="待删除", content=DOCUMENT)
    record = db_session.get(ResumeRecord, resume_id)
    trash.soft_delete(db_session, "resume", record)
    db_session.commit()

    resolved = resolve_resume_ref(db_session, f"internal:{resume_id}", "text")
    assert resolved.ok is False
    assert "不存在" in resolved.reason


@pytest.mark.parametrize(
    "ref",
    [
        "",
        None,
        "abc",
        "internal",
        ":7",
        "internal:",
        "internal:0",
        "internal:-3",
        "internal:3.5",
        "internal:3x",
        "k:v",
        "7",
    ],
)
def test_unparsable_refs_never_raise(db_session, ref):
    resolved = resolve_resume_ref(db_session, ref, "text")
    assert resolved.ok is False
    assert resolved.kind == "" and resolved.id == 0 and resolved.ref == ""
    assert resolved.reason == INVALID_REF.format(ref=ref or "")


def test_unknown_need_is_a_programming_error(db_session):
    """`need` 是编码期的枚举，写错了要立刻炸，不能悄悄按某一种返回。"""
    with pytest.raises(ValueError):
        resolve_resume_ref(db_session, "internal:1", "pdf")


# ===== e. 真实调用点：助手只读工具「分析这份简历」 =====


def _run_tool(db_session, arguments: dict) -> dict:
    """跑一次助手工具，返回解析好的 JSON（工具结果是 JSON 文本）。"""
    import json

    from app.services.assistant_tools import execute_tool

    return json.loads(execute_tool(db_session, "run_resume_quality_check", arguments).text)


def test_quality_tool_accepts_internal_resume_ref(db_session):
    """内部简历用复合引用调用与用 resume_id 调用是同一份结果。"""
    resume_id = _add_internal(db_session, title="引用调用", content=DOCUMENT)
    payload = _run_tool(db_session, {"resume_ref": f"internal:{resume_id}"})
    assert payload["resume_id"] == resume_id
    assert payload["resume_ref"] == f"internal:{resume_id}"
    assert isinstance(payload["total"], int)
    assert "reason" not in payload


def test_quality_tool_explains_external_resume_instead_of_scanning(db_session, client):
    """外部简历没有结构化文档：工具要把「为什么做不了 + 怎么办」原样交出去。"""
    resume_id = _upload(client, TXT_BODY.encode("utf-8"), "外部-工具.txt", "text/plain")
    payload = _run_tool(db_session, {"resume_ref": f"external:{resume_id}"})
    assert payload["available"] is False
    assert payload["reason"] == EXTERNAL_NO_DOCUMENT
    _assert_has_next_step(payload["reason"])
    # 不能编一份"没有发现问题"的结果出来。
    assert "total" not in payload


def test_quality_tool_reports_missing_resume_ref(db_session):
    payload = _run_tool(db_session, {"resume_ref": "internal:9999"})
    assert payload["available"] is False
    assert "不存在" in payload["reason"]


def test_quality_tool_requires_one_of_the_two_ids(db_session):
    with pytest.raises(ValueError) as error:
        _run_tool(db_session, {})
    assert "resume_ref" in str(error.value)
