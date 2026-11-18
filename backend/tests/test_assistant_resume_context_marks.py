# SPDX-License-Identifier: Apache-2.0
"""DF-6：发给助手的简历上下文不带行内样式标记。

前端只传 `resume_id`，真正拼进提示词的是这里的 `resume_context`——它把整份
`content` JSON 序列化给模型。若不剥离，模型看到的是 `{@color=#c0392b}个人项目{@}`，
既浪费 token，也会把标记抄回输出。

剥离必须复用 `strip_style_markers`（保守剥离）：未闭合 / 越界标记原样保留，
不能像前端展示层那样"猜错就吞字"。
"""

from __future__ import annotations

from app.models.resume import ResumeRecord
from app.services.assistant.assistant_context import resume_context


def _seed(db_session, content: dict, *, title: str = "增长运营简历") -> ResumeRecord:
    resume = ResumeRecord(title=title, job_title="增长运营", content=content)
    db_session.add(resume)
    db_session.commit()
    db_session.refresh(resume)
    return resume


def test_resume_context_strips_inline_style_markers_deeply(db_session) -> None:
    resume = _seed(
        db_session,
        {
            "header": {"items": [{"key": "name", "value": "{@size=1.5}张三{@}"}]},
            "sections": [
                {
                    "key": "projects",
                    "entries": [
                        {
                            "items": [
                                {
                                    "kind": "field",
                                    "key": "custom:ob_x",
                                    "value": "{@color=#c0392b}个人项目{@}",
                                },
                                {
                                    "kind": "text",
                                    "text": "带 {@size=0.9}8 人{@}团队",
                                },
                            ]
                        }
                    ],
                }
            ],
        },
        title="{@size=1.2}简历{@}",
    )

    context = resume_context(resume)

    assert "个人项目" in context
    assert "带 8 人团队" in context
    assert "张三" in context
    assert "{@color" not in context
    assert "{@size" not in context
    assert "{@}" not in context


def test_resume_context_keeps_unclosed_markers_and_markdown_bold(db_session) -> None:
    resume = _seed(
        db_session,
        {"summary": "{@size=0.9}未闭合与 **重点**", "note": "{@size=9}越界{@}"},
    )

    context = resume_context(resume)

    # 与后端 strip_style_markers 的退化口径一致：认不出来的不吞。
    assert "{@size=0.9}未闭合" in context
    assert "{@size=9}越界{@}" in context
    # `**` 是 Markdown 加粗，对模型是可读语义，不剥。
    assert "**重点**" in context


def test_resume_context_never_sends_photo(db_session) -> None:
    resume = _seed(db_session, {"photo": "data:image/png;base64,AAAA", "name": "张三"})

    context = resume_context(resume)

    assert "base64" not in context
    assert "张三" in context
