# SPDX-License-Identifier: Apache-2.0
"""#15F 对话式投递军师：投递队列的三个助手工具（``queue_list`` 只读 /
``queue_update_priority`` 可撤销写 / ``apply_start`` 是**全项目唯一**
``EXTERNAL_SIDE_EFFECT``，用户拍板的例外）。

分组见下面的 ``# ===== N.`` 小标题。``apply_start`` 的三条硬约束都要钉住：描述里写死
「不可撤销 + 明确确认」，权限级别永远走提案（``write_full`` 也不行），未确认时 ``run``
一次都不跑。
"""

from __future__ import annotations

import ast
import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.database import SessionLocal
from app.models.apply import (
    QUEUE_STATUS_DONE,
    QUEUE_STATUS_PENDING,
    ApplyQueueItem,
    ApplyTask,
)
from app.models.job import JOB_STATUS_OPEN, Job
from app.runtime import dataset_scope
from app.services.actions import ActionError, get_action
from app.services.apply import _queue as queue_service
from app.services.apply import _tasks as apply_tasks
from app.services.assistant.assistant_tool_exec import run_tool_call
from app.services.assistant_tools import _TOOLS, execute_tool, get_tool, proposal_store
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools._types import ToolPermission
from app.services.assistant_tools.policy import ToolExecutionContext

# 工具名 → (期望权限级别, 期望服务入口)。改级别必须同批改 tests/test_assistant_tool_permissions.py。
_EXPECTED = {
    "queue_list": (ToolPermission.READ_ONLY, "apply._queue.list_queue"),
    "queue_update_priority": (ToolPermission.REVERSIBLE_WRITE, "apply._queue.reorder_queue"),
    "apply_start": (ToolPermission.EXTERNAL_SIDE_EFFECT, "apply._tasks.create_apply_task"),
}


@pytest.fixture(autouse=True)
def _clean_proposals():
    """提案是进程级存储：每个用例从干净状态开始，避免上一个用例的提案串味。"""
    proposal_store.reset_store()
    yield
    proposal_store.reset_store()


