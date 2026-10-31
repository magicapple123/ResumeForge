# SPDX-License-Identifier: Apache-2.0
"""Read-only Markdown serialization of an interview report."""

from ...models.interview import InterviewSession
from .interview import answered_rounds


def _report_markdown(session: InterviewSession) -> str:
    """把面试记录与报告整理成一份 Markdown，存进资料箱当复盘材料。"""
    report = session.report or {}
    lines = [
        f"# {session.title or '模拟面试'}",
        "",
        f"- 面试类型：{session.interview_type}",
        f"- 难度：{session.difficulty}",
        f"- 面试官风格：{session.interviewer_style}",
        f"- 目标岗位：{session.job_title or '未关联'}"
        + (f" @ {session.company}" if session.company else ""),
        # 自动轮数模式：总轮数本来就不固定，如实记"自动收尾"（硬上限是实现细节，不进报告）。
        (
            f"- 问答轮数：{answered_rounds(session)} 轮（自动收尾）"
            if session.rounds_min is not None
            else f"- 问答轮数：{answered_rounds(session)} / {session.rounds}"
        ),
    ]
    if report.get("score"):
        lines.append(f"- 总评分：{report['score']}")
    lines.extend(["", "## 问答记录", ""])
    for item in session.messages:
        if item.role == "interviewer":
            lines.append(f"**面试官**：{item.content}")
        elif item.role == "user":
            lines.append(f"**我**：{item.content}")
        else:
            lines.append(f"（{item.content}）")
        lines.append("")
    if report.get("dimensions") or report.get("summary"):
        lines.extend(["## 评分报告", ""])
        for item in report.get("dimensions") or []:
            lines.append(
                f"- **{item.get('name')}**：{item.get('score')} 分 —— {item.get('comment', '')}"
            )
        if report.get("strengths"):
            lines.extend(["", "### 做得好", *[f"- {text}" for text in report["strengths"]]])
        if report.get("improvements"):
            lines.extend(["", "### 可以改进", *[f"- {text}" for text in report["improvements"]]])
        if report.get("summary"):
            lines.extend(["", f"> {report['summary']}"])
    return "\n".join(lines).rstrip() + "\n"
