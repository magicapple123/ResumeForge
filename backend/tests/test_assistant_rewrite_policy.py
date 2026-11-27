# SPDX-License-Identifier: Apache-2.0
"""T35：助手工具层的「整篇重写」判定与拒答（块编辑出路）。

守的性质：

a. 判定只看**工具调用形态**——整份载荷 / 整块 path / 空 section 批量，不看模型措辞；
b. 拒答必须给出路：文案里要有块编辑的具体工具与路径粒度，不能只写"不支持"；
c. 逐块写入、只读分析、单板块批量一律放行；
d. 外部简历对助手只读：写调用被拒，读文本的路径照常给建议；
e. 外部简历没有文字层时把 ``reason`` 原样交给模型，不塞空正文；
f. 注册表守卫：没有"写整份文档"的工具，也没有未登记粒度的简历写工具——新工具想
   开这个口子会先被测试点名。
"""

from __future__ import annotations

from app.models.external_resume import ExternalResume
from app.models.user_file import UserFile
from app.services.assistant.assistant_context import resume_ref_context
from app.services.assistant_tools import _TOOLS, execute_tool, rewrite_policy
from app.services.resume_ref import CODE_NO_TEXT, resolve_resume_ref

RESUME_ID = 4242


def _external_resume(db_session, *, text: str = "", name: str = "示例外部简历.pdf") -> int:
    """建一条外部简历行；原件不在磁盘上（正文为空时走"读不到"分支）。"""
    file_row = UserFile(
        sha256="a" * 64,
        disk_name="missing-original.pdf",
        original_name=name,
        mime="application/pdf",
        source_type="external_resume",
    )
    db_session.add(file_row)
    db_session.commit()
    db_session.refresh(file_row)
    record = ExternalResume(
        file_id=file_row.id,
        original_file_id=file_row.id,
        name=name,
        text=text,
        text_chars=len(text),
    )
    db_session.add(record)
    db_session.commit()
    db_session.refresh(record)
    return record.id


# ===== a/b. 整篇重写被拒，且给出块编辑出路 =====


def test_whole_resume_batch_is_refused_with_block_edit_guidance(db_session):
    """不带 section 的 resume_batch_edit = 重写全部条目 → 拒绝，且指到逐块工具。"""
    arguments = {
        "kind": "resume_batch_edit",
        "params": {"resume_id": RESUME_ID, "instruction": "帮我把整篇简历重写一遍"},
    }
    assert rewrite_policy.block_reasons("task_create", arguments) == (
        rewrite_policy.WHOLE_RESUME_BATCH,
    )

    refusal = rewrite_policy.build_refusal("task_create", arguments)
    assert refusal is not None
    # 出路必须具体：块编辑工具 + 路径粒度 + 单板块批量的正确写法。
    assert "update_resume_field" in refusal
    assert "education.1.gpa" in refusal
    assert '"section": "projects"' in refusal
    assert "整篇" in refusal and "一个字节都没变" in refusal

    # 执行层同样拒绝（handler 不执行，语料里也没有真的去建任务）。
    result = execute_tool(db_session, "task_create", arguments)
    assert result.summary == "已拒绝整篇重写"
    assert result.changed is False
    assert "update_resume_field" in result.text


def test_section_scoped_batch_is_allowed():
    """指定一个板块的批量改写是逐块粒度，放行。"""
    arguments = {
        "kind": "resume_batch_edit",
        "params": {"resume_id": RESUME_ID, "section": "projects", "instruction": "按 STAR 重写"},
    }
    assert rewrite_policy.is_whole_resume_rewrite("task_create", arguments) is False
    assert rewrite_policy.build_refusal("task_create", arguments) is None
    # "全部 / all / 整篇" 不是板块 key，按整份处理。
    for section in ("all", "*", "全部", "整篇"):
        whole = {
            "kind": "resume_batch_edit",
            "params": {"resume_id": RESUME_ID, "section": section, "instruction": "重写"},
        }
        assert rewrite_policy.is_whole_resume_rewrite("task_create", whole) is True, section


# ===== 整份载荷 / 整块 path / 整份 value =====


def test_whole_document_payload_is_refused_for_any_tool_shape():
    """带简历身份 + content/document 的调用（含将来的新工具）一律拒绝。"""
    arguments = {
        "resume_id": RESUME_ID,
        "content": {"sections": [{"key": "experience", "entries": []}]},
    }
    assert rewrite_policy.WHOLE_DOCUMENT_PAYLOAD in rewrite_policy.block_reasons(
        "set_resume_content", arguments
    )
    assert rewrite_policy.is_whole_resume_rewrite("update_resume_field", arguments)
    assert "content" in (rewrite_policy.build_refusal("update_resume_field", arguments) or "")

    # 知识库这类没有简历身份的 content 写入不受影响（不能误伤）。
    knowledge = {"title": "面经", "content": "# 正文"}
    assert rewrite_policy.build_refusal("create_knowledge", knowledge) is None


