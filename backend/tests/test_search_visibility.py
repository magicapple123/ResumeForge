# SPDX-License-Identifier: Apache-2.0
"""7-B 验收：全局搜索按「hidden ∪ private」裁字段（SQL 层，``json_each`` 路径）。

现象（问题清单 7-B）：资料里隐藏了某个字段，搜它的内容仍能搜到该条目；结果标题甚至
直接显示这个隐藏值。根因是搜索走存储层原始行（``json_each(ProfileEntry.values)``），
没接上消费层那份可见性判据。

这里钉住四条：
1. 隐藏字段的值 0 命中；同条目的可见字段照常命中，且**标题不显示隐藏值**；
2. 全部值都被隐藏的条目，在空关键词（纯空白）搜索里也不出现；
3. 私密字段（``credentials.credential_number``，判据取自 ``definition_catalog``）搜不到；
4. ``material_only`` **不算**不可搜索（仅素材 ≠ 不可搜索，别顺手扩大范围）。

判据唯一实现：``field_preferences.search_excluded_field_ids(db)`` = ``hidden ∪ private``。
"""

from __future__ import annotations

from app.models.profile_definition import ProfileCustomSection
from app.models.profile_entry import ProfileEntry
from app.services.profile import (
    definition_store,
    field_preferences,
    profile_reader,
)


def _add(db_session, row):
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row


def _entry(
    db_session,
    section_key: str,
    entry_id: str,
    values: dict[str, str],
    sort_order: int = 0,
) -> ProfileEntry:
    return _add(
        db_session,
        ProfileEntry(
            entry_id=entry_id,
            section_key=section_key,
            sort_order=sort_order,
            values=values,
        ),
    )


def _profile_hits(client, term: str) -> list[dict]:
    """只取「我的资料」域的命中（其余域与本问题无关）。"""
    data = client.get("/api/search", params={"q": term}).json()
    return [hit for hit in data["more"] if hit["type"] == "profile"]


# --- 1. 隐藏字段：搜不到；同条目可见字段照常命中；标题不显示隐藏值 ----------------------
def test_hidden_field_value_is_not_searchable(client, db_session):
    """一个隐藏字段 + 一个可见字段：隐藏值 0 命中，可见值 1 命中。"""
    field_preferences.patch_preference(db_session, "skills.name", section_key="skills", hidden=True)
    _entry(
        db_session,
        "skills",
        "entry-visibility-1",
        {"skills.name": "绝密技能名", "skills.level": "精通"},
    )

    hidden_hits = _profile_hits(client, "绝密技能名")
    visible_hits = _profile_hits(client, "精通")

    assert hidden_hits == []
    assert len(visible_hits) == 1
    assert visible_hits[0]["section_key"] == "skills"


def test_private_field_value_is_not_searchable(client, db_session):
    """私密字段（证书编号）搜不到，同条目的可见字段照常命中。

    判据来自 ``definition_catalog`` 的 private 标记，不是按字段名硬编码。
    """
    assert "credentials.credential_number" in field_preferences.search_excluded_field_ids(
        db_session
    )
    _entry(
        db_session,
        "credentials",
        "entry-credential-1",
        {
            "credentials.title": "注册会计师",
            "credentials.credential_number": "CPA-2026-000123",
        },
    )

    assert _profile_hits(client, "CPA-2026-000123") == []
    hits = _profile_hits(client, "注册会计师")
    assert [hit["section_key"] for hit in hits] == ["credentials"]


def test_title_skips_hidden_and_private_values(client, db_session):
    """标题取"第一个**可搜索**的非空值"：隐藏/私密键排在前面也不会被显示。"""
    field_preferences.patch_preference(
        db_session, "credentials.credential_type", section_key="credentials", hidden=True
    )
    _entry(
        db_session,
        "credentials",
        "entry-credential-title-1",
        {
            # 两个都是不可搜索值，且保存顺序在前。
            "credentials.credential_type": "职业资格",
            "credentials.credential_number": "CPA-2026-000123",
            "credentials.title": "注册会计师",
        },
    )

    hits = _profile_hits(client, "注册会计师")

    assert len(hits) == 1
    assert hits[0]["title"] == "注册会计师"