def _job(db, *, title: str = "后端开发", company: str = "A公司") -> Job:
    job = Job(
        title=title,
        company=company,
        source="BOSS直聘",
        source_url=f"https://www.zhipin.com/job/{abs(hash(title)) % 100000}",
        status=JOB_STATUS_OPEN,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def _queue_item(
    db,
    job: Job,
    *,
    status: str = QUEUE_STATUS_PENDING,
    sort_order: int = 0,
) -> ApplyQueueItem:
    item = ApplyQueueItem(
        job_id=job.id,
        job_title=job.title,
        company=job.company,
        sort_order=sort_order,
        status=status,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _ctx(writable: bool) -> ToolExecutionContext:
    return ToolExecutionContext(
        dataset_id=dataset_scope.current_dataset_id(),
        dataset_generation=dataset_scope.current_generation(),
        web_search=False,
        fetch_pages=0,
        relaxed=False,
        writable=writable,
    )


def _tool_call(name: str, arguments: dict) -> dict:
    return {"id": "call_apply_1", "function": {"name": name, "arguments": json.dumps(arguments)}}


# ===== 1. 注册与权限 =====


def test_three_tools_are_registered_as_tool_only_actions():
    tools = {tool.name: tool for tool in _TOOLS}
    for name, (permission, service_entry) in _EXPECTED.items():
        tool = tools[name]
        assert tool.permission is permission, f"{name} 的权限级别漂了"
        assert tool.writes is permission.is_write
        assert tool.service_entry == service_entry
        action = get_action(name)
        assert action is not None, f"{name} 没有注册成 action"
        assert action.permission is permission
        # 工具专属动作：队列的读/改已有既有路由，这三条没有等价 HTTP 入口。
        assert action.http is None
    # 只读工具不挂预览；两个写工具必须有（未确认时执行层只跑预览）。
    assert tools["queue_list"].preview is None
    assert tools["queue_update_priority"].preview is not None
    assert tools["apply_start"].preview is not None


def test_apply_start_description_pins_the_hard_constraint():
    """工具描述里必须写死"会真实提交 / 不可撤销 / 仅在确认后调用 / 不要批量海投"。"""
    description = get_tool("apply_start").description
    for fragment in ("不可撤销", "明确确认", "不要替用户批量海投", "待投递"):
        assert fragment in description, f"apply_start 的描述缺少「{fragment}」"


_APPLY_SURFACE_TOOLS = ("apply_start", "list_apply_queue", "list_apply_records")
# 这些句式否认助手真实具备的投递能力（能力有，只是要先过提案卡）；工具 description 与
# assistant_system.md 的投递台行都会逐字进每一轮提示词，模型照说，所以一起钉住。
_FORBIDDEN_DENIALS = ("不代为", "助手不", "不能投递", "仍需用户在投递台")
_APPLY_ACTIONS_SRC = "app/services/actions/domains/apply.py"
_APPLY_TOOLS_SRC = "app/services/assistant_tools/apply_tools.py"


def _literals_outside_docstrings(path: Path) -> list[str]:
    """取模块里的字符串字面量，**跳过 docstring**。

    docstring 里允许出现这些字样：那是"不得出现否认句式"的禁令本身（见
    ``assistant_tools/apply_tools.py`` 的模块说明），不是对外文案。
    """
    tree = ast.parse(path.read_text(encoding="utf-8"))
    docstrings = {
        id(statement.value)
        for node in ast.walk(tree)
        for statement in getattr(node, "body", [])[:1]
        if isinstance(statement, ast.Expr)
        and isinstance(statement.value, ast.Constant)
        and isinstance(statement.value.value, str)
    }
    return [
        node.value
        for node in ast.walk(tree)
        if isinstance(node, ast.Constant)
        and isinstance(node.value, str)
        and id(node) not in docstrings
    ]


def test_tool_surfaces_never_deny_apply_capability():
    """投递工具的 description 与提示词「投递台」行，都不许否认助手的投递能力。

    为什么单独扫一遍：这几句是**工具描述**，由 actions 域构建器拼出来、运行时随
    ``tools`` 一起进每一轮请求，静态提示词守卫（``test_assistant_prompt_surface``）
    **扫不到它**。历史事故就在这儿：``list_apply_queue`` 写「助手不代为发起投递」，
    ``list_apply_records`` 写「重投要在投递台上操作，助手不代为投递」——模型读到就照着说，
    把 ``apply_start``（真实存在、只是要过提案卡、且不可撤销）说成"做不到"。
    提示词那边同理：只扫 ``assistant_system.md`` 的投递台行（别扫全文——其余段有正常表述）。
    """
    tools = {name: get_tool(name) for name in _APPLY_SURFACE_TOOLS}
    assert all(tools.values()), (
        f"投递工具没注册：{[n for n, tool in tools.items() if tool is None]}"
    )
    surfaces = {name: tool.description for name, tool in tools.items()}
    for name, description in surfaces.items():
        for phrase in _FORBIDDEN_DENIALS:
            assert phrase not in description, f"{name} 否认句式「{phrase}」：{description}"
    # 否认句式删掉之后，真实边界必须还在（否则等于悄悄放开了副作用工具）。
    for name in ("list_apply_queue", "list_apply_records"):
        assert "提案卡确认" in surfaces[name], f"{name} 的描述丢了「提案卡确认」"
        assert "不可撤销" in surfaces[name], f"{name} 的描述丢了「不可撤销」"
    # 兜底：工具注册表取不到描述或被裁剪时，源码字符串里也不许出现否认句式。
    root = Path(__file__).resolve().parents[1]
    for relative in (_APPLY_ACTIONS_SRC, _APPLY_TOOLS_SRC):
        for literal in _literals_outside_docstrings(root / relative):
            assert not [p for p in _FORBIDDEN_DENIALS if p in literal], f"{relative}：{literal}"
    prompt_md = (root / "app" / "prompts" / "assistant_system.md").read_text(encoding="utf-8")
    apply_line = next(line for line in prompt_md.splitlines() if line.startswith("- 投递台"))
    assert not (hits := [p for p in _FORBIDDEN_DENIALS if p in apply_line]), (
        f"投递台行否认句式{hits}"
    )
    assert "未经确认的投递不会执行" in apply_line, f"投递台行丢了「未确认不执行」：{apply_line}"


def test_apply_start_always_goes_through_a_proposal():
    """write_full（writable=True）下仍然只生成提案：外部副作用不接受"这次都允许"。"""
    assert "apply_start" in tool_policy.ALWAYS_PROPOSAL_TOOLS
    assert tool_policy.requires_proposal("apply_start", writable=True) is True
    assert tool_policy.requires_proposal("apply_start", writable=False) is True
    # 可逆的队列重排不是"永远走提案"：用户在完全权限下可以直接排序。
    assert tool_policy.requires_proposal("queue_update_priority", writable=True) is False


# ===== 2. queue_list =====


def test_queue_list_returns_the_queue_with_ids(db_session):
    first = _queue_item(
        db_session, _job(db_session, title="后端开发", company="A公司"), sort_order=1
    )
    second = _queue_item(
        db_session, _job(db_session, title="前端开发", company="B公司"), sort_order=2
    )

    result = execute_tool(db_session, "queue_list", {})

    assert result.summary == "查看了 2 条队列"
    assert result.link == "/apply"
    payload = json.loads(result.text)
    assert payload["返回"] == 2
    # list_queue 的既有口径：sort_order 大的排前面（后导入的排最上）。
    assert [row["队列条目id"] for row in payload["投递队列"]] == [second.id, first.id]
    assert payload["投递队列"][0]["岗位"] == "前端开发"


@pytest.mark.parametrize(
    ("arguments", "expected_titles"),
    [
        ({"status": "pending"}, ["前端开发", "后端开发"]),
        ({"status": "done"}, ["数据分析"]),
        ({"keyword": "b公司"}, ["前端开发"]),
        ({"keyword": "数据"}, ["数据分析"]),
        ({"status": "pending", "keyword": "后端"}, ["后端开发"]),
        ({"status": "done", "keyword": "后端"}, []),
    ],
)
def test_queue_list_filters_by_status_and_keyword(db_session, arguments, expected_titles):
    _queue_item(db_session, _job(db_session, title="后端开发", company="A公司"), sort_order=1)
    _queue_item(db_session, _job(db_session, title="前端开发", company="B公司"), sort_order=2)
    _queue_item(
        db_session,
        _job(db_session, title="数据分析", company="C公司"),
        status=QUEUE_STATUS_DONE,
        sort_order=3,
    )

    result = execute_tool(db_session, "queue_list", arguments)

    payload = json.loads(result.text)
    assert [row["岗位"] for row in payload["投递队列"]] == expected_titles
    assert payload["返回"] == len(expected_titles)
    assert result.summary == f"查看了 {len(expected_titles)} 条队列"


def test_queue_list_truncates_to_limit_but_reports_match_total(db_session):
    for index in range(5):
        _queue_item(
            db_session,
            _job(db_session, title=f"岗位{index}", company="A公司"),
            sort_order=index + 1,
        )

    result = execute_tool(db_session, "queue_list", {"limit": 2})

    payload = json.loads(result.text)
    assert payload["返回"] == 2
    assert payload["匹配总数"] == 5
    assert len(payload["投递队列"]) == 2


# ===== 3. queue_update_priority =====


def test_queue_update_priority_calls_reorder_and_changes_the_order(db_session, monkeypatch):
    a = _queue_item(db_session, _job(db_session, title="岗位A", company="A公司"), sort_order=1)
    b = _queue_item(db_session, _job(db_session, title="岗位B", company="B公司"), sort_order=2)
    real_reorder = queue_service.reorder_queue
    calls: list[list[int]] = []

    def spy(db, order):
        calls.append(list(order))
        return real_reorder(db, order)

    monkeypatch.setattr(queue_service, "reorder_queue", spy)

    result = execute_tool(db_session, "queue_update_priority", {"order": [b.id, a.id]})

    assert calls == [[b.id, a.id]], "queue_update_priority 必须委托既有 reorder_queue"
    assert result.changed is True
    assert result.summary == "调整了 2 条队列的优先级"
    # 顺序真的生效：列表最前面是 b（用户排在第一位的那条）。
    assert [row.id for row in queue_service.list_queue(db_session)][:2] == [b.id, a.id]


def test_queue_update_priority_rejects_empty_order(db_session, monkeypatch):
    called: list[list[int]] = []
    monkeypatch.setattr(queue_service, "reorder_queue", lambda db, order: called.append(order))

    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "queue_update_priority", {"order": []})

    assert excinfo.value.code == "invalid_input"
    assert called == [], "参数不合法时不能先改库再报错"


def test_queue_update_priority_rejects_duplicate_ids(db_session, monkeypatch):
    item = _queue_item(db_session, _job(db_session), sort_order=1)
    called: list[list[int]] = []
    monkeypatch.setattr(queue_service, "reorder_queue", lambda db, order: called.append(order))

    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "queue_update_priority", {"order": [item.id, item.id]})

    assert excinfo.value.code == "invalid_input"
    assert "重复" in str(excinfo.value)
    assert called == []


