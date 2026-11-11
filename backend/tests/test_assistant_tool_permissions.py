# SPDX-License-Identifier: Apache-2.0
"""T17 工具四级权限守卫：注册处显式定级 + writes 兼容 + 预览契约 + 逐工具定级清单。

守卫四件事（对应 T17 验收）：

a. 每个工具都在注册处**显式声明**四类权限之一，值必须是 ``ToolPermission`` 成员。
   显式性用两层守：运行时 ``tool.permission is not None``，以及 AST 扫描所有
   ``Tool(...)`` 构造点必须有 ``permission=ToolPermission.XXX`` 关键字——漏声明时
   这里点名文件:行号与工具名，而不是等某次写入行为出错才发现。T27 起部分工具改由
   ``as_tool(ActionSpec)`` 生成（契约层 single source）：这类工具有 ActionSpec 上的
   ``permission=`` 声明，同一验收口径按"Tool(...) + as_tool 合计"覆盖全部工具。
b. ``writes`` 兼容语义：``writes`` 与 permission 一致（``READ_ONLY`` 以外为 True）；
   ``tool_writes()`` 与 ``policy.tools_for_turn()`` 的过滤结果仍是只读工具集合
   （T17 要求保留既有调用方语义，见 ``_types.Tool.writes`` 的派生实现）。
c. 写工具仍有 ``preview``（RF-01 契约：未确认写入时执行层只跑预览）；只读工具不挂。
d. 91 个工具逐项定级符合 ``EXPECTED_PERMISSIONS``（逐项 parametrize，失败点名工具；
   T29 新增的 4 个只读质检工具、期二 T12 的 3 个求职偏好工具、#15F 的 3 个投递队列
   工具也在清单里）。

维护方法：新增工具时在注册处的 ``Tool(...)`` 里写 ``permission=ToolPermission.X``，
再把名字补进下面对应的集合。``update_skill`` 是目前唯一的 irreversible_write
（传 files 时整体替换知识文件，旧文件没有版本可恢复）；external_side_effect 目前
**只有一个** ``apply_start``（#15F 用户拍板的唯一例外，见下面的集合注释）——除此之外
不允许为了凑四类去编造。
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest
from app.services.actions import action_names, get_action
from app.services.assistant_tools import _TOOLS, tool_writes
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools._types import ToolPermission

REPO_ROOT = Path(__file__).resolve().parents[2]
TOOLS_DIR = REPO_ROOT / "backend" / "app" / "services" / "assistant_tools"

READ_ONLY = ToolPermission.READ_ONLY
REVERSIBLE_WRITE = ToolPermission.REVERSIBLE_WRITE
IRREVERSIBLE_WRITE = ToolPermission.IRREVERSIBLE_WRITE
EXTERNAL_SIDE_EFFECT = ToolPermission.EXTERNAL_SIDE_EFFECT
PERMISSION_LEVELS = (READ_ONLY, REVERSIBLE_WRITE, IRREVERSIBLE_WRITE, EXTERNAL_SIDE_EFFECT)

# ===== 91 个工具的逐项定级（T17/T29/T31/T12/#15F/#16/#18A/#29A 的验收清单，改级别必须同批改这里）=====

# 只读：只读查询/检索/读取，不写任何数据。
_READ_ONLY_TOOLS = (
    # 核心域（岗位/简历/资料/求职进度查询 + 产品文档/技能知识检索）
    "search_product_docs",
    "read_skill_knowledge",
    "get_overview",
    "list_jobs",
    "get_job",
    "list_resumes",
    "get_resume",
    "get_profile",
    "list_application_tracks",
    "get_application_track",
    # 资料域
    "list_materials",
    "get_material",
    "list_claims",
    "get_claim",
    "list_candidate_jobs",
    "get_candidate_job",
    "list_skills",
    "get_skill",
    "list_format_templates",
    "list_user_files",
    # 放宽模式（敏感只读）
    "list_web_form_fills",
    "get_web_form_fill",
    "list_chat_conversations",
    "get_chat_conversation",
    # 报告域
    "list_interview_sessions",
    "get_interview_report",
    "list_drill_sessions",
    "get_drill_report",
    "list_reminders",
    "list_apply_queue",
    "list_referrals",
    "list_interview_experiences",
    "list_question_banks",
    "list_reviews",
    "list_knowledge",
    "get_knowledge",
    "get_analytics_overview",
    "list_share_packages",
    "list_apply_records",
    "list_match_analyses",
    # #15F 对话式投递军师：查看投递队列（只读；不投递）
    "queue_list",
    # 联网搜索（只读网络查询，不落库、不向外部系统提交任何东西）
    "web_search",
    # 简历文档只读（版面读数 / 版本 / 变体 / 单条读取）
    "get_resume_status",
    "list_versions",
    "list_variants",
    "get_entry",
    # T29 只读质检（质量检测 / ATS 匹配 / 统一检查 / 版本对比，全部本地规则、不调远端模型）
    "run_resume_quality_check",
    "check_ats_match",
    "get_resume_preflight",
    "compare_resume_versions",
    # T31 只读错误诊断（聚合失败枚举与日志白名单字段，不返回日志原文）
    "diagnose_recent_errors",
    # 期二 T12 求职偏好只读查询（与 GET /api/job-preferences 同源）
    "get_job_preferences",
    # #16 链接抓取只读（抓不到就如实说，不写库）
    "web_extract",
    # #29A 知识库混合检索（返回 id/标题/摘要，正文仍用 get_knowledge）
    "search_knowledge",
    # 18A 查任务进度
    "task_status",
)

# 可撤销写入：新建或局部修改记录，事后能删除、改回或从撤销点恢复。
# 简历文档类写入（update_resume_field / add_resume_entry / reorder_sections /
# set_entry_layout）执行前都会自动留一份「助手修改前」命名版本，因此均可撤销。
_REVERSIBLE_WRITE_TOOLS = (
    "create_job",
    "update_job",
    "update_profile",
    "create_application_track",
    "update_application_track",
    "add_profile_entry",
    "create_material",
    "update_material",
    "create_claim",
    "update_claim",
    "create_candidate_job",
    "update_candidate_job",
    "import_candidate_job",
    "create_skill",
    "create_format_template",
    "update_format_template",
    "update_resume_layout",
    "create_knowledge",
    "update_knowledge",
    "create_reminder",
    "update_resume",
    "update_reminder",
    "create_interview_experience",
    "create_referral",
    "update_resume_field",
    "add_resume_entry",
    "reorder_sections",
    "set_entry_layout",
    # 期二 T12：偏好是"下一轮就进系统提示"的用户设定，必须始终由用户确认（同技能）。
    "create_job_preference",
    "update_job_preference",
    # #15F：只改队列顺序，把顺序再调回去就能撤销；投递本身不在这一级（见下方 apply_start）。
    "queue_update_priority",
    # 18A：建任务/取消任务都属于"状态可再调整"的写入（取消是终态，但已完成的步骤保留，
    # 且任务本身不是用户数据资产）；必须在提案卡里写明 N 条 / M 步后才执行。
    "task_create",
    "task_cancel",
    # #16：链接导入是写（会批量建岗）但可撤销——逐条删掉/跳过即可，不覆盖用户数据。
    "import_jobs_from_url",
)

# 不可逆写入：整份覆盖、清空类，事后收不回来。目前只有 update_skill：
# 传 files 时它整体替换该技能的知识文件（旧文件行被直接替换，没有版本或回收站）。
# 其余 update_* 都是"只改传入字段、其余保留"的局部修改，因此仍是可撤销写入。
_IRREVERSIBLE_WRITE_TOOLS = ("update_skill",)

# 外部副作用：向系统外部投递/发送/提交。**目前只有一个，是用户拍板的唯一例外**：
# ``apply_start``（#15F 对话式投递军师）会驱动受控浏览器在招聘平台上真的提交投递，
# 平台侧没有撤回接口 = 本地不可撤销。它必须永远走提案卡（policy.ALWAYS_PROPOSAL_TOOLS）、
# 不可撤销、失败不自动重试；``tests/test_assistant_apply_tools.py`` 另有专门断言
# （含"preview 必含不可撤销"与"未确认时 run 一次都不跑"）。除它之外不得再新增这一级。
_EXTERNAL_SIDE_EFFECT_TOOLS: tuple[str, ...] = ("apply_start",)

EXPECTED_PERMISSIONS: dict[str, ToolPermission] = {
    **{name: READ_ONLY for name in _READ_ONLY_TOOLS},
    **{name: REVERSIBLE_WRITE for name in _REVERSIBLE_WRITE_TOOLS},
    **{name: IRREVERSIBLE_WRITE for name in _IRREVERSIBLE_WRITE_TOOLS},
    **{name: EXTERNAL_SIDE_EFFECT for name in _EXTERNAL_SIDE_EFFECT_TOOLS},
}

EXPECTED_TOOL_COUNT = 91


def _tool_constructions() -> list[tuple[Path, ast.Call]]:
    """扫描 ``assistant_tools`` 包内所有 ``Tool(...)`` 构造调用（纯 AST，不执行）。"""
    calls: list[tuple[Path, ast.Call]] = []
    for path in sorted(TOOLS_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Name)
                and node.func.id == "Tool"
            ):
                calls.append((path, node))
    return calls


def _keyword_map(call: ast.Call) -> dict[str, ast.expr]:
    """把一次构造调用里的关键字参数取成 {名字: AST 节点}（** 展开忽略）。"""
    return {keyword.arg: keyword.value for keyword in call.keywords if keyword.arg}


def _literal_tool_name(call: ast.Call) -> str:
    """构造调用里的 ``name="..."`` 字面量；取不到时返回 "?"（只影响报错文案）。"""
    value = _keyword_map(call).get("name")
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return value.value
    return "?"


def _site_label(path: Path, call: ast.Call) -> str:
    """报错用的位置标签：仓库相对路径:行号。"""
    return f"{path.relative_to(REPO_ROOT)}:{call.lineno}"


def _registry_by_name() -> dict:
    return {tool.name: tool for tool in _TOOLS}


def test_permission_enum_has_exactly_the_four_levels():
    """四级枚举本身钉死：名称与值都不能悄悄改（前端/文档引用的是这四个名字）。"""
    assert {level.name for level in ToolPermission} == {
        "READ_ONLY",
        "REVERSIBLE_WRITE",
        "IRREVERSIBLE_WRITE",
        "EXTERNAL_SIDE_EFFECT",
    }
    assert {level.value for level in PERMISSION_LEVELS} == {
        "read_only",
        "reversible_write",
        "irreversible_write",
        "external_side_effect",
    }


def test_expected_list_covers_every_registered_tool_exactly_once():
    """清单与注册表双向一致：新增/改名/漏登记都会在这里红（91 个工具逐个定级）。"""
    registered = [tool.name for tool in _TOOLS]
    assert len(registered) == EXPECTED_TOOL_COUNT, (
        f"注册表里有 {len(registered)} 个工具，T17/T29 定级清单按 {EXPECTED_TOOL_COUNT} 个编写；"
        "新增工具时请同步 EXPECTED_PERMISSIONS"
    )
    duplicates = sorted({name for name in registered if registered.count(name) > 1})
    assert not duplicates, f"工具名重复注册：{duplicates}"
    assert sorted(EXPECTED_PERMISSIONS) == sorted(registered), (
        "定级清单与注册表不一致：\n"
        f"  只在注册表：{sorted(set(registered) - set(EXPECTED_PERMISSIONS))}\n"
        f"  只在清单：{sorted(set(EXPECTED_PERMISSIONS) - set(registered))}"
    )


@pytest.mark.parametrize("name", sorted(EXPECTED_PERMISSIONS))
def test_expected_permission_per_tool(name: str):
    """d. 逐项断言 91 个工具的定级（失败信息点名工具，不靠汇总差异猜）。"""
    tool = _registry_by_name().get(name)
    assert tool is not None, f"注册表里没有工具 {name}（清单过期或工具被删）"
    expected = EXPECTED_PERMISSIONS[name]
    assert tool.permission is expected, (
        f"{name} 的权限级别是 {tool.permission}，期望 {expected}；"
        "请改注册处 Tool(...) 的 permission=...，不要只改本测试清单"
    )


def test_every_tool_declares_one_of_the_four_levels():
    """a. 运行时核验：91 个工具的 permission 都是四类之一且不是缺省 None。"""
    problems: list[str] = []
    for tool in _TOOLS:
        if tool.permission is None:
            problems.append(f"{tool.name}: 未声明 permission（注册处漏写 permission=）")
        elif not isinstance(tool.permission, ToolPermission):
            problems.append(f"{tool.name}: {tool.permission!r} 不是 ToolPermission 成员")
        elif tool.permission not in PERMISSION_LEVELS:
            problems.append(f"{tool.name}: {tool.permission!r} 不在四类权限之内")
    assert not problems, "权限级别声明不合法：\n" + "\n".join(problems)


def test_permission_distribution_is_the_expected_one():
    """分布快照：55 只读 / 34 可撤销 / 1 不可逆 / 1 外部副作用（T17 + T29 + T31 + T12 + #15F + #16/#18A/#29A）。"""
    counts = {
        level: sum(1 for tool in _TOOLS if tool.permission is level) for level in PERMISSION_LEVELS
    }
    assert counts == {
        READ_ONLY: 55,
        REVERSIBLE_WRITE: 34,
        IRREVERSIBLE_WRITE: 1,
        EXTERNAL_SIDE_EFFECT: 1,
    }


