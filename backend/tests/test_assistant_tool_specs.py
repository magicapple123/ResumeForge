# SPDX-License-Identifier: Apache-2.0
"""工具规格（``Tool`` 声明）的守卫：写标记与声明顺序。

这里守的是两件"写错了不会抛异常、只会静默变成行为变更"的事：

1. **C-21 写标记**：名字以 ``create_`` / ``update_`` / ``delete_`` 开头的工具，
   ``writes`` 必须为 True。``writes`` 决定两件事——授权层要求用户确认才放行
   （``_registry._ensure_allowed`` 的 ``ctx.writable`` 兜底），以及前端把这一轮调用
   渲染成"待确认的写入"。漏标不会报错，只会让写入绕过确认直接执行，所以必须有
   一条守卫，而不是靠人记得标。
2. **声明顺序**：``_TOOLS`` 的拼接顺序就是 ``tool_definitions()`` 的输出顺序，
   也就是发给模型的工具列表顺序 —— 顺序变了就是行为变更（提示词变了）。2026-10
   按工具域把 ``_tools_specs_data.py`` 拆成 6 个分片，这条测试把"分片拼接回的顺序
   与拆分前那份单文件的书写顺序完全一致"变成可执行断言。

新增工具时：加进所属域的末尾，再把下面 ``EXPECTED_TOOL_ORDER`` 里的名字补在同一
位置（顺序是刻意钉住的契约，不要为了让它变绿而重排已有条目）。
"""

import pytest
from app.services.assistant_tools import _TOOLS, tool_names
from app.services.assistant_tools._tools_specs_core import CORE_TOOLS
from app.services.assistant_tools._tools_specs_data import DATA_TOOLS
from app.services.assistant_tools._tools_specs_relaxed import RELAXED_TOOLS
from app.services.assistant_tools._tools_specs_report import REPORT_TOOLS
from app.services.assistant_tools._tools_specs_search import SEARCH_TOOLS

# 名字前缀 → 一定是写工具。``delete_`` 目前一条都没有（助手不提供删除工具，
# test_assistant_coverage 另有一条守卫），留着它是因为这个前缀一旦出现就必须是写。
WRITE_NAME_PREFIXES = ("create_", "update_", "delete_")

# 合法例外白名单：**当前为空**。真有"名字像写但不是写"的历史命名时在这里登记
# 名字 + 理由（不要为了让它过而放宽断言）。``test_prefix_exemptions_are_honest``
# 会检查这里没有过期条目。
WRITE_PREFIX_EXEMPTIONS: dict[str, str] = {}

# 拆分前（单文件 ``_tools_specs_data.py``）的书写顺序，即 ``DATA_TOOLS`` 的契约顺序。
EXPECTED_DATA_TOOL_ORDER = (
    # 资料箱
    "list_materials",
    "get_material",
    "create_material",
    "update_material",
    # 事实台账
    "list_claims",
    "get_claim",
    "create_claim",
    "update_claim",
    # 备选岗位
    "list_candidate_jobs",
    "get_candidate_job",
    "create_candidate_job",
    "update_candidate_job",
    "import_candidate_job",
    # 助手技能
    "list_skills",
    "get_skill",
    "create_skill",
    "update_skill",
    # 版式
    "create_format_template",
    "update_format_template",
    "list_format_templates",
    # 文件副本库
    "list_user_files",
)

# 全量注册表顺序（CORE → DATA → RELAXED → REPORT → SEARCH）。这是提示词顺序的
# 唯一契约来源；分组边界也在其中（写工具靠后的位置不要随手提前）。
EXPECTED_TOOL_ORDER = (
    *(tool.name for tool in CORE_TOOLS),
    *EXPECTED_DATA_TOOL_ORDER,
    *(tool.name for tool in RELAXED_TOOLS),
    *(tool.name for tool in REPORT_TOOLS),
    *(tool.name for tool in SEARCH_TOOLS),
)


def test_data_tools_keep_the_pre_split_order():
    """``_tools_specs_data.py`` 拆成 6 个分片后，``DATA_TOOLS`` 的顺序必须一字不差。

    聚合入口用 ``*(MATERIAL_TOOLS, CLAIM_TOOLS, ...)`` 拼接；把某个 ``*`` 挪位置、
    或在新分片里顺手插一条，都会在这里红——因为那会改变发给模型的工具列表顺序。
    """
    assert tuple(tool.name for tool in DATA_TOOLS) == EXPECTED_DATA_TOOL_ORDER


def test_registry_order_is_pinned():
    """全量 ``_TOOLS`` 顺序钉死：分片的拼接位置与拆分前一致，域之间也没有互相挪动。"""
    assert tuple(tool_names()) == EXPECTED_TOOL_ORDER


def test_no_duplicate_tool_names():
    """六个资料分片 + 其它域各声明一份 tuple：重名会在 ``get_tool`` 里静默二选一。"""
    names = [tool.name for tool in _TOOLS]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    assert not duplicates, f"工具名重复注册：{duplicates}"


@pytest.mark.parametrize("prefix", WRITE_NAME_PREFIXES)
def test_create_update_delete_tools_are_flagged_as_writes(prefix):
    """C-21：``create_*`` / ``update_*`` / ``delete_*`` 的 ``writes`` 必须为 True。

    漏标一个写入工具的后果不是报错，而是它在前端显示成"只读查询"、在授权层也不
    要求用户确认——即用户没点过任何按钮，数据就被改了。
    """
    unflagged = [
        tool.name
        for tool in _TOOLS
        if tool.name.startswith(prefix)
        and tool.name not in WRITE_PREFIX_EXEMPTIONS
        and not tool.writes
    ]
    assert not unflagged, (
        f"这些工具名以 {prefix!r} 开头却没有标 writes=True：{unflagged}\n"
        f"请在对应 Tool(...) 声明里加 writes=True；如果它确实是只读的，"
        f"先在 test_assistant_tool_specs.WRITE_PREFIX_EXEMPTIONS 登记理由。"
    )


def test_prefix_exemptions_are_honest():
    """白名单只能放"确实被这条守卫拦下"的工具名——过期的例外必须删掉。"""
    registered = {tool.name for tool in _TOOLS}
    ghosts: list[str] = []
    for name, reason in WRITE_PREFIX_EXEMPTIONS.items():
        assert reason.strip(), f"例外 {name} 缺理由"
        tool = next((item for item in _TOOLS if item.name == name), None)
        if tool is None:
            ghosts.append(f"{name}（未注册的工具）")
        elif not name.startswith(WRITE_NAME_PREFIXES) or tool.writes:
            ghosts.append(f"{name}（不再是例外：前缀或 writes 已经不冲突）")
    assert not ghosts, f"这些例外条目已失效，请同批删除：{ghosts}"
    assert registered  # 注册表为空说明导入坏了，别让上面的循环空转变绿
