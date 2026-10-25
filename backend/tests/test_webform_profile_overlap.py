# SPDX-License-Identifier: Apache-2.0
"""F5 / 验收 M：网申重叠字段（R-75）的取值、来源标注与不复活旧值。

覆盖需求 v3 R-75 与 F5 契约 §3：① 政治面貌新资料显式写入即接管、只有网申旧来源时读旧值
并标注来源、显式清空不复活；② 出生日期保留日精度、资料侧只有年月不伪造日、覆盖时给 warning；
③ 导师/研究方向取全量新教育最近一段（进行中优先 → 可解析结束时间 → 开始时间 → 显式序号，
不可解析不猜），为空才回落网申单值，不因教育未入组消失；④ 快照把组内简历侧 + 网申专用项 +
重叠值合成网申 data，读路径不写库。夹具用内存消费 DTO（不依赖 F2 并行交付的读取层），
另有一条走真实 DB 验证网申专用来源；不跑真实库。
"""

from app.models.profile import UserProfile
from app.models.web_form_profile import WebFormProfileEntry
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.webform.data import overlap_values, profile_snapshot

ONGOING = "至今"


def _spec(
    field_id: str,
    label: str,
    field_type: str = "single_line",
    *,
    webform_allowed: bool = True,
    private: bool = False,
) -> ConsumedFieldSpec:
    return ConsumedFieldSpec(
        field_id=field_id,
        key=field_id.split(".")[-1],
        label=label,
        field_type=field_type,
        order=0,
        llm_allowed=True,
        webform_allowed=webform_allowed,
        private=private,
        is_builtin=True,
    )


def _entry(entry_id: str, sort_order: int, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=sort_order, values=dict(values))


def _section(
    key: str,
    name: str,
    *,
    form: str = "multi",
    fields: tuple[ConsumedFieldSpec, ...] = (),
    entries: tuple[ConsumedEntry, ...] = (),
) -> ConsumedSection:
    return ConsumedSection(
        key=key,
        name=name,
        form=form,
        carrier_field_id=None,
        material_only=False,
        primary_field_id=None,
        fields=fields,
        entries=entries,
    )


def _profile(
    sections: dict[str, ConsumedSection],
    participating: tuple[str, ...] | None = None,
) -> ConsumedProfile:
    keys = participating if participating is not None else tuple(sections)
    return ConsumedProfile(
        group_id="g-default",
        group_name="默认组",
        is_default=True,
        participating_keys=keys,
        section_order=keys,
        workspace_revision=1,
        sections=dict(sections),
    )


_BASIC_FIELDS = (
    _spec("basic_info.name", "姓名"),
    _spec("basic_info.political_status", "政治面貌"),
    _spec("basic_info.birth_month", "出生年月", "date_text"),
)
_EDUCATION_FIELDS = (
    _spec("educations.school", "学校"),
    _spec("educations.advisor", "导师"),
    _spec("educations.research_direction", "研究方向"),
    _spec("educations.start_date", "开始时间", "date_text"),
    _spec("educations.end_date", "结束时间", "date_text"),
)


def _basic(values: dict[str, str]) -> ConsumedSection:
    return _section(
        "basic_info",
        "基本信息",
        form="singleton",
        fields=_BASIC_FIELDS,
        entries=(_entry("entry-basic", 0, values),),
    )


def _education(
    entry_id: str,
    sort_order: int,
    *,
    school: str = "",
    advisor: str = "",
    research: str = "",
    start: str = "",
    end: str = "",
) -> ConsumedEntry:
    return _entry(
        entry_id,
        sort_order,
        {
            "educations.school": school,
            "educations.advisor": advisor,
            "educations.research_direction": research,
            "educations.start_date": start,
            "educations.end_date": end,
        },
    )


def _educations(*entries: ConsumedEntry) -> ConsumedSection:
    return _section("educations", "教育经历", fields=_EDUCATION_FIELDS, entries=entries)


# ===== R-75 规则 1：政治面貌 =====