def test_external_side_effect_tool_is_apply_start_only():
    """外部副作用级只有 apply_start（用户拍板的唯一例外），且它必须带非空 preview。

    这条守卫防两件事：① 又有人往这一级塞工具（"助手帮忙海投"是最容易被想出来的功能，
    也是唯一不可撤销的）；② apply_start 的预览被清空——预览是用户在提案卡上确认前
    看到的最后一份说明，没有它执行层会直接拒执行（assistant_tool_exec 的 "该写入工具
    没有预览能力"）。
    """
    actual = [tool.name for tool in _TOOLS if tool.permission is EXTERNAL_SIDE_EFFECT]
    assert actual == list(_EXTERNAL_SIDE_EFFECT_TOOLS) == ["apply_start"]
    apply_start = _registry_by_name()["apply_start"]
    assert apply_start.preview is not None, "apply_start 的写入预览被清空了（提案卡会变空白）"


def test_every_registration_site_declares_permission_in_source():
    """a. AST 扫描：每个 Tool(...) 构造处都显式写 permission=ToolPermission.XXX。"""
    problems: list[str] = []
    valid_members = {level.name for level in PERMISSION_LEVELS}
    for path, call in _tool_constructions():
        where = _site_label(path, call)
        tool_name = _literal_tool_name(call)
        kwargs = _keyword_map(call)
        if "writes" in kwargs:
            problems.append(
                f"{where} 工具 {tool_name}：仍在传已废弃的 writes=，"
                "改用 permission=ToolPermission.X 显式定级"
            )
        permission = kwargs.get("permission")
        if permission is None:
            problems.append(f"{where} 工具 {tool_name}：缺少 permission= 显式声明")
            continue
        if not (
            isinstance(permission, ast.Attribute)
            and isinstance(permission.value, ast.Name)
            and permission.value.id == "ToolPermission"
        ):
            problems.append(
                f"{where} 工具 {tool_name}：permission 必须是 "
                "ToolPermission.<级别> 字面量，不接收字符串或变量"
            )
        elif permission.attr not in valid_members:
            problems.append(f"{where} 工具 {tool_name}：未知权限级别 {permission.attr}")
    assert not problems, "注册处权限声明不合法：\n" + "\n".join(problems)


