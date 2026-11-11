# SPDX-License-Identifier: Apache-2.0
"""T28 守卫：新增「路由 + 工具」对必须走 define_action，存量逐个登记 allowlist。

守卫四件事：
1. 存量静态 Tool(...) 声明集合 == fixtures/actions_legacy_allowlist.json 里登记的集合
   （逐名 allowlist：每项必须写 reason 与 review_after；迁移一个就从名单删一个）。
2. 已注册为 action 的工具不得再出现在静态声明里（防"迁移了一半"）。
3. 注册表 == 静态声明 ∪ action 注册（双向一致，防幽灵/漏注册）。
4. 每个 action 必须同时有工具与 HTTP 路由（工具专属动作在 ``TOOL_ONLY_ACTIONS`` 里
   显式登记后可以没有路由），且权限两侧一致；action registry 非空防空转。
"""

from __future__ import annotations

import ast
import json
from pathlib import Path

from app.services.actions import action_names, get_action
from app.services.actions.catalog import all_actions
from app.services.assistant_tools import get_tool, tool_names

BACKEND = Path(__file__).resolve().parents[1]
TOOLS_DIR = BACKEND / "app" / "services" / "assistant_tools"
ALLOWLIST_PATH = BACKEND / "tests" / "fixtures" / "actions_legacy_allowlist.json"

# 工具专属 action（无 HTTP 等价入口）。契约层允许 http=None（ActionSpec._validate_http
# 明确保留了这个口子），这里逐个登记：**"决定不加路由"必须是显式的**，不能靠"忘了写"
# 也能变绿。#15F 的三个投递队列工具：队列的读/改已有既有路由（GET /api/apply/queue、
# PATCH /api/apply/queue/reorder），而"助手视图"与"提案确认后才执行"的投递入口没有
# 等价 HTTP 语义，硬编一条路由只会让同一份能力长出第二套契约。
TOOL_ONLY_ACTIONS = frozenset({"queue_list", "queue_update_priority", "apply_start"})
_ALLOWED_REASONS = {
    "no_http_route",
    "multipart_or_file_response",
    "async_or_streaming",
    "special_route_dependency",
    "semantic_conflict_pending_design",
    "assistant_only_aggregate",
    # 2026-11-11 剩余条目批次：#13/#16/#18/#27/#29/#31 新增的工具走静态 Tool(...) 声明
    # （本轮按"先交付能力、迁移下一批"取舍），逐名登记并统一 review_after；不是"忘了走
    # define_action"，到期前必须迁移或重新评审。
    "not_yet_migrated",
}


def _legacy_tool_declarations() -> dict[str, str]:
    """工具名 -> 声明文件（只认 Tool(...) 构造，as_tool(spec) 不算）。"""
    declarations: dict[str, str] = {}
    for path in sorted(TOOLS_DIR.glob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "Tool"
            ):
                continue
            for keyword in node.keywords:
                if keyword.arg == "name" and isinstance(keyword.value, ast.Constant):
                    declarations[str(keyword.value.value)] = path.name
    return declarations


def _load_allowlist() -> dict[str, dict]:
    data = json.loads(ALLOWLIST_PATH.read_text(encoding="utf-8"))
    assert data.get("version") == 1, "allowlist 版本必须是 1"
    tools = data.get("tools") or {}
    assert isinstance(tools, dict) and tools, "allowlist.tools 不能为空"
    for name, entry in tools.items():
        assert isinstance(name, str) and name, f"非法工具名：{name!r}"
        assert isinstance(entry, dict), f"{name} 的 allowlist 项必须是对象"
        reason = entry.get("reason")
        assert reason in _ALLOWED_REASONS, f"{name} 的 reason 不在枚举内：{reason!r}"
        assert str(entry.get("note") or "").strip(), f"{name} 必须写明书面理由（note）"
        assert str(entry.get("review_after") or "").strip(), f"{name} 必须有 review_after"
    return tools


def test_legacy_tool_declarations_exactly_match_allowlist():
    allowlist = _load_allowlist()
    legacy = _legacy_tool_declarations()
    missing = sorted(set(legacy) - set(allowlist))
    stale = sorted(set(allowlist) - set(legacy))
    assert not missing, (
        "这些静态 Tool(...) 没有登记在 allowlist："
        f"{missing}\n新增工具必须走 define_action + as_tool；迁移存量时把名字从 allowlist 删除。"
    )
    assert not stale, (
        f"allowlist 里有幽灵条目（已经不是静态声明了）：{stale}\n迁移完成后必须从名单删除。"
    )


def test_migrated_tools_no_longer_appear_as_static_declarations():
    legacy = set(_legacy_tool_declarations())
    migrated = set(action_names())
    overlap = sorted(legacy & migrated)
    assert not overlap, f"这些工具已迁到 action 契约层却仍有 Tool(...) 静态声明：{overlap}"


def test_registry_equals_static_declarations_union_actions():
    legacy = set(_legacy_tool_declarations())
    migrated = set(action_names())
    registered = set(tool_names())
    extra = sorted(registered - legacy - migrated)
    missing = sorted((legacy | migrated) - registered)
    assert not extra, f"注册表多出未声明工具：{extra}"
    assert not missing, f"声明/action 里存在但未注册：{missing}"


def test_every_action_has_both_tool_and_http_route():
    for name in action_names():
        action = get_action(name)
        assert action is not None
        if name in TOOL_ONLY_ACTIONS:
            # 工具专属动作：契约层允许 http=None（见 ActionSpec._validate_http 的说明），
            # 但必须显式登记在上面——"忘了加路由"与"决定不加路由"要能区分。
            assert action.http is None, f"{name} 已登记为工具专属，却又声明了 HTTP 路由"
            assert get_tool(name) is not None, f"action {name} 没有同名工具（as_tool 未注册）"
            continue
        assert action.http is not None, f"action {name} 缺少显式 http 元数据"
        tool = get_tool(name)
        assert tool is not None, f"action {name} 没有同名工具（as_tool 未注册）"
        assert tool.permission is action.permission, f"action {name} 的权限与工具不一致"


def test_action_catalog_is_not_empty_after_import():
    # 防止守卫空转变绿：catalog 必须能聚合出所有已迁移动作。
    specs = all_actions()
    assert len(specs) >= 30, f"action catalog 只有 {len(specs)} 个动作，T28 迁移疑似被清空"
    assert {"get_job", "list_materials", "update_skill"} <= set(specs)