def test_entry_or_section_path_is_refused_but_field_path_passes():
    """update_resume_field 的 path 必须落到一个字段；整条/整块指向要拒绝。"""
    for path in ("education", "education.1", "education.ob_en_0001", "*", ""):
        assert rewrite_policy.DOCUMENT_PATH in rewrite_policy.block_reasons(
            "update_resume_field", {"resume_id": RESUME_ID, "path": path, "value": "x"}
        ), path

    for path in ("education.1.gpa", "header.name", "experience.2.description.0"):
        assert rewrite_policy.path_scope(path) == "field", path
        assert (
            rewrite_policy.build_refusal(
                "update_resume_field", {"resume_id": RESUME_ID, "path": path, "value": "x"}
            )
            is None
        ), path


def test_whole_document_value_is_refused():
    """把一整份文档对象塞进 value，等于整篇写入。"""
    arguments = {
        "resume_id": RESUME_ID,
        "path": "education.1.gpa",
        "value": {"sections": []},
    }
    assert rewrite_policy.WHOLE_DOCUMENT_VALUE in rewrite_policy.block_reasons(
        "update_resume_field", arguments
    )


# ===== c/d. 只读与外部简历 =====


def test_read_only_analysis_is_allowed_even_for_external_resume():
    """只读分析不受限：质量检测 / 单条读取 / ATS 都能指向外部简历。"""
    assert (
        rewrite_policy.build_refusal("run_resume_quality_check", {"resume_ref": "external:7"})
        is None
    )
    assert (
        rewrite_policy.build_refusal("get_entry", {"resume_id": 1, "path": "education.1"}) is None
    )
    assert rewrite_policy.build_refusal("check_ats_match", {"resume_id": 1, "job_id": 2}) is None


def test_external_resume_is_read_only_for_writes():
    """写工具指向 external:* → 拒绝，并指向外部简历的块编辑。"""
    arguments = {
        "resume_ref": "external:7",
        "path": "education.1.gpa",
        "value": "3.9",
    }
    reasons = rewrite_policy.block_reasons("update_resume_field", arguments)
    assert rewrite_policy.EXTERNAL_READ_ONLY in reasons

    refusal = rewrite_policy.build_refusal("update_resume_field", arguments) or ""
    assert "external:7" in refusal
    assert "外部简历" in refusal and "块编辑" in refusal


# ===== e. 读不到文本时交 reason，不编内容 =====


def test_external_resume_without_text_hands_back_the_reason(db_session):
    """扫描件 / 无文字层：上下文块只有 available=false 与 reason，没有空 text。"""
    resume_id = _external_resume(db_session, text="")
    resolved = resolve_resume_ref(db_session, f"external:{resume_id}", "text")
    assert resolved.ok is False
    assert resolved.code == CODE_NO_TEXT

    block = resume_ref_context(resolved)
    assert '"available": false' in block
    assert "文字层" in block
    assert '"text"' not in block


def test_external_resume_with_text_is_readable_for_advice(db_session):
    """有文字层就把正文给模型（读取不受限，建议按段落给）。"""
    resume_id = _external_resume(db_session, text="张三\n后端工程师\n负责投递平台重构。")
    resolved = resolve_resume_ref(db_session, f"external:{resume_id}", "text")
    assert resolved.ok is True
    block = resume_ref_context(resolved)
    assert "负责投递平台重构" in block


# ===== f. 注册表守卫：新工具不能开这个口子 =====


def test_no_registered_tool_declares_a_whole_document_write():
    offenders = [tool.name for tool in _TOOLS if rewrite_policy.declares_whole_document_write(tool)]
    assert offenders == []


def test_every_resume_write_tool_has_a_block_level_scope():
    assert rewrite_policy.unclassified_resume_write_tools(_TOOLS) == []
    assert "document" not in rewrite_policy.RESUME_WRITE_SCOPES.values()


def test_synthetic_whole_document_tool_is_detected():
    """把"将来可能出现的整篇写工具"喂给守卫函数，必须被认出来。"""
    from app.services.assistant_tools._types import Tool, ToolPermission

    def _handler(db, arguments):
        raise AssertionError("整份写入的 handler 不应该被执行")

    future = Tool(
        name="rewrite_resume",
        description="把整份简历重写一遍",
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer"},
                "content": {"type": "object"},
            },
        },
        handler=_handler,
        permission=ToolPermission.REVERSIBLE_WRITE,
    )
    assert rewrite_policy.declares_whole_document_write(future) is True
    # 名字带 resume 的新写工具必须登记粒度，否则守卫点名（这里故意不登记）。
    assert rewrite_policy.unclassified_resume_write_tools([future]) == ["rewrite_resume"]
    assert rewrite_policy.is_whole_resume_rewrite(
        "rewrite_resume", {"resume_id": 1, "content": {"sections": []}}
    )


def test_refusal_does_not_depend_on_natural_language():
    """同一条"整篇重写"请求，改成任何说法都不改变判定：判定只读参数形态。"""
    base = {"kind": "resume_batch_edit", "params": {"resume_id": RESUME_ID}}
    for instruction in ("整篇重写", "帮我润色一下", "随便看看"):
        arguments = {**base, "params": {**base["params"], "instruction": instruction}}
        assert rewrite_policy.is_whole_resume_rewrite("task_create", arguments) is True
