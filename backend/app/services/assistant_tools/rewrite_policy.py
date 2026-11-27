# SPDX-License-Identifier: Apache-2.0
"""T35 助手侧的「整篇重写」策略：在工具层挡住整份简历写入，把请求引导到块编辑。

产品约定（`memory/issues-2026-11-26.md` 护栏 2）：助手对外部简历**只读分析**，任何
改写都落到块编辑（另存新版本）；内部简历也只能**逐块**写——用户逐块确认、改动可撤销、
有历史版本。助手若产出一份"重写好的整篇简历"，用户只剩两个选择：整篇替换（丢掉自己
写的句子，且无法只回退某一段）或手动搬运。所以拒答不是"不支持改写"，而是"换一种粒度"。

判定只看**工具调用形态**，不猜自然语言：请求说法可以千变万化（整篇重写 / 全部润色 /
帮我改一版），真正能造成整份覆盖的调用形状是可数的：

1. 写工具指向外部简历（``resume_ref=external:*``）——外部简历对助手只读；
2. 调用里带整份文档载荷（``content`` / ``document`` / ``sections`` …）；
3. ``update_resume_field`` 的 ``path`` 指向整块或整份，而不是一个字段；
4. ``value`` 是一整份文档对象，而不是字段值；
5. ``task_create`` 的 ``resume_batch_edit`` 没指定板块（等价于全部条目）。

执行层有两处调用本模块：``_registry._ensure_allowed``（同步/异步入口，也覆盖用户批准
提案后的真实执行）与 ``assistant_tool_exec.run_tool_call``（生成确认提案之前）。后者
保证"整篇重写"连提案卡都不会出现，前者是兜底。

新增写简历的工具时必须登记到 :data:`RESUME_WRITE_SCOPES`；守卫测试
``tests/test_assistant_rewrite_policy.py`` 会拒绝"未登记的简历写工具"与"声明整份写入
的工具"，所以这个口子不会被悄悄打开。
"""

from __future__ import annotations

from collections.abc import Iterable
from typing import Any

#: 写入粒度 = 整份文档（唯一被拒绝的粒度）。
DOCUMENT_SCOPE = "document"

#: 「整份简历内容」的载荷键。任何带简历身份的调用只要出现这些键，就是一次整份写入。
WHOLE_DOCUMENT_KEYS = frozenset(
    {
        "content",
        "document",
        "doc",
        "sections",
        "resume_content",
        "content_json",
        "document_json",
        "full_text",
    }
)

#: 简历身份键：只认这两个。外部简历的 ``file_id`` / ``name`` 不算（它们也出现在只读工具里）。
RESUME_IDENTITY_KEYS = ("resume_id", "resume_ref")

#: ``path`` 写成这些值 = 指向整份文档，而不是一个字段。
DOCUMENT_PATHS = frozenset(
    {"", "*", "/", ".", "document", "resume", "root", "content", "sections", "all"}
)

#: 「一次只能改一个字段」的工具：``path`` 必须落到 ``<section>.<entry>.<field>``。
FIELD_WRITE_TOOLS = frozenset({"update_resume_field"})

#: 批量改写工具与类型（``section`` 为空 = 所有条目 = 整份）。
BATCH_TOOL = "task_create"
BATCH_KIND = "resume_batch_edit"

#: 注册表里所有会写简历内容的工具及其粒度。``document`` 不允许出现——谁加一个整篇写工具，
#: 守卫测试会先把这里拦下来，要求改成逐块设计。
RESUME_WRITE_SCOPES: dict[str, str] = {
    "update_resume_field": "field",
    "add_resume_entry": "entry",
    "set_entry_layout": "layout",
    "reorder_sections": "layout",
    "update_resume_layout": "layout",
    "update_resume": "metadata",
    "task_create": "section_batch",
}

#: 拒绝原因的分类（机器可读），文案见 :data:`REASON_LABELS`。
EXTERNAL_READ_ONLY = "external_resume_is_read_only"
WHOLE_DOCUMENT_PAYLOAD = "whole_document_payload"
DOCUMENT_PATH = "document_path"
WHOLE_DOCUMENT_VALUE = "whole_document_value"
WHOLE_RESUME_BATCH = "whole_resume_batch"