def test_source_declaration_matches_the_runtime_registry():
    """声明里的级别与运行时 ``tool.permission`` 一致（防"声明被覆盖/读错"）。

    T27（契约层）起部分工具由 ``as_tool(ActionSpec)`` 生成，没有 Tool(...) 构造点：
    它们从 ActionSpec.permission 取声明（仍是注册处的显式声明）。统计口径因此是
    「Tool(...) 声明 + as_tool 注册」两者合计 = 全部工具，不多不少。
    """
    declared: dict[str, ToolPermission] = {}
    for path, call in _tool_constructions():
        kwargs = _keyword_map(call)
        tool_name = _literal_tool_name(call)
        permission = kwargs.get("permission")
        if not (isinstance(permission, ast.Attribute) and tool_name != "?"):
            continue
        member = getattr(ToolPermission, permission.attr, None)
        assert member is not None, f"{_site_label(path, call)}：未知级别 {permission.attr}"
        declared[tool_name] = member
    runtime = {tool.name: tool.permission for tool in _TOOLS}
    migrated: dict[str, ToolPermission] = {}
    for name in action_names():
        action = get_action(name)
        if action is None:
            continue
        assert isinstance(action.permission, ToolPermission), (
            f"action {name} 的 permission 不是 ToolPermission 成员：{action.permission!r}"
        )
        migrated[name] = action.permission
    declared.update(migrated)
    assert set(migrated) <= set(runtime), (
        f"这些 action 没有同名工具（as_tool 未注册）：{sorted(set(migrated) - set(runtime))}"
    )
    assert len(declared) == EXPECTED_TOOL_COUNT
    assert declared == runtime, "源码声明与运行时注册表不一致（有构造点被条件覆盖？）"


