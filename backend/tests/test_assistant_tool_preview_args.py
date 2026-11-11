# SPDX-License-Identifier: Apache-2.0
"""#13C/#13D：工具参数预览与简历文档写操作 diff/撤销契约。

守三件事：
- args_preview 只带白名单键的值（截 120 字），敏感键连名字都不出现；
- run_tool_call 把结果里的 preview 白名单投影进 record（不含内部 path）；
- 四个简历文档写工具给出 before/after/version_id/undo_text；其他写工具没有 preview。
"""

from __future__ import annotations

import asyncio
import json

from app import database
from app.models.resume import ResumeRecord
from app.services.assistant.assistant_tool_exec import (
    ARG_PREVIEW_MAX_VALUE_CHARS,
    _sanitize_preview,
    build_args_preview,
    run_tool_call,
)
from app.services.assistant_tools import policy as tool_policy

CONTENT = {
    "name": "张示例",
    "job_intent": "后端工程师",
    "education": [
        {
            "school": "清华大学",
            "major": "计算机科学与技术",
            "degree": "本科",
            "gpa": "3.8/4.0",
        }
    ],
    "skills": [{"name": "Python", "level": "熟练"}],
}


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "参数与撤销验证", "content": CONTENT, "job_id": None},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _gpa_path(resume_id: int) -> str:
    with database.SessionLocal() as session:
        record = session.get(ResumeRecord, resume_id)
        assert record is not None
        document = dict(record.content or {})
    section = next(item for item in document["sections"] if item["key"] == "education")
    entry = section["entries"][0]
    item = next(item for item in entry["items"] if item.get("key") == "gpa")
    return f"education.{entry['id']}.{item['id']}"


def _call(name: str, arguments: dict, *, writable: bool) -> dict:
    ctx = tool_policy.build_context(writable=writable)
    call = {
        "id": "call_preview_1",
        "function": {"name": name, "arguments": json.dumps(arguments, ensure_ascii=False)},
    }
    return asyncio.run(run_tool_call(call, None, database.SessionLocal, ctx))


def test_args_preview_whitelists_values_and_hides_sensitive_keys():
    long_query = "招聘" * 100
    preview = build_args_preview(
        {
            "query": long_query,
            "entry_id": 5,
            "api_key": "sk-should-never-appear",
            "phone": "13800000000",
            "id_card": "110101199001010011",
            "value": "用户简历正文",
            "limit": 10,
        }
    )
    by_key = {item["key"]: item for item in preview}
    # 白名单键带值，且长值被截到 120 字符。
    assert by_key["query"]["value"] == long_query[:ARG_PREVIEW_MAX_VALUE_CHARS]
    assert len(by_key["query"]["value"]) == ARG_PREVIEW_MAX_VALUE_CHARS
    assert by_key["entry_id"] == {"key": "entry_id", "value": "5"}
    # 敏感键连名字都不出现（消息 context 会被导出/回放）。
    for banned in ("api_key", "phone", "id_card"):
        assert banned not in by_key
    # 其余键只留名字，不带值。
    assert by_key["value"] == {"key": "value"}
    assert by_key["limit"] == {"key": "limit"}


def test_sanitize_preview_drops_internal_path_and_unknown_fields():
    sanitized = _sanitize_preview(
        {
            "before": "3.8/4.0",
            "after": "3.9/4.0",
            "version_id": 12,
            "undo_text": "可恢复",
            "resume_id": 3,
            "revision": 9,
            "path": "education.ob_en_abc.ob_it_def",
            "internal_note": "不该出现",
        }
    )
    assert sanitized == {
        "before": "3.8/4.0",
        "after": "3.9/4.0",
        "version_id": 12,
        "undo_text": "可恢复",
        "resume_id": 3,
        "revision": 9,
    }
    assert "path" not in sanitized
    assert _sanitize_preview(None) is None


def test_document_write_records_structured_preview(client):
    resume_id = _create_resume(client)
    path = _gpa_path(resume_id)
    record = _call(
        "update_resume_field",
        {"resume_id": resume_id, "path": path, "value": "3.9/4.0"},
        writable=True,
    )
    assert record["ok"] is True, record
    preview = record["preview"]
    assert preview is not None
    assert preview["before"] == "3.8/4.0"
    assert preview["after"] == "3.9/4.0"
    assert isinstance(preview["version_id"], int)
    assert isinstance(preview["revision"], int)
    assert preview["resume_id"] == resume_id
    assert preview["undo_text"]
    # 内部 path（含 ob_ 对象 id）绝不出现在预览里。
    assert "path" not in preview
    assert "ob_" not in json.dumps(preview, ensure_ascii=False)
    # 参数预览：白名单键 resume_id 带值；path 只留名字，不泄露对象 id。
    args_by_key = {item["key"]: item for item in record["args_preview"]}
    assert args_by_key["resume_id"]["value"] == str(resume_id)
    assert args_by_key["path"] == {"key": "path"}
    # 撤销点版本名写进 undo_text 供界面兜底说明。
    assert "助手修改前" in preview["undo_text"]


def test_other_write_tools_have_no_preview(client):
    record = _call("update_profile", {"job_intent": "后端工程师"}, writable=True)
    assert record["ok"] is True, record
    assert record["changed"] is True
    # 非简历文档类写工具没有结构化 diff：前端据此显示「该操作暂不支持撤销」。
    assert record["preview"] is None
    # 参数预览仍然只有名字，不含手机号这类敏感键。
    assert all("value" not in item for item in record["args_preview"])