REASON_LABELS = {
    EXTERNAL_READ_ONLY: "助手对外部简历只读，写入必须走外部简历的块编辑",
    WHOLE_DOCUMENT_PAYLOAD: "调用里带了整份文档载荷（content/document/sections）",
    DOCUMENT_PATH: "path 指向整块或整份，而不是一个字段",
    WHOLE_DOCUMENT_VALUE: "要写的是一整份文档对象，而不是一个字段值",
    WHOLE_RESUME_BATCH: "resume_batch_edit 没指定板块（等于重写全部条目）",
}


def path_scope(path: object) -> str:
    """把内容路径换算成写入粒度：``field`` / ``entry`` / ``section`` / ``document``。

    只做**字符串形态**判断，不读文档：``header.name`` 是无条目板块里的字段（两段），
    ``education.1.gpa`` 是条目字段（三段），``education.1`` 是整条，``education`` 是
    整个板块。具体路径是否存在由 handler 负责，这里只回答"是不是一个字段"。
    """
    text = str(path or "").strip()
    if text.lower() in DOCUMENT_PATHS:
        return DOCUMENT_SCOPE
    parts = [part for part in text.split(".") if part]
    if not parts:
        return DOCUMENT_SCOPE
    if parts[0] == "header":
        return "field" if len(parts) >= 2 else "section"
    if len(parts) >= 3:
        return "field"
    if len(parts) == 2:
        return "entry"
    return "section"


def _tool_writes(name: str) -> bool:
    """``name`` 是否写库（未知工具返回 False，交给授权层拒绝）。"""
    from ._registry import tool_writes  # 函数级导入：_registry 顶层导入本模块，避免环。

    return tool_writes(name)


def _is_external_ref(value: object) -> bool:
    text = str(value or "").strip().lower()
    return text.startswith(("external:", "e:"))


def _has_resume_identity(arguments: dict[str, Any]) -> bool:
    if arguments.get("resume_id") is not None:
        return True
    return bool(str(arguments.get("resume_ref") or "").strip())


def _looks_like_document_value(value: object) -> bool:
    """字段写入的 ``value`` 是不是整份文档（对象 / 对象数组）。"""
    if isinstance(value, dict):
        return True
    if isinstance(value, (list, tuple)):
        return any(isinstance(item, dict) for item in value)
    return False


#: ``section`` 写成这些值 = 没有指定一个具体板块（等价于整份）。
WHOLE_SECTION_VALUES = frozenset({"", "*", "all", "document", "resume", "全部", "整篇"})


def _is_whole_resume_batch(arguments: dict[str, Any]) -> bool:
    params = arguments.get("params")
    params = params if isinstance(params, dict) else {}
    kind = str(params.get("kind") or arguments.get("kind") or "").strip()
    if kind != BATCH_KIND:
        return False
    return str(params.get("section") or "").strip().lower() in WHOLE_SECTION_VALUES


def block_reasons(name: str, arguments: dict[str, Any] | None) -> tuple[str, ...]:
    """这次工具调用命中了哪些「整篇」形态；空元组 = 放行。纯函数。"""
    args = arguments if isinstance(arguments, dict) else {}
    reasons: list[str] = []

    if _is_external_ref(args.get("resume_ref")) and _tool_writes(name):
        reasons.append(EXTERNAL_READ_ONLY)

    if (_has_resume_identity(args) or name in RESUME_WRITE_SCOPES) and any(
        key in args for key in WHOLE_DOCUMENT_KEYS
    ):
        reasons.append(WHOLE_DOCUMENT_PAYLOAD)

    if name in FIELD_WRITE_TOOLS:
        if "path" in args and path_scope(args.get("path")) != "field":
            reasons.append(DOCUMENT_PATH)
        if _looks_like_document_value(args.get("value")):
            reasons.append(WHOLE_DOCUMENT_VALUE)

    if name == BATCH_TOOL and _is_whole_resume_batch(args):
        reasons.append(WHOLE_RESUME_BATCH)

    return tuple(dict.fromkeys(reasons))


def is_whole_resume_rewrite(name: str, arguments: dict[str, Any] | None) -> bool:
    """这次工具调用是否在要求"整篇重写/整份写入"。"""
    return bool(block_reasons(name, arguments))


def _target_hint(arguments: dict[str, Any]) -> str:
    """拒绝文案里的"这次指向"（能定位到哪份简历 / 哪一块时带上，避免空泛拒答）。"""
    bits: list[str] = []
    ref = str(arguments.get("resume_ref") or "").strip()
    if ref:
        bits.append(f"resume_ref={ref}")
    if arguments.get("resume_id") is not None:
        bits.append(f"resume_id={arguments['resume_id']}")
    if arguments.get("path"):
        bits.append(f"path={arguments['path']}")
    if arguments.get("section"):
        bits.append(f"section={arguments['section']}")
    params = arguments.get("params")
    if isinstance(params, dict) and params.get("section"):
        bits.append(f"section={params['section']}")
    return f"（这次指向：{'、'.join(bits)}）" if bits else ""