def test_profile_political_status_takes_over_and_annotates_source():
    """资料页改政治面貌 → 网申即见，且来源标注为我的资料（不是旧网申值）。"""
    consumed = _profile({"basic_info": _basic({"basic_info.political_status": "中共党员"})})

    resolved = overlap_values.resolve_political_status(consumed, {"political_status": "群众"})

    assert resolved.value == "中共党员"
    assert resolved.source == "profile"
    assert "基本信息" in resolved.source_detail


def test_political_status_falls_back_to_webform_source_before_takeover():
    """新模型还没有该值时读既有网申专用来源，并标注来源（不复制成新资料）。"""
    consumed = _profile({"basic_info": _basic({"basic_info.name": "张三"})})

    resolved = overlap_values.resolve_political_status(consumed, {"political_status": "群众"})

    assert (resolved.value, resolved.source) == ("群众", "webform")
    assert resolved.source_detail == "网申资料"


def test_explicit_empty_political_status_does_not_resurrect_webform_value():
    """显式清空时以空为准，不回落旧值（否则用户清掉的政治面貌会自己回来）。"""
    consumed = _profile({"basic_info": _basic({"basic_info.political_status": ""})})
    resolved = overlap_values.resolve_overlap_values(
        consumed, consumed, {"political_status": "群众"}
    )

    data, warnings = overlap_values.apply_overlap_values({"political_status": "群众"}, resolved)

    assert resolved["political_status"].value == ""
    assert "political_status" not in data
    assert not warnings


# ===== R-75 规则 3：导师 / 研究方向 =====


def test_recent_education_supplies_advisor_and_annotates_which_record():
    """两条教育不同导师：取最近一段（结束时间最大）并标注具体教育条目。"""
    all_consumed = _profile(
        {
            "educations": _educations(
                _education("e1", 0, school="第一大学", advisor="王老师", end="2022-06"),
                _education("e2", 1, school="第二大学", advisor="李老师", end="2025-06"),
            )
        }
    )

    resolved = overlap_values.resolve_education_values(
        all_consumed, {"advisor": "网申王", "research_direction": "网申方向"}
    )

    assert (resolved["advisor"].value, resolved["advisor"].source) == ("李老师", "education")
    assert "教育经历 2" in resolved["advisor"].source_detail
    assert "第二大学" in resolved["advisor"].source_detail
    # 最近这段没有研究方向 → 回落网申单值（空值才回落）。
    assert (resolved["research_direction"].value, resolved["research_direction"].source) == (
        "网申方向",
        "webform",
    )


def test_ongoing_education_wins_over_a_later_end_date():
    all_consumed = _profile(
        {
            "educations": _educations(
                _education(
                    "e1", 0, school="清华", advisor="在读导师", start="2023-09", end=ONGOING
                ),
                _education("e2", 1, school="北大", advisor="毕业导师", end="2025-12"),
            )
        }
    )

    resolved = overlap_values.resolve_education_values(all_consumed, {})

    assert resolved["advisor"].value == "在读导师"


def test_unparseable_dates_are_not_guessed_and_explicit_order_is_used():
    """结束/开始都不可解析时按显式条目序号兜底，不猜日期。"""
    all_consumed = _profile(
        {
            "educations": _educations(
                _education("e1", 0, school="甲大学", advisor="甲导师", start="待定", end="未知"),
                _education("e2", 1, school="乙大学", advisor="乙导师", start="?"),
            )
        }
    )

    selected = overlap_values.select_recent_education(all_consumed)
    resolved = overlap_values.resolve_education_values(all_consumed, {})

    assert selected is not None and selected.position == 1
    assert resolved["advisor"].value == "甲导师"


def test_education_overlap_survives_when_the_group_excludes_educations():
    """导师/研究方向是网申专用输出：教育未入当前组也要从全量新教育里取到。"""
    consumed = _profile({"basic_info": _basic({})}, participating=("basic_info",))
    all_consumed = _profile(
        {
            "basic_info": _basic({}),
            "educations": _educations(
                _education("e1", 0, school="某大学", advisor="张老师", research="自然语言处理")
            ),
        }
    )

    resolved = overlap_values.resolve_overlap_values(consumed, all_consumed, {})

    assert resolved["advisor"].value == "张老师"
    assert resolved["research_direction"].value == "自然语言处理"
    # 不顺带恢复教育与简历侧派生字段：当前组只有基本信息。
    assert "educations" not in consumed.sections


