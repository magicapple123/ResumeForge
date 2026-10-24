# SPDX-License-Identifier: Apache-2.0
"""W11 格式能力矩阵：与 W05 文档**双写点**的一致性守卫。

矩阵只有一份机器可读定义（`services/resume/format_capabilities.py`），W05 的人类可读
文档必须引用同一组 capability key。W05 文档尚未产出时本测试**跳过并说明原因**——
跳过不是通过，台账里按"未验证"记录。
"""

from __future__ import annotations

from pathlib import Path

import pytest
from app.services.resume.format_capabilities import (
    CAPABILITIES,
    CAPABILITY_KEYS,
    FORMATS,
    explain,
    level_of,
    matrix,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
W05_DOC = (
    REPO_ROOT
    / "deliverables"
    / "software-company"
    / "ResumeForge-format-capability-matrix-20261024.md"
)


def test_every_format_has_every_capability():
    for fmt in FORMATS:
        assert fmt in CAPABILITIES, fmt
        missing = [key for key in CAPABILITY_KEYS if key not in CAPABILITIES[fmt]]
        assert not missing, f"{fmt} 缺少能力项：{missing}"


def test_levels_are_only_known_values():
    valid = {"supported", "approx", "unsupported"}
    for fmt, table in CAPABILITIES.items():
        for key, level in table.items():
            assert key in CAPABILITY_KEYS, f"{fmt} 出现未登记能力：{key}"
            assert level in valid, f"{fmt}.{key} = {level}"


def test_unknown_format_or_capability_is_not_optimistic():
    assert level_of("docx", "italic") == "supported"
    assert level_of("pdf", "italic") == "approx"
    assert level_of("pdf", "link_clickable") == "unsupported"
    assert level_of("nope", "italic") == "unsupported"
    assert level_of("pdf", "nope") == "unsupported"
    assert "PDF" in explain("pdf", "italic")


def test_matrix_can_be_sliced():
    sliced = matrix(formats=["pdf"], capabilities=["italic", "bold"])
    assert sliced == {"pdf": {"italic": "approx", "bold": "supported"}}


def test_w05_document_uses_the_same_capability_keys():
    if not W05_DOC.is_file():
        pytest.skip(f"W05 能力矩阵文档尚未产出：{W05_DOC.name}")
    text = W05_DOC.read_text(encoding="utf-8")
    # 文档里的能力 key 必须全部在表里；同时每个 key 至少要被文档提到一次。
    for key in CAPABILITY_KEYS:
        assert key in text, f"W05 文档没有提到能力项 {key}"


# ===== W05 文档双写守卫：逐格式 × 逐能力核对（不是"提到 key"就算过）=====


def _document_matrix() -> tuple[list[str], dict[str, dict[str, str]]]:
    """从 W05 文档里解析 §2 的矩阵表：首列为格式，表头为 capability key。"""
    lines = [
        line.strip()
        for line in W05_DOC.read_text(encoding="utf-8").splitlines()
        if line.strip().startswith("|")
    ]
    header: list[str] = []
    start = 0
    for index, line in enumerate(lines):
        candidate = [cell.strip() for cell in line.strip("|").split("|")]
        if set(CAPABILITY_KEYS) <= set(candidate):
            header = candidate
            start = index
            break
    assert header, "W05 文档里没有包含全部 capability key 的矩阵表"
    capabilities = header[1:]
    parsed: dict[str, dict[str, str]] = {}
    for line in lines[start + 2 :]:  # 跳过表头行与 |---| 分隔行
        cells = [cell.strip() for cell in line.strip("|").split("|")]
        if cells and cells[0] in FORMATS:
            parsed[cells[0]] = dict(zip(capabilities, cells[1:], strict=False))
    return capabilities, parsed


def test_w05_document_matrix_table_matches_the_machine_matrix():
    """人类可读矩阵必须与 format_capabilities.CAPABILITIES **逐格相等**。

    只核对"文档提到了 key"是不够的：那样文档把 pdf.italic 写成 supported 也照样过——
    而这正是 W11 检查面板会对用户说的话。表头顺序、格式集合、每格等级都在这里钉死。
    """
    if not W05_DOC.is_file():
        pytest.skip(f"W05 能力矩阵文档尚未产出：{W05_DOC.name}")
    capabilities, documented = _document_matrix()

    assert capabilities == list(CAPABILITY_KEYS), "表头的 capability 顺序 / 集合与机器表不一致"
    assert set(documented) == set(FORMATS), (
        f"文档矩阵缺少格式：{sorted(set(FORMATS) - set(documented))}"
    )
    mismatches = {
        fmt: {
            cap: (documented[fmt].get(cap), level_of(fmt, cap))
            for cap in CAPABILITY_KEYS
            if documented[fmt].get(cap) != level_of(fmt, cap)
        }
        for fmt in FORMATS
    }
    assert not {fmt: diff for fmt, diff in mismatches.items() if diff}, (
        f"文档与机器矩阵不一致：{mismatches}"
    )


def test_w05_document_states_the_known_boundaries():
    """已知边界必须写进文档，不能只躺在代码注释里（D6：PDF 斜体近似、链接不可点击）。"""
    if not W05_DOC.is_file():
        pytest.skip(f"W05 能力矩阵文档尚未产出：{W05_DOC.name}")
    text = W05_DOC.read_text(encoding="utf-8")
    for keyword in ("D6", "斜体", "链接", "不嵌入", "W14", "W08"):
        assert keyword in text, f"W05 文档缺少已知边界说明：{keyword}"
