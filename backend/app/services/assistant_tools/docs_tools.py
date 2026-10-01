"""求职助手的本地产品文档工具。"""

from sqlalchemy.orm import Session

from ..assistant_docs import format_product_doc_results
from ._types import ToolResult


def _tool_search_product_docs(_db: Session, arguments: dict) -> ToolResult:
    query = str(arguments.get("query") or "").strip()
    if not query:
        raise ValueError("需要提供要查找的简历通问题")
    limit = int(arguments.get("limit") or 5)
    return ToolResult(
        text=format_product_doc_results(query, limit),
        summary=f"查阅了简历通本地文档「{query[:40]}」",
    )

