# SPDX-License-Identifier: Apache-2.0
"""助手给用户看的序号从 1 开始，写入文档的路径仍是 0 基——两者不能混。

守的是"用户说第 2 条、改到的却是第 3 条"这类错位：序号要跳过隐藏条目、按板块解析，
非法序号要给出可执行的恢复步骤；写回时只把序号换成内部路径，其余原样保留。
"""

import copy
import json

import pytest
from app import database
from app.services.assistant_tools import execute_tool, get_tool
from app.services.assistant_tools.document_support import require_path, sample_paths
from app.services.resume.document_io import ensure_document_version
from app.services.resume.document_paths import resolve_document_path


def _document():
    return ensure_document_version(
        {
            "name": "R-22 verification",
            "education": [
                {"school": "First University", "gpa": "3.8"},
                {"school": "Second University", "gpa": "3.7"},
            ],
            "campus_experience": [
                {"organization": "First Society", "description": ["First", "Second"]},
                {"organization": "Second Society", "description": ["Other"]},
            ],
        }
    )


def _entries(document, section_key):
    return next(s for s in document["sections"] if s["key"] == section_key)["entries"]


@pytest.mark.parametrize("ordinal", [1, 2])
def test_assistant_numeric_entry_paths_start_at_one(ordinal):
    document = _document()
    _path, target = require_path(document, {"path": f"campus_experience.{ordinal}"})
    assert target.entry == _entries(document, "campus_experience")[ordinal - 1]
    assert resolve_document_path(document, f"campus_experience.{ordinal - 1}").entry == target.entry


@pytest.mark.parametrize("ordinal", [0, 3])
def test_assistant_rejects_invalid_ordinals_with_recovery_steps(ordinal):
    document = _document()
    with pytest.raises(ValueError) as error:
        require_path(document, {"path": f"campus_experience.{ordinal}"})
    assert f"不存在第 {ordinal} 条" in str(error.value)
    assert "从 1 开始" in str(error.value)
    assert "list_resume_sections / get_entry" in str(error.value)


def test_assistant_converts_only_entry_ordinal_and_returns_internal_path():
    document = _document()
    path, target = require_path(document, {"path": "campus_experience.1.description.1"})
    assert target.read() == "Second"
    assert resolve_document_path(document, path).read() == "Second"
    stable_path = target.path
    assert require_path(document, {"path": stable_path})[1].item is target.item


def test_assistant_ordinals_skip_hidden_entries_without_changing_stable_ids():
    document = _document()
    entries = _entries(document, "education")
    entries[0]["hidden"] = True
    assert require_path(document, {"path": "education.1"})[1].entry is entries[1]
    stable = f"education.{entries[0]['id']}"
    assert require_path(document, {"path": stable})[1].entry is entries[0]


def test_samples_cover_each_section_before_supplementing_fields():
    document = _document()
    first = _entries(document, "education")[0]
    first["items"].extend({"id": f"sample_{i}", "kind": "text", "text": str(i)} for i in range(12))
    samples = sample_paths(document)
    assert len(samples) == 10
    assert {sample.split(".")[0] for sample in samples[:2]} == {
        "education",
        "campus_experience",
    }
    assert len(samples) == len(set(samples))
    with pytest.raises(ValueError) as error:
        require_path(document, {"path": "unknown.1"})
    assert "education." in str(error.value)
    assert "campus_experience." in str(error.value)


def test_samples_keep_all_sections_even_when_the_limit_is_smaller():
    document = {
        "version": 2,
        "sections": [
            {"key": f"section_{i}", "entries": [{"id": f"entry_{i}", "items": []}]}
            for i in range(11)
        ],
    }
    assert {path.split(".")[0] for path in sample_paths(document)} == {
        f"section_{i}" for i in range(11)
    }
    assert sample_paths(document, limit=0) == []


def test_numeric_update_changes_first_entry_and_preserves_second(client):
    response = client.post(
        "/api/resumes/manual",
        json={"title": "R-22 numeric path", "content": _document()},
    )
    assert response.status_code == 201, response.text
    record = response.json()
    before_second = copy.deepcopy(_entries(record["content"], "education")[1])
    arguments = {"resume_id": record["id"], "path": "education.1.gpa", "value": "3.9"}
    tool = get_tool("update_resume_field")
    with database.SessionLocal() as session:
        preview = tool.preview(session, arguments)
        assert preview.changes[0].before == "3.8"
        result = json.loads(execute_tool(session, "update_resume_field", arguments).text)
        first = json.loads(
            execute_tool(
                session, "get_entry", {"resume_id": record["id"], "path": "education.1.gpa"}
            ).text
        )
    assert result["before"] == "3.8"
    assert result["after"] == "3.9"
    assert first["value"] == "3.9"
    after = client.get(f"/api/resumes/{record['id']}").json()["content"]
    assert _entries(after, "education")[1] == before_second
