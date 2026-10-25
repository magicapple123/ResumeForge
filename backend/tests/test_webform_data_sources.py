# SPDX-License-Identifier: Apache-2.0
"""网申取数的源端合并：网申资料、一次性档位与自定义标签别名。

F5 契约 §5 要求把"资料展开"与"源端合并"分开测（原 test_webform_data.py 516 行拆分）：
本文件只管合并层——简历侧来自新模型（组内消费 DTO），另外两三层来源是「网申资料」
（web_form_profile_entry）与网申自有补充记录。历史档位（once/scenario/general）只影响
展示，不改变"能否取到"；自定义标签只有唯一精确映射时才允许映射到预设字段。
"""

from app.models.web_form_profile import REUSE_ONCE, WebFormProfileEntry
from app.services.profile import entry_store
from app.services.webform.data import build_catalog, build_form_data, build_live_form_data


def _seed_basic(db, name: str = "李四") -> None:
    entry_store.upsert_entry(db, "basic_info", values={"basic_info.name": name})


def test_batch_and_live_both_include_all_saved_webform_entries(db_session):
    _seed_basic(db_session)
    db_session.add(WebFormProfileEntry(field_key="referral_code", value="ABC123", reuse=REUSE_ONCE))
    db_session.commit()

    batch = build_form_data(db_session)
    live = build_live_form_data(db_session)

    assert batch["referral_code"] == "ABC123"
    assert live["referral_code"] == "ABC123"
    assert batch["name"] == "李四"


def test_extra_profile_values_ride_alongside_the_resume_profile(db_session):
    _seed_basic(db_session)
    db_session.add(WebFormProfileEntry(field_key="student_id", value="2022012345"))
    db_session.commit()

    data = build_form_data(db_session)

    assert data["student_id"] == "2022012345"
    assert data["name"] == "李四"


def test_live_form_data_maps_an_exact_custom_label_to_its_webform_field(db_session):
    db_session.add(
        WebFormProfileEntry(
            field_key="CUSTOM_内推码推荐人",
            value="345354543",
            label=" 内推码 ／ 推荐人 ",
        )
    )
    db_session.commit()

    live_data = build_live_form_data(db_session)

    assert live_data["CUSTOM_内推码推荐人"] == "345354543"
    assert live_data["referral_code"] == "345354543"
    assert build_form_data(db_session)["referral_code"] == "345354543"


def test_live_form_data_prefers_the_existing_preset_value_over_a_custom_label(db_session):
    db_session.add_all(
        [
            WebFormProfileEntry(field_key="referral_code", value="PRESET123"),
            WebFormProfileEntry(
                field_key="CUSTOM_内推码推荐人",
                value="CUSTOM456",
                label="内推码/推荐人",
            ),
        ]
    )
    db_session.commit()

    assert build_live_form_data(db_session)["referral_code"] == "PRESET123"


def test_live_form_data_does_not_alias_ambiguous_custom_labels(db_session):
    db_session.add_all(
        [
            WebFormProfileEntry(
                field_key="CUSTOM_referral_one", value="111", label="内推码/推荐人"
            ),
            WebFormProfileEntry(
                field_key="CUSTOM_referral_two", value="222", label="内推码 / 推荐人"
            ),
        ]
    )
    db_session.commit()

    assert "referral_code" not in build_live_form_data(db_session)


def test_live_form_data_maps_custom_label_when_the_field_label_is_also_a_synonym(db_session):
    """回归守卫：salary 的 label「期望薪资」同时在自己的同义词表里，唯一性按字段去重。"""
    db_session.add(WebFormProfileEntry(field_key="CUSTOM_期望薪资", value="25k", label="期望薪资"))
    db_session.commit()

    assert build_live_form_data(db_session)["salary"] == "25k"


def test_live_form_data_does_not_alias_when_two_custom_fields_share_a_standard_label(db_session):
    db_session.add_all(
        [
            WebFormProfileEntry(field_key="CUSTOM_salary_one", value="25k", label="期望薪资"),
            WebFormProfileEntry(field_key="CUSTOM_salary_two", value="30k", label="期望薪资"),
        ]
    )
    db_session.commit()

    assert "salary" not in build_live_form_data(db_session)


def test_live_form_data_keeps_the_preset_standard_value_over_a_same_named_custom_field(db_session):
    db_session.add_all(
        [
            WebFormProfileEntry(field_key="salary", value="30k"),
            WebFormProfileEntry(field_key="CUSTOM_期望薪资", value="25k", label="期望薪资"),
        ]
    )
    db_session.commit()

    assert build_live_form_data(db_session)["salary"] == "30k"


def test_batch_also_maps_unique_custom_labels(db_session):
    """批量预填沿用旧的唯一标签映射；实时别名是额外一层，二者都只认唯一精确标签。"""
    db_session.add(WebFormProfileEntry(field_key="CUSTOM_期望薪资", value="25k", label="期望薪资"))
    db_session.commit()

    assert build_form_data(db_session)["salary"] == "25k"


def test_catalog_includes_webform_extra_rows_with_source_extra(db_session):
    _seed_basic(db_session)
    db_session.add(WebFormProfileEntry(field_key="student_id", value="2022012345"))
    db_session.commit()

    catalog = build_catalog(db_session)
    row = next(item for item in catalog if item["key"] == "student_id")

    assert row["value"] == "2022012345"
    assert row["source"] == "extra"