# ===== R-75 规则 2：出生日期精度 =====


def test_birth_date_day_precision_is_kept_when_month_matches():
    consumed = _profile({"basic_info": _basic({"basic_info.birth_month": "1999-03"})})

    resolved = overlap_values.resolve_birth_values(consumed, {"birth_date": "1999-03-15"})

    assert resolved["birth_date"].value == "1999-03-15"
    assert resolved["birth_date"].source == "webform"
    assert resolved["birth_year"].value == "1999"
    assert not resolved["birth_date"].warning


def test_birth_month_without_webform_date_never_fabricates_a_day():
    consumed = _profile({"basic_info": _basic({"basic_info.birth_month": "2000-07"})})

    resolved = overlap_values.resolve_birth_values(consumed, {})

    assert resolved["birth_date"].value == "2000-07"  # 不伪造 -01 之类的日
    assert resolved["birth_year"].value == "2000"
    assert not resolved["birth_date"].warning


def test_overriding_a_full_webform_date_warns_about_lost_day_precision():
    """资料侧年月覆盖网申完整日期：以资料为准，但日精度丢失必须如实提示。"""
    consumed = _profile({"basic_info": _basic({"basic_info.birth_month": "2000-01"})})

    resolved = overlap_values.resolve_birth_values(consumed, {"birth_date": "1999-03-15"})

    assert resolved["birth_date"].value == "2000-01"
    assert resolved["birth_date"].source == "profile"
    assert "日精度" in resolved["birth_date"].warning


# ===== 快照合成：专用项不受组过滤 + 重叠值覆盖 =====


def test_snapshot_form_data_merges_dedicated_items_and_overlap_values():
    consumed = _profile(
        {
            "basic_info": _basic(
                {"basic_info.name": "张三", "basic_info.political_status": "中共党员"}
            ),
            "educations": _educations(_education("e1", 0, school="某大学", advisor="李老师")),
        },
        participating=("basic_info", "educations"),
    )
    all_consumed = consumed
    snapshot = profile_snapshot.snapshot_from_profiles(
        consumed,
        all_consumed,
        {
            "wechat": "wx-001",  # 网申专用项：不参与组过滤
            "family_info": "父亲/母亲",
            "political_status": "群众",  # 旧网申值应被新资料显式值覆盖
        },
    )

    data, warnings = profile_snapshot.snapshot_form_data(snapshot, job_title="AI 应用开发")

    assert data["wechat"] == "wx-001"
    assert data["family_info"] == "父亲/母亲"
    assert data["political_status"] == "中共党员"
    assert data["advisor"] == "李老师"
    assert data["job_intent"] == "AI 应用开发"
    assert snapshot.warnings() == warnings == ()


def test_load_snapshot_reads_webform_source_from_db_without_writing(db_session):
    """反向改：网申侧保存的政治面貌 → 网申取数即见；读路径不写任何行。"""
    db_session.add(UserProfile(political_status="群众", wechat="wx-legacy", expected_salary="20k"))
    db_session.add(WebFormProfileEntry(field_key="political_status", value="共青团员"))
    db_session.commit()
    consumed = _profile({"basic_info": _basic({"basic_info.name": "张三"})})

    snapshot = profile_snapshot.load_webform_profile_snapshot(
        db_session,
        scope_loader=lambda _db: object(),
        consumed_loader=lambda _db, _scope: consumed,
        all_consumed_loader=lambda _db: consumed,
    )

    # 旧专用列照样只读可用（微信），且「网申资料」新表的政治面貌覆盖旧列值。
    assert snapshot.webform_extra["wechat"] == "wx-legacy"
    assert snapshot.webform_extra["salary"] == "20k"
    assert snapshot.overlaps["political_status"].value == "共青团员"
    assert snapshot.overlaps["political_status"].source == "webform"
    data, _warnings = profile_snapshot.snapshot_form_data(snapshot)
    assert data["political_status"] == "共青团员"

    db_session.rollback()
    assert db_session.query(WebFormProfileEntry).count() == 1
    assert db_session.query(UserProfile).count() == 1
