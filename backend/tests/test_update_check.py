# SPDX-License-Identifier: Apache-2.0
"""更新说明（Release body）的按行截断。

为什么单独一个文件：`UpdateCheckResult.notes` 的 schema 上限正好是 4000，截断时多拼
一个字就会在构造结果那一刻抛 ValidationError，把整条「检查更新」变成 500。所以这里既
测「退到换行处」，也测「总长不超预算」和「恰好等于预算时不追加提示」。
"""

from app.services.update_check import (
    NOTES_BUDGET,
    NOTES_TRUNCATED_HINT,
    _truncate_notes,
    clear_cache,
)

# 每行 ~40 字符、共 300 行，总长明显超过预算，且行边界清晰便于断言。
_LINES = [
    f"第 {index:04d} 行：修复了一个具体问题，说明文字写在这里，方便看清从哪里断开。"
    for index in range(1, 301)
]


def test_short_notes_are_returned_untouched():
    text = "## 新增\n- **深挖** 模式支持从台账直出报告"

    assert _truncate_notes(text) == text
    # 没被截断就不该暗示用户「完整说明见发布页」。
    assert NOTES_TRUNCATED_HINT not in _truncate_notes(text)


def test_long_notes_break_at_a_line_boundary_and_point_at_the_release_page():
    text = "\n".join(_LINES)
    assert len(text) > NOTES_BUDGET

    result = _truncate_notes(text)

    assert result.endswith(NOTES_TRUNCATED_HINT)
    # 总长必须留在 schema 上限内，否则 UpdateCheckResult 构造即报错。
    assert len(result) <= NOTES_BUDGET
    body = result[: -len(NOTES_TRUNCATED_HINT)].rstrip()
    kept = body.split("\n")
    # 保留下来的每一行都是完整的原文行——没有半句话、也没有半行表格。
    assert all(line in _LINES for line in kept)
    # 没有在最前面几行就断掉：回退点不早于预算的 60%。
    assert len(body) > NOTES_BUDGET // 2


def test_exactly_the_budget_counts_as_not_truncated():
    text = "甲" * NOTES_BUDGET
    assert len(text) == NOTES_BUDGET

    result = _truncate_notes(text)

    assert result == text
    assert NOTES_TRUNCATED_HINT not in result


def test_one_giant_line_falls_back_to_a_hard_cut():
    # 整段没有换行时无处可退，只能硬截——但仍要补提示且不超预算。
    text = "乙" * (NOTES_BUDGET + 500)

    result = _truncate_notes(text)

    assert result.startswith("乙" * 400)
    assert result.endswith(NOTES_TRUNCATED_HINT)
    assert len(result) <= NOTES_BUDGET


def test_check_update_returns_truncated_notes_that_still_fit_the_schema(client, monkeypatch):
    # 端到端一遍：走真实的 check_for_update 与 schema 校验，确认拼了提示也不会超长。
    clear_cache()

    async def fake_release(_repo: str) -> dict:
        return {
            "tag_name": "v99.0.0",
            "name": "测试更新",
            "html_url": "https://github.com/example/ResumeForge/releases/tag/v99.0.0",
            "published_at": "2026-09-24T00:00:00Z",
            "body": "\n".join(_LINES),
            "assets": [],
        }

    monkeypatch.setattr("app.services.update_check._fetch_latest_release", fake_release)

    response = client.get("/api/update/check?refresh=true")

    assert response.status_code == 200
    notes = response.json()["notes"]
    assert notes.endswith(NOTES_TRUNCATED_HINT)
    assert len(notes) <= NOTES_BUDGET
