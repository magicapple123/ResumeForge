# SPDX-License-Identifier: Apache-2.0
"""简历文档工具声明（#38：P0 版面读数 / P1 版本变体与单条 / P2 四种局部改写）。

单独成一个分片（而不是塞进 REPORT_TOOLS）的原因：这批工具是**同一份 v2 文档**上的
读写，参数口径（path / section / entry / layout）与版本语义（revision +1、自动留档）
共享一套约定，放一处才能保持描述一致；同时 REPORT_TOOLS 已到行数上限。

T28 最后一批：get_resume_status / list_versions / list_variants 三条**只读**工具与真实
GET/POST 路由成对存在，声明改由 action 契约层生成（as_tool(ActionSpec)）；其余五条
（get_entry + 四个写工具）没有可安全等价迁移的路由（原因见
app/services/actions/domains/resume_document.py 模块 docstring），保留原静态声明。
"""

from __future__ import annotations

from ..actions.domains.resume_document import resume_document_actions
from ..actions.tool_adapter import as_tool
from . import previews_document
from ._types import Tool, ToolPermission
from .document_tools import _tool_get_entry
from .document_write_tools import (
    _tool_add_resume_entry,
    _tool_reorder_sections,
    _tool_set_entry_layout,
    _tool_update_resume_field,
)

_STATELESS_READ_NOTE = (
    "回答简历状态/页数/溢出/断页这类问题必须先调用 get_resume_status 取真实读数，"
    "不要凭 get_resume 的正文推测页数。"
)

DOCUMENT_TOOLS: tuple[Tool, ...] = (
    as_tool(resume_document_actions()["get_resume_status"]),
    as_tool(resume_document_actions()["list_versions"]),
    as_tool(resume_document_actions()["list_variants"]),
    Tool(
        name="get_entry",
        description=(
            "按 path 读取简历里的**单条**内容（一个条目或一个字段）。path 形如 "
            "education.<条目id>.<字段id>；条目序号从 1 开始：education.1 表示教育经历第 1 条。"
            "返回该条目的 id/序号/条目布局、字段的当前位置与类型，以及值。"
            "用户只问某一条（例如「第二条教育经历的绩点是多少」）或改之前要先确认 id 时用它。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "path": {
                    "type": "string",
                    "description": "内容路径，条目序号从 1 开始，如 education.1 或 education.<条目id>.<字段id>",
                },
            },
            "required": ["resume_id", "path"],
        },
        handler=_tool_get_entry,
        service_entry=None,
        service_reason="经 assistant_tools.document_support 读写 v2 文档（内部唯一收口，无 services 符号）",
        permission=ToolPermission.READ_ONLY,
    ),
    Tool(
        name="update_resume_field",
        description=(
            "修改简历里**已存在的一个字段**的值（正文某一条的一个字段，不是版式）。"
            "需要先 get_entry 确认 path（条目序号从 1 开始，如 education.1.gpa）。"
            + _STATELESS_READ_NOTE
            + "这是写入工具：会先给用户看 before/after 差异，用户确认后才执行；执行前自动留"
            "「助手修改前」版本，可在版本面板恢复。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "path": {"type": "string", "description": "要改的字段路径（先用 get_entry 确认）"},
                "value": {
                    "type": "string",
                    "description": "新值（字符串；列表字段传字符串数组）",
                },
            },
            "required": ["resume_id", "path", "value"],
        },
        handler=_tool_update_resume_field,
        service_entry="resume.document_paths.write_document_value",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews_document.preview_update_resume_field,
    ),
    Tool(
        name="add_resume_entry",
        description=(
            "在某份简历的板块末尾**追加一条**条目（教育经历/实习工作/项目/校园经历/奖项等）。"
            "section 传板块 key（education / experience / projects / campus_experience / awards）"
            "或中文标题；entry.fields 传标量字段（如 school/major/gpa/start_date/end_date），"
            "entry.body 传正文要点数组，entry.layout 可选。"
            "只在用户明确要求「加一条经历/项目」时调用；写入前先给差异预览，用户确认后才执行。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "section": {
                    "type": "string",
                    "description": "板块 key 或标题，如 education / 教育经历",
                },
                "entry": {
                    "type": "object",
                    "description": "新条目：{fields: {字段key: 值}, body: [正文文字], layout: {可选条目布局}}",
                    "properties": {
                        "fields": {"type": "object", "description": "标量字段映射"},
                        "body": {
                            "type": "array",
                            "items": {"type": "string"},
                            "description": "正文要点",
                        },
                        "layout": {"type": "object", "description": "可选条目布局覆盖"},
                    },
                    "required": ["fields"],
                },
            },
            "required": ["resume_id", "section", "entry"],
        },
        handler=_tool_add_resume_entry,
        service_entry=None,
        service_reason="经 assistant_tools.document_support 读写 v2 文档（内部唯一收口，无 services 符号）",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews_document.preview_add_resume_entry,
    ),
    Tool(
        name="reorder_sections",
        description=(
            "调整简历板块的先后顺序。order 必须给出**全部**板块 key（或中文标题）的新顺序，"
            "顺序数组里缺板块或重复会报错。用户说「把项目经历放到工作经历前面」时用。"
            "写入前给差异预览，用户确认后才执行；不改任何条目内容。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "order": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "全部板块的新顺序（key 或标题），如 [education, experience, projects]",
                },
            },
            "required": ["resume_id", "order"],
        },
        handler=_tool_reorder_sections,
        service_entry=None,
        service_reason="经 assistant_tools.document_support 读写 v2 文档（内部唯一收口，无 services 符号）",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews_document.preview_reorder_sections,
    ),
    Tool(
        name="set_entry_layout",
        description=(
            "设置简历里**某一条条目**的条目级布局：head（split/stacked/meta_first）、"
            "columns（1/2/3）、align（equal/flow）、gap、start_on_new_page（该条另起一页）、"
            "keep_together（整条不跨页）。path 传条目路径，序号从 1 开始（如 education.1 或 education.<条目id>）。"
            "用户说「让这一条从新页开始」「这条别被拆到两页」时用。"
            "写入前给差异预览，用户确认后才执行；不改全局版式参数。"
        ),
        parameters={
            "type": "object",
            "properties": {
                "resume_id": {"type": "integer", "description": "简历 id"},
                "path": {"type": "string", "description": "条目路径，如 education.1"},
                "layout": {
                    "type": "object",
                    "description": "要改的条目布局项：head/columns/align/gap/start_on_new_page/keep_together",
                },
            },
            "required": ["resume_id", "path", "layout"],
        },
        handler=_tool_set_entry_layout,
        service_entry=None,
        service_reason="经 assistant_tools.document_support 读写 v2 文档（内部唯一收口，无 services 符号）",
        permission=ToolPermission.REVERSIBLE_WRITE,
        preview=previews_document.preview_set_entry_layout,
    ),
)