def build_refusal(name: str, arguments: dict[str, Any] | None) -> str | None:
    """给模型看的拒绝说明；``None`` 表示放行。

    文案必须包含**怎么做才有效**：指向块编辑的具体工具与路径粒度，而不是一句"不支持"。
    """
    reasons = block_reasons(name, arguments)
    if not reasons:
        return None
    args = arguments if isinstance(arguments, dict) else {}
    labels = "；".join(REASON_LABELS.get(reason, reason) for reason in reasons)
    return (
        f"这次调用被策略拒绝：{name} 在要求「整篇重写简历」{_target_hint(args)}"
        f"（{labels}），没有执行，简历一个字节都没变。\n"
        "助手不产出、也不落库“整份重写好的简历”——那样用户只能整篇替换，会丢掉自己写的"
        "句子，也没法只回退某一块。怎么做才有效（逐块编辑）：\n"
        "1. 先定位要改的块：内部简历用 get_resume 看板块与条目，再用 get_entry 读单条字段"
        "（path 形如 education.1.gpa）；外部简历直接用上下文里的 text，按段落指出问题。\n"
        "2. 一次只改一块：update_resume_field 改一个字段、add_resume_entry 追加一条、"
        "set_entry_layout 只调布局；每次先给 before/after，由用户在确认卡上逐条确认，"
        "执行前自动留撤销版本。\n"
        '3. 要批量：task_create(kind="resume_batch_edit", params={"resume_id": …, '
        '"section": "projects", "instruction": "…"}) 一次只指定一个板块，'
        "不要用空 section 重写整份。\n"
        "4. 只给建议也算交付：说清“哪一块、为什么、改成什么”，用户在制作台或外部简历"
        "「编辑」页的块编辑里自己应用。\n"
        "请改为逐块调用（一次 1 个字段或 1 条条目），不要重试整篇写入。"
    )


def declares_whole_document_write(tool: Any) -> bool:
    """工具声明本身是不是"写整份简历"的形状（守卫用，也用于执行层的提前拒绝）。

    判据是**声明里的参数名**：写工具同时接受简历身份与整份载荷键，就意味着它可以被
    一次调用喂进一整份文档。当前注册表里应当没有任何这样的工具。
    """
    if not getattr(tool, "writes", False):
        return False
    properties = ((getattr(tool, "parameters", None) or {}).get("properties")) or {}
    if not any(key in properties for key in RESUME_IDENTITY_KEYS):
        return False
    return any(key in properties for key in WHOLE_DOCUMENT_KEYS)


def unclassified_resume_write_tools(tools: Iterable[Any]) -> list[str]:
    """没有登记写入粒度的简历写工具名（守卫用）。

    判据：写权限 + 工具名里带 ``resume``。带 ``resume_id`` 但只"引用"简历的工具
    （求职进度、提醒）不在此列——它们不改简历正文，不该逼着登记一个假粒度；而只靠
    参数名藏起来的新工具会先被 :func:`declares_whole_document_write` 抓住。
    新工具必须登记到 :data:`RESUME_WRITE_SCOPES` 并选择逐块粒度，否则这里会点名。
    """
    missing: list[str] = []
    for tool in tools:
        if not getattr(tool, "writes", False):
            continue
        name = str(getattr(tool, "name", ""))
        if "resume" in name.lower() and name not in RESUME_WRITE_SCOPES:
            missing.append(name)
    return missing


__all__ = [
    "BATCH_KIND",
    "BATCH_TOOL",
    "DOCUMENT_PATHS",
    "DOCUMENT_SCOPE",
    "EXTERNAL_READ_ONLY",
    "FIELD_WRITE_TOOLS",
    "REASON_LABELS",
    "RESUME_IDENTITY_KEYS",
    "RESUME_WRITE_SCOPES",
    "WHOLE_DOCUMENT_KEYS",
    "WHOLE_DOCUMENT_PAYLOAD",
    "WHOLE_DOCUMENT_VALUE",
    "WHOLE_RESUME_BATCH",
    "block_reasons",
    "build_refusal",
    "declares_whole_document_write",
    "is_whole_resume_rewrite",
    "path_scope",
    "unclassified_resume_write_tools",
]
