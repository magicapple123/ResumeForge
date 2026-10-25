# SPDX-License-Identifier: Apache-2.0
"""求职助手"了如指掌"的单一事实来源：机器可读的功能目录（门面）。

能力地图由 ``build_capability_map()`` 在运行时渲染，并与工具注册表、前端菜单/指南、
README 功能表三方对齐（守卫测试 ``tests/test_assistant_knowledge_audit.py``）。

**目录数据按原始顺序切成三段放在三个数据文件里**（单文件预算）：profile（共用类型/功能域/
我的资料/投递网申/资料箱）、resume（简历中心/写作增强/收口新增）、workflow（岗位/记录/
回收站/设置）。本门面按原顺序拼回 ``FEATURES`` 并 re-export 公共符号（既有导入路径不变）；
增删条目改对应数据文件，不要在这里重排——能力地图的顺序就是用户读到的顺序。
"""

from __future__ import annotations

from .feature_catalog_profile import (
    APPLY,
    FUNCTIONAL_DOMAINS,
    MATERIALS_AND_WORKBENCH,
    PROFILE_LIBRARY,
    WEB_FORM,
    FeatureEntry,
)
from .feature_catalog_resume import LATE_ADDITIONS, MISC, RESUME_SECTION
from .feature_catalog_workflow import (
    HOME_JOBS_AND_FAVORITES,
    PROGRESS_AND_ASSISTANT,
    TRASH_AND_SETTINGS,
)

# 拼接顺序 = 拆分前 FEATURES 的原始顺序（每段内部顺序也原样保留）。
FEATURES: tuple[FeatureEntry, ...] = (
    *HOME_JOBS_AND_FAVORITES,
    *RESUME_SECTION,
    *PROFILE_LIBRARY,
    *APPLY,
    *WEB_FORM,
    *PROGRESS_AND_ASSISTANT,
    *MATERIALS_AND_WORKBENCH,
    *TRASH_AND_SETTINGS,
    *MISC,
    *LATE_ADDITIONS,
)


def _tool_names() -> list[str]:
    """从工具注册表取全部工具名；延迟导入避免把重型依赖拉到模块加载期。"""
    from .assistant_tools import tool_names

    return tool_names()


def _write_tools() -> list[str]:
    """从工具注册表推导写入类工具名单（``Tool.writes`` 为人工置位、与注册同处）。"""
    from .assistant_tools import _TOOLS as registry

    return [tool.name for tool in registry if tool.writes]


def build_write_tools_line() -> str:
    """渲染「写入类工具」清单；守卫测试据此与 ``_TOOLS.writes`` 双向校验。"""
    names = _write_tools()
    return "写入类工具：" + "、".join(names)


def build_capability_map() -> str:
    """渲染能力地图 markdown 段落，供 ``_system_prompt()`` 每次请求动态注入。

    覆盖三层事实：功能域（菜单）、界面功能（FEATURES）、后端工具清单（``_TOOLS``）。
    用户问"某功能在哪"时，助手据此如实指路，而不是凭记忆里的旧清单回答。
    """
    lines: list[str] = [
        "# 能力地图（由 feature_catalog 动态生成）",
        "",
        "按「功能域 → 在哪个菜单 → 你能帮什么」记下面这份清单；用户问到功能在哪里时，据此如实指路，不要凭猜。"
        "「界面功能」里写了「当前界面不可达」的，如实说明『功能已实现、界面暂未提供入口』——既不要指路，也不要说它不存在。",
        "",
        "## 功能域",
    ]
    lines.extend(f"- {domain}" for domain in FUNCTIONAL_DOMAINS)
    lines.append("")
    lines.append("## 界面功能（这些是 UI 功能，不是后端工具；括号里是它在哪个菜单、怎么用）")
    for feature in FEATURES:
        tool_hint = f"（可配合工具：{'、'.join(feature.tools)}）" if feature.tools else ""
        lines.append(f"- {feature.name}（{feature.domain}：{feature.where}）{tool_hint}")
    lines.append("")
    lines.append("## 可用工具")
    lines.extend(f"- {name}" for name in _tool_names())
    lines.append("")
    lines.append(build_write_tools_line())
    return "\n".join(lines)


__all__ = [
    "FEATURES",
    "FUNCTIONAL_DOMAINS",
    "FeatureEntry",
    "build_capability_map",
    "build_write_tools_line",
]
