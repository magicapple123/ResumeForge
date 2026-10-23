# SPDX-License-Identifier: Apache-2.0
"""纯文本（.txt）简历导出：复用 ``export_markdown`` 的正文结构，去掉 Markdown 标记。

纯文本没有页边距 / 字号 / 分页这些概念，所以它**只关心内容**：标题、区块、条目与
列表的顺序和文案必须和 Markdown 完全一致（同一份简历多个输出不该说得不一样），只是
把 ``#`` / ``-`` / ``**`` 这类排版标记拿掉。照片与其它文本导出一样**不包含**——内嵌
data URL 放进纯文本没有意义。

这是 ``FORMAT_RENDERERS`` 里的一个格式渲染器，不新增任何版式口径。
"""

from __future__ import annotations

import re

from ..schemas.resume import ResumeContent
from .exporter import export_markdown
from .resume.resume_labels import DEFAULT_RESUME_LANGUAGE
from .resume.resume_rich_text import strip_markers

# 无序列表项的前缀（`export_markdown` 用 `- ` 连接条目）。
_BULLET_RE = re.compile(r"^\s*-\s+")
# 标题层级前缀（`# ` / `## ` / `### `）。
_HEADING_RE = re.compile(r"^#{1,6}\s*")


def strip_markdown(text: str) -> str:
    """去掉 Markdown 排版标记，保留正文结构。

    只移除标题 / 列表 / 行内加粗三类标记，不重排段落、不改文案；空行保留下来作为
    区块之间的视觉分隔。这样纯文本输出与 Markdown 输出**逐字同源**，差异仅在于标记。

    加粗走 ``strip_markers`` 而不是 ``text.replace("**", "")``：后者会把用户**没有配对**
    的 ``**``（他真想印出来的星号）一起吞掉。纯文本是投递用的最终产物，静默吞字符是
    最难解释的一类 bug。
    """
    lines: list[str] = []
    for raw_line in text.splitlines():
        line = raw_line.rstrip()
        line = _HEADING_RE.sub("", line)
        line = _BULLET_RE.sub("", line)
        line = strip_markers(line)
        lines.append(line)
    return "\n".join(lines)


def export_txt(
    resume: ResumeContent,
    *,
    section_order: list[str] | None = None,
    language: str = DEFAULT_RESUME_LANGUAGE,
) -> str:
    """把结构化简历渲染成纯文本。

    直接复用 ``export_markdown`` 生成正文，再剥离标记——保证七个分区的标题、顺序与
    每个字段的文案都和 Markdown 同源（``resume_labels.section_titles`` 是唯一来源）。
    分区顺序由 ``section_order`` 决定（用户的版式设置），不传则用默认顺序。

    ``language`` 原样透传给 ``export_markdown``：纯文本的**标题与 Markdown 同源**，
    不自己判语言、也不自己存文案——否则同一份简历的 .md 与 .txt 会印出两种标题。
    """
    return strip_markdown(export_markdown(resume, section_order=section_order, language=language))


__all__ = ["export_txt", "strip_markdown"]