def test_queue_update_priority_rejects_unknown_ids(db_session):
    item = _queue_item(db_session, _job(db_session), sort_order=1)

    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "queue_update_priority", {"order": [item.id, item.id + 999]})

    assert excinfo.value.code == "invalid_input"
    assert str(item.id + 999) in str(excinfo.value)


def test_queue_update_priority_preview_states_target_and_scope(db_session):
    preview = get_tool("queue_update_priority").preview(db_session, {"order": [3, 1, 2]})

    assert preview.target == "调整投递队列顺序"
    assert preview.scope == "重排 3 条"
    assert preview.changes == []


# ===== 4. apply_start：拒绝面 =====


def test_apply_start_rejects_empty_or_missing_ids(db_session):
    """空列表与漏传都是 422：``queue_ids`` 是必填参数，没有"空批次"这条路可走。"""
    assert get_tool("apply_start").parameters["required"] == ["queue_ids"]

    with pytest.raises(ActionError) as empty:
        execute_tool(db_session, "apply_start", {"queue_ids": []})
    assert empty.value.code == "invalid_input"

    with pytest.raises(ActionError) as missing:
        execute_tool(db_session, "apply_start", {})
    assert missing.value.code == "invalid_input"
    assert "queue_ids" in str(missing.value)


def test_apply_start_rejects_too_many_ids(db_session):
    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "apply_start", {"queue_ids": list(range(1, 52))})

    assert excinfo.value.code == "invalid_input"
    assert "50" in str(excinfo.value)


