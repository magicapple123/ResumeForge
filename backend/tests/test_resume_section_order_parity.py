# SPDX-License-Identifier: Apache-2.0
"""跨端守卫：前端 ``DEFAULT_RESUME_SECTION_ORDER`` 必须与后端默认顺序逐项一致。

两份常量刻意不共享（前端要零请求拿到默认顺序，后端要服务四个渲染器），但顺序漂移
的代价很实：前端那份少了几个板块时，「调整板块顺序」会少几项、复用归一化的人会静默
丢掉未知键。这里用正则从 TS 源码里提取数组字面量做双向比对。

**为什么用正则而不是 TS parser**：为一条守卫引入 parser 不划算；正则锚定在
``export const DEFAULT_RESUME_SECTION_ORDER`` 到下一个 ``]`` 之间，够稳。正则失效时
最危险的是"解析出 0 项 → 空比对恒绿"，所以 :func:`_parse_frontend_order` 自带
"解析不到就抛错"的自检，并由 ``test_parser_self_check_*`` 钉住。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_ORDER_PATH = REPO_ROOT / "frontend" / "src" / "utils" / "resumeSectionOrder.ts"

# 锚定在导出语句到下一个 `]`：注释/换行都不影响，数组外的 `]` 也不会被吞进来。
_ARRAY_RE = re.compile(
    r"export\s+const\s+DEFAULT_RESUME_SECTION_ORDER[^=]*=\s*\[(?P<body>.*?)\]",
    re.DOTALL,
)
_ITEM_RE = re.compile(r'"([^"]+)"')


def _parse_frontend_order(source: str) -> list[str]:
    """从 TS 源码提取默认顺序；解析不到任何键就抛错（防"空比对恒绿"）。"""
    match = _ARRAY_RE.search(source)
    if match is None:
        raise AssertionError(
            "在 resumeSectionOrder.ts 里找不到 DEFAULT_RESUME_SECTION_ORDER 的数组字面量；"
            "数组写法变了就必须同步改本守卫的正则"
        )
    keys = _ITEM_RE.findall(match.group("body"))
    if not keys:
        raise AssertionError(
            "DEFAULT_RESUME_SECTION_ORDER 解析出 0 个分区键：正则失效会让跨端比对恒绿"
        )
    return keys


def _describe_diff(frontend: list[str], backend: list[str]) -> str:
    """失败信息必须点名差异项，而不是只说"两份不相等"。"""
    missing_in_frontend = [key for key in backend if key not in frontend]
    extra_in_frontend = [key for key in frontend if key not in backend]
    parts = []
    if missing_in_frontend:
        parts.append(f"前端缺少：{', '.join(missing_in_frontend)}")
    if extra_in_frontend:
        parts.append(f"前端多出：{', '.join(extra_in_frontend)}")
    if not parts:
        parts.append("键集合相同但顺序不同")
    parts.append(f"前端={frontend}")
    parts.append(f"后端={backend}")
    return "；".join(parts)


def test_default_section_order_matches_backend():
    source = FRONTEND_ORDER_PATH.read_text(encoding="utf-8")
    frontend = _parse_frontend_order(source)
    backend = list(DEFAULT_SECTION_ORDER)

    assert frontend == backend, (
        "前端 DEFAULT_RESUME_SECTION_ORDER 与后端 DEFAULT_SECTION_ORDER 不一致（"
        + _describe_diff(frontend, backend)
        + "）"
    )


def test_diff_message_names_missing_key():
    """从后端删掉 ``patents`` 时，失败信息要指名它（不是笼统的"两条不相等"）。"""
    backend = [key for key in DEFAULT_SECTION_ORDER if key != "patents"]
    message = _describe_diff(list(DEFAULT_SECTION_ORDER), backend)
    assert "patents" in message


def test_parser_self_check_rejects_empty_array():
    """解析出 0 项必须失败：否则正则一失效，空比对就会一直绿。"""
    with pytest.raises(AssertionError):
        _parse_frontend_order("export const DEFAULT_RESUME_SECTION_ORDER: string[] = [];")


def test_parser_self_check_rejects_missing_declaration():
    with pytest.raises(AssertionError):
        _parse_frontend_order("export const SOMETHING_ELSE: string[] = ['education'];")