# --- 2. 空关键词（纯空白）：全是隐藏值的条目不出现 ------------------------------------
def test_entry_with_only_hidden_values_absent_from_blank_query(client, db_session):
    """与 ``_consume_entries`` 的"空壳条目按没数据处理"同口径。"""
    field_preferences.patch_preference(db_session, "skills.name", section_key="skills", hidden=True)
    # 全是隐藏值 → 视为没数据。
    _entry(db_session, "skills", "entry-shell-1", {"skills.name": "全是隐藏值"}, 0)
    # 有可见值 → 照常出现（空关键词搜索本身不做内容匹配）。
    _entry(
        db_session,
        "skills",
        "entry-visible-1",
        {"skills.name": "可见技能", "skills.level": "精通"},
        1,
    )

    hits = _profile_hits(client, " ")

    assert [hit["title"] for hit in hits] == ["精通"]


# --- 3. material_only 不参与判据 ------------------------------------------------------
def test_material_only_field_stays_searchable(client, db_session):
    """仅素材 = 不上纸面，但它的值仍进模型/网申 —— 搜索必须照旧命中。"""
    custom_section = _add(
        db_session,
        ProfileCustomSection(
            section_id="secv1", key="custom:secv1", name="竞赛资料", name_key="竞赛资料"
        ),
    )
    material = definition_store.create_custom_field(
        db_session, custom_section.key, "内部素材", "single_line", material_only=True
    )
    assert material.material_only is True
    _entry(db_session, custom_section.key, "entry-material-1", {material.field_id: "内部素材内容"})

    hits = _profile_hits(client, "内部素材内容")

    assert [hit["section_key"] for hit in hits] == [custom_section.key]


# --- 4. 同源：搜索判据与消费层共用一份 hidden -----------------------------------------
def test_search_and_consumption_share_one_hidden_judgement(client, db_session):
    """隐藏的字段在两侧同时消失：搜索搜不到，消费快照里也没有它的定义。"""
    field_preferences.patch_preference(db_session, "skills.name", section_key="skills", hidden=True)
    _entry(db_session, "skills", "entry-share-1", {"skills.name": "共用判据技能"})

    profile = profile_reader.load_all_consumed_profile(db_session)
    consumed_ids = {
        spec.field_id for section in profile.sections.values() for spec in section.fields
    }

    assert "skills.name" not in consumed_ids
    assert _profile_hits(client, "共用判据技能") == []
    assert "skills.name" in field_preferences.hidden_field_ids(db_session)


# --- 5. 同一条目里的三类字段一次对比（hidden / visible / private）---------------------
def test_one_entry_three_field_kinds(client, db_session):
    """一个隐藏字段 + 一个可见字段 + 一个 private 字段，同条目的三条搜索结论。"""
    field_preferences.patch_preference(
        db_session, "credentials.credential_type", section_key="credentials", hidden=True
    )
    _entry(
        db_session,
        "credentials",
        "entry-mixed-1",
        {
            "credentials.credential_number": "CPA-2026-000123",  # private（目录定义）
            "credentials.credential_type": "职业资格",  # 用户隐藏
            "credentials.title": "注册会计师",  # 可见
        },
    )

    observed = {
        term: [hit["title"] for hit in _profile_hits(client, term)]
        for term in ("CPA-2026-000123", "职业资格", "注册会计师")
    }
    print("observed:", observed)  # 证据：-s 时可见

    assert observed == {
        "CPA-2026-000123": [],  # private 字段值：0 命中
        "职业资格": [],  # 隐藏字段值：0 命中
        "注册会计师": ["注册会计师"],  # 可见字段值：1 命中，标题只用可见值
    }