def test_apply_start_rejects_unknown_ids(db_session):
    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "apply_start", {"queue_ids": [424242]})

    assert excinfo.value.code == "not_found"


@pytest.mark.parametrize("status", [QUEUE_STATUS_DONE, "skipped"])
def test_apply_start_rejects_non_pending_items(db_session, status):
    """只有待投递的条目能开始投递：已投递 / 已移出都是状态冲突，不是参数写错。"""
    item = _queue_item(db_session, _job(db_session), status=status, sort_order=1)

    with pytest.raises(ActionError) as excinfo:
        execute_tool(db_session, "apply_start", {"queue_ids": [item.id]})

    assert excinfo.value.code == "conflict"
    assert db_session.query(ApplyTask).count() == 0


# ===== 5. apply_start：成功面（唯一副作用 + 不可撤销）=====


def test_apply_start_passes_job_ids_to_create_apply_task(db_session, monkeypatch):
    """合法 ids → create_apply_task 收到的 job_ids/use_queue 正确；不真起 runner。

    **两套 id 必须先错开**：队列条目 id 与岗位 id 是两个独立自增序列，如果两边都从 1
    开始（本 fixture 不垫数据时就是这样），``[b.job_id, a.job_id]`` 与 ``[b.id, a.id]``
    恒等——"拿队列条目 id 当 job id 提交"这种最危险的退化就抓不到。所以先建两条占位岗位，
    让岗位 id 从 3 起、队列条目 id 仍从 1 起，再用前置断言把这件事钉死。
    """
    # 占位岗位：只为把两套 id 错开（它们不进队列，也不参与任何断言）。
    _job(db_session, title="占位岗位1", company="占位公司1")
    _job(db_session, title="占位岗位2", company="占位公司2")
    a = _queue_item(db_session, _job(db_session, title="岗位A"), sort_order=1)
    b = _queue_item(db_session, _job(db_session, title="岗位B", company="B公司"), sort_order=2)
    # 前置断言：错不开就说明本用例的映射断言退化成了同义反复，直接红。
    assert a.id != a.job_id, "队列条目 id 与岗位 id 撞了：下面的映射断言会失去区分力"
    assert b.id != b.job_id, "队列条目 id 与岗位 id 撞了：下面的映射断言会失去区分力"
    captured: dict[str, object] = {}

    def fake_create_apply_task(db, payload):
        captured["job_ids"] = list(payload.job_ids or [])
        captured["use_queue"] = payload.use_queue
        return SimpleNamespace(id=7)

    monkeypatch.setattr(apply_tasks, "create_apply_task", fake_create_apply_task)

    result = execute_tool(db_session, "apply_start", {"queue_ids": [b.id, a.id]})

    assert captured["job_ids"] == [b.job_id, a.job_id], "必须按用户给的顺序提交同一批岗位"
    assert captured["use_queue"] is False, "只投点名的那几条，不许顺手把整队列带上"
    assert result.changed is True
    assert result.summary == "已开始投递 2 条（不可撤销）"
    payload = json.loads(result.text)
    assert payload["岗位id"] == [b.job_id, a.job_id]
    assert "不可撤销" in payload["说明"]