def test_writes_stays_consistent_with_permission():
    """b. 兼容语义：writes 为 True ⇔ permission 非 READ_ONLY（None 按写处理）。"""
    for tool in _TOOLS:
        assert tool.writes is (tool.permission is not READ_ONLY), (
            f"{tool.name}: writes={tool.writes} 与 permission={tool.permission} 不一致"
        )
        if tool.permission is READ_ONLY:
            assert tool.writes is False
        else:
            assert tool.writes is True


def test_tool_writes_helper_matches_the_tool_field():
    """b. 既有调用方 ``tool_writes()`` 的返回与 ``Tool.writes`` 同源。"""
    for tool in _TOOLS:
        assert tool_writes(tool.name) is tool.writes, tool.name
    assert tool_writes("definitely_not_a_tool") is False


def test_tools_for_turn_still_filters_by_writes():
    """b. ``policy.tools_for_turn`` 的既有语义不变：无写入意图时只下发只读工具。"""
    tools = list(_TOOLS)
    read_only_names = [tool.name for tool in tools if tool.permission is READ_ONLY]
    kept = tool_policy.tools_for_turn(
        tools, latest_user_text="", session_used_writes=False, relaxed=False
    )
    assert [tool.name for tool in kept] == read_only_names
    # 命中写入意图 / 放宽模式 / 本会话用过写工具时全量下发（历史行为，不得退化）。
    assert (
        tool_policy.tools_for_turn(
            tools, latest_user_text="帮我投递", session_used_writes=False, relaxed=False
        )
        == tools
    )
    assert (
        tool_policy.tools_for_turn(
            tools, latest_user_text="", session_used_writes=True, relaxed=False
        )
        == tools
    )
    assert (
        tool_policy.tools_for_turn(
            tools, latest_user_text="", session_used_writes=False, relaxed=True
        )
        == tools
    )


def test_every_write_tool_still_has_a_preview():
    """c. RF-01 契约：写工具必须能生成写入预览（未确认时执行层只跑预览）。"""
    missing = [tool.name for tool in _TOOLS if tool.writes and tool.preview is None]
    assert not missing, f"这些写工具缺少 preview（未确认写入会直接被执行层拒绝）：{missing}"
    unexpected = [tool.name for tool in _TOOLS if not tool.writes and tool.preview is not None]
    assert not unexpected, f"这些只读工具挂了写入预览，语义混乱：{unexpected}"
