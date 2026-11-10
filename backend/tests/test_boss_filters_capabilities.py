# SPDX-License-Identifier: Apache-2.0
"""BOSS 站点筛选能力表守卫（问题清单 §15.2 / §15.6）。

**这张表是 2026-11-09 用投递专用浏览器（CDP、已登录）逐组实测出来的**，不是从文档里
抄的：多选/单选、兼职联动都来自"设 URL 参数后读筛选栏 (n) 计数"的真实行为。站点改版
时它会静默失效，所以用一条测试把表钉死——改了这里就必须同时改实测记录与前端行为说明。

另外两条守卫：

- 未知分组/未知清单要**留日志**（便于发现站点新增筛选项），不能静默吞掉；
- 离线快照要覆盖全部短清单（含兼职联动的两组），否则断网时这两组永远不可用。
"""

from __future__ import annotations

import logging

from app.services.sites.boss_filters import (
    GROUP_SPECS,
    build_catalogue,
    parse_conditions,
    parse_filter_bar,
    snapshot_catalogue,
)
from test_boss_filters import bar_payload, conditions_payload


def test_group_capability_table_matches_the_measured_site_behaviour():
    """§15.2 实测能力表：多选经验/学历/行业/规模/结算方式/兼职时间/融资阶段；
    单选求职类型/薪资待遇；兼职联动只在 jobType=1903 下出现结算方式与兼职时间。"""
    actual = [
        (spec.key, spec.param, spec.label, spec.multi, spec.visible_when) for spec in GROUP_SPECS
    ]
    assert actual == [
        ("jobType", "jobType", "求职类型", False, None),
        ("salary", "salary", "薪资待遇", False, ("jobType", ("", "0", "1901", "1902"))),
        ("payType", "payType", "结算方式", True, ("jobType", ("1903",))),
        ("partTime", "partTime", "兼职时间", True, ("jobType", ("1903",))),
        ("experience", "experience", "工作经验", True, None),
        ("degree", "degree", "学历要求", True, None),
        ("industry", "industry", "公司行业", True, None),
        ("scale", "scale", "公司规模", True, None),
        ("stage", "stage", "融资阶段", True, None),
    ]


def test_group_capabilities_reach_the_catalogue():
    catalogue = build_catalogue(conditions=parse_conditions(conditions_payload()))
    by_key = {group.key: group for group in catalogue}
    assert [key for key in by_key if by_key[key].multi] == [
        "payType",
        "partTime",
        "experience",
        "degree",
        "industry",
        "scale",
        "stage",
    ]
    assert by_key["salary"].visible_when == ("jobType", ("", "0", "1901", "1902"))
    assert by_key["payType"].visible_when == ("jobType", ("1903",))


def test_snapshot_covers_the_part_time_linked_lists_too():
    """断网兜底也必须有两组兼职联动清单，否则兼职模式下列不出结算方式/兼职时间。"""
    by_key = {group.key: group for group in snapshot_catalogue()}
    assert [item.label for item in by_key["payType"].options] == [
        "不限",
        "日结",
        "周结",
        "月结",
        "完工结",
    ]
    assert [item.label for item in by_key["partTime"].options] == [
        "不限",
        "周末/节假日",
        "寒暑假",
        "短期兼职",
        "长期兼职",
        "工作日",
        "夜班",
    ]
    assert by_key["payType"].visible_when == ("jobType", ("1903",))


def test_unknown_filter_bar_group_is_logged(caplog):
    payload = {
        "groups": [
            {"title": "没见过的格子", "options": [{"code": "1", "label": "x", "group": ""}]},
        ]
    }
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_filters_catalog"):
        assert parse_filter_bar(payload) == {}
    assert any("未知分组" in record.message for record in caplog.records)


def test_unknown_conditions_list_is_logged(caplog):
    payload = conditions_payload()
    payload["zpData"]["mysteryList"] = [{"code": 1, "name": "神秘筛选"}]
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_filters_catalog"):
        parsed = parse_conditions(payload)
    assert "mysteryList" not in str(parsed)
    assert any("未知筛选项清单" in record.message for record in caplog.records)


def test_unknown_catalogue_group_is_logged(caplog):
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_filters_catalog"):
        build_catalogue(
            conditions={
                **parse_conditions(conditions_payload()),
                "mystery": parse_conditions(conditions_payload())["degree"],
            }
        )
    assert any("能力表之外的分组" in record.message for record in caplog.records)


def test_known_bar_groups_do_not_log_noise(caplog):
    """正常读取已知分组时不该打日志——否则每次采集都刷一条无关记录。"""
    with caplog.at_level(logging.INFO, logger="app.services.sites.boss_filters_catalog"):
        assert parse_filter_bar(bar_payload())
    assert not [record for record in caplog.records if "未知分组" in record.message]
