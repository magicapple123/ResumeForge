# SPDX-License-Identifier: Apache-2.0
"""Projection overflow contract, split to keep the projection test file under budget."""

from dataclasses import replace

from tests.test_profile_group_projection import _custom_field, _entry, _out, _section


def test_carrier_overflow_warns_and_keeps_default_text() -> None:
    base = "备" * 2000  # 备注结构上限 2000：默认正文已占满，追加行放不下
    section = _section(
        "publications", _entry("u1", "publications", title="论文", note=base, f1="X")
    )
    section = replace(section, fields=(*section.fields, _custom_field("publications.f1", "补充")))
    out = _out(section)
    assert out.content.publications[0].note == base
    assert [item.code for item in out.warnings] == ["carrier_overflow"]
    assert out.warnings[0].entry_id == "u1" and "补充" in out.warnings[0].message
    lines = "\n".join(f"行{index}" for index in range(501))
    out = _out(_section("projects", _entry("p1", "projects", name="项目", description=lines)))
    entry = out.content.projects[0]
    flattened = "\n".join(entry.description)
    assert len(entry.description) <= 500
    for probe in ("行0", "行250", "行498", "行499", "行500"):
        assert probe in flattened, probe
    assert [item.code for item in out.warnings] == ["carrier_overflow"]
