# SPDX-License-Identifier: Apache-2.0
"""焦点面板「重复网申补充」的显示名 + 英文文案出处守卫。

面板清单里除了简历侧板块，还有一支来自「网申资料 → 可重复的记录」（12 个补充组：
教育/实习/项目/校园/学术/获奖/语言/证书/技能/紧急联系人/作品/社交）。它们走
``repeated_profile.catalog_entries``，key 空间与板块、单值目录都不同，所以单独一个文件
钉住：

1. 组名走 ``repeat:<group>`` 表、字段名先查补充表再回落网申目录；
2. 「项目经历补充 1」不能和简历侧「项目经历 1」翻成同一个英文名；
3. 12 组 × 2 序号的真实清单在 ``en-US`` 下**不含一个中文**，``zh-CN`` 下除 ``display*``
   之外一个字段都不变；
4. 英文文案要么出自 `frontend/src/i18n/messages` 的校对词表，要么在显式白名单里
   （``BACKEND_OWNED_COPY``，只许 ``repeat:`` 键）。

前半部分（板块 / 内置字段 / 自定义内容 / 会话层）在 ``test_webform_panel_labels.py``。
"""

from __future__ import annotations

import pathlib
import re

from app.services.webform import panel_label_tables, panel_repeat_labels
from app.services.webform.panel_labels import with_display_fields
from app.services.webform.repeated_profile import catalog_entries, save_groups
from app.services.webform.repeated_profile_catalog import REPEATED_PROFILE_GROUPS

REPO_ROOT = pathlib.Path(__file__).resolve().parents[2]
FRONTEND_COPY = REPO_ROOT / "frontend" / "src" / "i18n" / "messages"

# 「界面文案里不该出现的字」：中文与全角标点。英文表里出现任何一个都说明漏翻或串了行。
_CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")


def _frontend_copy(name: str) -> str:
    return (FRONTEND_COPY / name).read_text(encoding="utf-8")


def test_repeat_group_names_do_not_collide_with_the_resume_sections() -> None:
    """「项目经历补充 1」与「项目经历 1」必须是两个不同的英文名。

    两者在清单里本来就是两组（一组是简历里的项目、一组是只在网申表里补的项目），
    翻成同一个「Projects 1」会让用户看到两个同名组头，只能靠点开内容猜。
    """
    rows = with_display_fields(
        [
            {
                "group": "项目经历 1",
                "label": "项目名称",
                "value": "会员分层",
                "key": "project_name",
                "group_key": "projects",
                "group_index": "1",
                "label_key": "projects.name",
            },
            {
                "group": "项目经历补充 1",
                "label": "项目内容补充",
                "value": "召回策略",
                "key": "project_1_content",
                "source": "extra",
                "group_key": "repeat:project",
                "group_index": "1",
                "label_key": "repeat:project.project_content",
            },
        ],
        "en-US",
    )
    assert [row["display_group"] for row in rows] == ["Projects 1", "Project details 1"]
    assert [row["display"] for row in rows] == ["Project name", "Project description"]


def test_repeat_rows_take_the_group_from_repeat_tables_and_the_field_from_either_table() -> None:
    """补充记录行的两条规则：组名查 ``repeat:`` 表；字段先查补充表再回落网申目录。"""
    rows = with_display_fields(
        [
            {
                "group": "作品和附件 2",
                "label": "作品名称（第二条）",
                "value": "作品集",
                "key": "portfolio_2_name",
                "source": "extra",
                "group_key": "repeat:portfolio",
                "group_index": "2",
                "label_key": "repeat:portfolio.portfolio_name",
            },
            {
                # 紧急联系人姓名在网申目录里本来就有英文，不该因为"在补充记录里"退回中文。
                "group": "紧急联系人 1",
                "label": "紧急联系人姓名（第一条）",
                "value": "李四",
                "key": "contact_1_name",
                "source": "extra",
                "group_key": "repeat:emergency_contact",
                "group_index": "1",
                "label_key": "repeat:emergency_contact.contact_name",
            },
        ],
        "en-US",
    )
    # 序号只出现在分组名里，标签上不再重复 `(Entry N)`（否则一行两个序号）。
    assert [(row["display_group"], row["display"]) for row in rows] == [
        ("Portfolio and attachments 2", "Portfolio name"),
        ("Emergency contacts 1", "Emergency contact name"),
    ]


def test_every_repeat_group_and_field_row_reads_english_in_the_panel(db_session) -> None:
    """把 12 个补充组各存两条记录，整份清单在英文下**不含一个中文**。

    这是用户反馈那类问题的**形状级**守卫：不是"某几个键翻好了"，而是"所有组、所有序号
    组合下都不露中文"。zh-CN 侧同时验证除 ``display*`` 之外一个字段都没变。
    """
    payload = {}
    for group in REPEATED_PROFILE_GROUPS:
        first = group.fields[0].key
        second = group.fields[-1].key
        payload[group.key] = [
            {"values": {first: f"{group.key}-a"}},
            {"values": {second: f"{group.key}-b"}},
        ]
    save_groups(db_session, payload)

    rows = catalog_entries(db_session)
    assert {row["group_key"] for row in rows} == {
        f"repeat:{group.key}" for group in REPEATED_PROFILE_GROUPS
    }
    assert all(row["label_key"].startswith("repeat:") for row in rows)

    english = with_display_fields(rows, "en-US")
    leaked = [
        row for row in english if _CJK.search(row["display"]) or _CJK.search(row["display_group"])
    ]
    assert leaked == [], leaked
    # 分组名必须带序号，且与简历侧的板块名不同名。
    assert {row["display_group"] for row in english} >= {
        "Education details 1",
        "Education details 2",
        "Project details 1",
        "Portfolio and attachments 2",
        "Social accounts 1",
        "Emergency contacts 2",
    }

    chinese = with_display_fields(rows, "zh-CN")
    for original, row in zip(rows, chinese, strict=True):
        assert row["display"] == original["label"]
        assert row["display_group"] == original["group"]
        stripped = {
            key: value for key, value in row.items() if key not in {"display", "display_group"}
        }
        assert stripped == original


