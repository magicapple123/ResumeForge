# SPDX-License-Identifier: Apache-2.0
"""plan 的纯文本投影：布局对拍、文本等价与测试断言共用。

单独成模块的原因：`document_plan.py` 已贴 500 行预算，而本函数只读 plan、不参与任何布局
决策——留在原模块会让下一个人无法再往里加规则。`document_plan` 仍原样导出这个名字，
既有 `from .document_plan import plan_to_text` 的调用点无需改动。
"""

from __future__ import annotations

from ...schemas.resume_document import DocumentPlan
from .document_plan_format import plain_text


def plan_to_text(plan: DocumentPlan) -> list[str]:
    """plan 展平成纯文本行（文本等价/对拍/测试用；Markdown/TXT 不直接用这个）。"""
    lines: list[str] = []
    header = plan.header
    header_parts = [
        plain_text(header.name),
        plain_text(header.name_meta),
        plain_text(header.subtitle),
    ]
    header_parts.extend(plain_text(line) for line in header.contact_lines)
    lines.extend(part for part in header_parts if part.strip())
    for section in plan.sections:
        lines.append(section.title)
        for row in section.rows:
            lines.append(" ".join(plain_text(cell.segments) for cell in row))
        for entry in section.entries:
            head = [plain_text(entry.head.title), plain_text(entry.head.meta)]
            lines.extend(part for part in head if part.strip())
            for row in entry.lead_rows:
                lines.append(" ".join(plain_text(cell.segments) for cell in row))
            for block in entry.body:
                lines.append(plain_text(block.segments))
            for row in entry.trail_rows:
                lines.append(" ".join(plain_text(cell.segments) for cell in row))
    return [line for line in lines if line.strip()]