def test_apply_start_preview_lists_jobs_and_is_irreversible(db_session):
    item = _queue_item(
        db_session, _job(db_session, title="后端开发", company="A公司"), sort_order=1
    )

    preview = get_tool("apply_start").preview(db_session, {"queue_ids": [item.id]})

    assert preview.target == "开始投递 1 条岗位"
    # scope 是用户在提案卡上看的最后一句：必须写明外部副作用 + 不可撤销 + 不重试。
    assert "外部副作用" in preview.scope
    assert "不可撤销" in preview.scope
    assert "不自动重试" in preview.scope
    assert len(preview.changes) == 1
    assert preview.changes[0].field == "「后端开发」A公司"
    assert preview.changes[0].before == "未投递"


def test_apply_start_preview_survives_a_stale_id(db_session):
    """预览是尽力而为：id 已不存在时也要如实出一行，而不是整张卡炸掉。"""
    preview = get_tool("apply_start").preview(db_session, {"queue_ids": [999]})

    assert preview.target == "开始投递 1 条岗位"
    assert preview.changes[0].before is None
    assert "不存在" in (preview.changes[0].after or "")


def test_apply_start_never_runs_without_confirmation(db_session, monkeypatch):
    """走真实提案路径（writable=True 的最宽授权）：只见提案卡，run 一次都不执行。

    对应 15F 的验收口径：「对助手说'投前 5 个' → 只见提案卡；未确认前 apply_task 表无新行」。
    """
    item = _queue_item(
        db_session, _job(db_session, title="后端开发", company="A公司"), sort_order=1
    )
    calls: list[object] = []
    monkeypatch.setattr(apply_tasks, "create_apply_task", lambda db, payload: calls.append(payload))

    record = asyncio.run(
        run_tool_call(
            _tool_call("apply_start", {"queue_ids": [item.id]}),
            None,
            SessionLocal,
            _ctx(writable=True),
        )
    )

    assert record["ok"] is True
    assert record["changed"] is False, "未确认的提案不能标记成「已改动」"
    assert calls == [], "未确认前 run 必须一次都不执行"
    assert db_session.query(ApplyTask).count() == 0
    proposal = record["proposal"]
    assert proposal["status"] == "pending"
    assert proposal["tool_name"] == "apply_start"
    assert proposal["preview"]["target"] == "开始投递 1 条岗位"
    assert "不可撤销" in proposal["preview"]["scope"]


def test_queue_update_priority_also_goes_through_a_proposal_when_not_writable(db_session):
    """对照：普通写工具在未授权写入时也走提案（本用例守的是"提案路径没被写坏"）。"""
    item = _queue_item(db_session, _job(db_session), sort_order=1)

    record = asyncio.run(
        run_tool_call(
            _tool_call("queue_update_priority", {"order": [item.id]}),
            None,
            SessionLocal,
            _ctx(writable=False),
        )
    )

    assert record["ok"] is True
    assert record["proposal"]["preview"]["target"] == "调整投递队列顺序"
    # 提案未确认 → 顺序没被动过。
    db_session.refresh(item)
    assert item.sort_order == 1