def test_every_english_table_value_has_no_cjk() -> None:
    """英文表里不允许出现中文或全角标点：那是漏翻，不是"回退"。"""
    tables = {
        "SECTION_LABELS": panel_label_tables.SECTION_LABELS,
        "FIELD_LABELS": panel_label_tables.FIELD_LABELS,
        "FORM_FIELD_LABELS": panel_label_tables.FORM_FIELD_LABELS,
        "REPEAT_GROUP_LABELS": panel_repeat_labels.REPEAT_GROUP_LABELS,
        "REPEAT_FIELD_LABELS": panel_repeat_labels.REPEAT_FIELD_LABELS,
    }
    for name, table in tables.items():
        assert table, name
        leaked = {key: value for key, value in table.items() if _CJK.search(value)}
        assert leaked == {}, f"{name} 里有中文：{leaked}"


def test_english_copy_comes_from_the_frontend_tables() -> None:
    """**不发明措辞**：每个英文名要么能在前端校对过的词表里找到，要么在白名单里。

    这条是防"慢慢漂出一套自己的英文版"的闸门——面板上的字段名与资料页必须叫同一个名字，
    否则用户在两个界面之间对不上号。

    白名单（``BACKEND_OWNED_COPY``）只放前端词表**暂时没有**的少数几条（作品 / 社交），
    而且必须显式登记：加一个新英文名却查不到出处时，这条会红，逼人做一次明确决定。
    """
    sections = _frontend_copy("en-US.profileLibrary.ts")
    fields = _frontend_copy("en-US.profileField.ts")
    form_fields = _frontend_copy("en-US.webformFields.ts")
    webform_groups = _frontend_copy("en-US.webformGroups.ts")
    everything = sections + fields + form_fields + webform_groups
    owned = panel_repeat_labels.BACKEND_OWNED_COPY

    # 白名单不是"翻译豁免口袋"：只许是补充记录那一支的键。
    assert owned, "白名单为空时可以直接删掉这条断言"
    assert all(key.startswith(panel_repeat_labels.REPEAT_KEY_PREFIX) for key in owned), sorted(
        owned
    )

    for section_key, value in panel_label_tables.SECTION_LABELS.items():
        assert f'profileLibrary.sectionFallback.{section_key}": "{value}"' in sections, (
            section_key,
            value,
        )
    for field_id, value in panel_label_tables.FIELD_LABELS.items():
        assert f'"profileField.{field_id}": "{value}"' in fields, (field_id, value)
    for form_key, value in panel_label_tables.FORM_FIELD_LABELS.items():
        # 落表时去掉了 `(Entry 1)` 这类条目后缀，所以按前缀匹配。
        assert f'"webformFields.{form_key}": "{value}' in form_fields, (form_key, value)
    for value in panel_label_tables.FORM_FIELD_FALLBACKS.values():
        assert f'"{value}"' in everything, value
    for group_key, value in panel_repeat_labels.REPEAT_GROUP_LABELS.items():
        owned_key = f"{panel_repeat_labels.REPEAT_KEY_PREFIX}{group_key}"
        if owned_key in owned:
            assert f'"webformGroups.repeat.{group_key}"' not in webform_groups, (
                f"{group_key} 前端已经补齐了，把它从 BACKEND_OWNED_COPY 删掉并改抄那里的措辞"
            )
            continue
        assert f'"webformGroups.repeat.{group_key}": "{value}"' in webform_groups, (
            group_key,
            value,
        )
    for field_key, value in panel_repeat_labels.REPEAT_FIELD_LABELS.items():
        owned_keys = {key for key in owned if key.endswith(f".{field_key}")}
        if owned_keys:
            assert f'"webformFields.{field_key}"' not in form_fields, (
                f"{field_key} 前端已经补齐了，把它从白名单删掉并改抄那里的措辞"
            )
            continue
        # 前缀匹配：复用的措辞可能带 `(Entry 1)` 这类条目后缀（同 FORM_FIELD_LABELS 那条）。
        assert f'"{value}' in everything, (field_key, value)

    # 白名单里不许留"已经用不到"的死条目（否则久了没人知道哪条还有效）。
    known = {
        f"{panel_repeat_labels.REPEAT_KEY_PREFIX}{group_key}"
        for group_key in panel_repeat_labels.REPEAT_GROUP_LABELS
    } | {
        f"{panel_repeat_labels.REPEAT_KEY_PREFIX}{group_key}.{field_key}"
        for group_key, group in ((group.key, group) for group in REPEATED_PROFILE_GROUPS)
        for field_key in (field.key for field in group.fields)
        if field_key in panel_repeat_labels.REPEAT_FIELD_LABELS
    }
    assert owned <= known, sorted(owned - known)
