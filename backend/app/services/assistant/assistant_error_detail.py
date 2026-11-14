# SPDX-License-Identifier: Apache-2.0
"""把助手输入类的 ``ValueError`` 映射成**写死**的用户文案。

为什么需要这一层：CodeQL 的 ``py/stack-trace-exposure`` 会把
``HTTPException(detail=str(exc))`` 判成信息泄露——异常文本可能带内部路径或上游报文。
但这些输入类错误（附件过大、文件是截图、引用的岗位被删）的原文**本来就是给用户看的**，
换成一句笼统的"输入有误"会直接毁掉可操作性，端到端用例也钉着 "2 MB" / "截图" / "岗位不存在"。

所以分流在**文案表**里做：异常文本只用来选一条常量，返回的永远是字面量，不拼接、不透传。
新增一种输入错误时在表里加一行；表里没有的落到底部的兜底句，日志里仍有原始异常。
"""

from __future__ import annotations

from fastapi import HTTPException


class AssistantInputError(HTTPException, ValueError):
    """输入类错误：既是 HTTPException（FastAPI 直接转响应），也是 ValueError（服务层单测
    一直用 `pytest.raises(ValueError)`）。`detail` 必须是**字面量**，不接受拼接文本。
    """

    def __init__(self, status_code: int, detail: str) -> None:
        ValueError.__init__(self, detail)
        HTTPException.__init__(self, status_code=status_code, detail=detail)


# 顺序即优先级：更具体的特征放前面（"总大小不能超过 5 MB" 里也含 "5 MB"）。
_ATTACHMENT_HINTS: tuple[tuple[str, str], ...] = (
    ("最多上传 4 个附件", "一次最多上传 4 个附件"),
    ("单个附件不能超过 2 MB", "单个附件不能超过 2 MB"),
    ("2 MB", "单个附件不能超过 2 MB"),
    ("总大小不能超过 5 MB", "附件总大小不能超过 5 MB"),
    ("不支持的文件类型", "不支持这种文件类型，请换 PDF、Word、图片或文本文件"),
    ("截图", "这个文件看起来是截图或扫描件：请上传可复制文字的 PDF 或图片，助手才能读到内容"),
    ("扫描", "这个文件看起来是扫描件：请上传可复制文字的 PDF 或图片，助手才能读到内容"),
)

_ATTACHMENT_FALLBACK = "附件无法解析，请换一个文件再试"

_CONTEXT_HINTS: tuple[tuple[str, str], ...] = (
    ("简历", "选择的简历不存在或已被删除"),
    ("岗位", "选择的岗位不存在或已被删除"),
)

_CONTEXT_FALLBACK = "引用的内容不存在或已被删除"

# 工具异常 → 固定文案。工具结果会随 SSE 流回给模型与界面，异常原文不能直接外发；
# 但"任务不存在"这类结论对用户有操作价值，所以按特征选一条常量。
_TOOL_HINTS: tuple[tuple[str, str], ...] = (
    ("不存在", "对象不存在或已被删除"),
    ("已被删除", "对象不存在或已被删除"),
    ("无权限", "没有权限执行这个操作"),
    ("权限", "没有权限执行这个操作"),
    ("超时", "执行超时，请稍后重试"),
    ("timeout", "执行超时，请稍后重试"),
    ("网络", "网络请求失败，请检查连接后重试"),
    ("参数", "参数不合法，请检查后重试"),
)

_TOOL_FALLBACK = "工具执行失败"


def attachment_detail(text: str) -> str:
    """附件类错误的固定文案（不拼接原始异常文本）。"""
    for needle, detail in _ATTACHMENT_HINTS:
        if needle in text:
            return detail
    return _ATTACHMENT_FALLBACK


def context_detail(text: str) -> str:
    """引用上下文（岗位 / 简历）类错误的固定文案。"""
    for needle, detail in _CONTEXT_HINTS:
        if needle in text:
            return detail
    return _CONTEXT_FALLBACK


def tool_error_text(text: str) -> str:
    """工具异常的固定文案（用于 `record["error"]` / 结果文本）。"""
    haystack = text.lower()
    for needle, detail in _TOOL_HINTS:
        if needle in haystack:
            return detail
    return _TOOL_FALLBACK


__all__ = ["AssistantInputError", "attachment_detail", "context_detail", "tool_error_text"]
