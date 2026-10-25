# SPDX-License-Identifier: Apache-2.0
"""F5 / 验收 D 与 H：网申三处取数"只按当前组裁剪简历侧"，专用项不受组过滤。

覆盖 F5 契约 §2 与需求 v3 R-38/R-39/R-40/R-41：
1. 组内简历侧：当前组不含实习/工作经历时，data 里没有任何实习派生键（company /
   experience_1_company / work_start…）；组包含时这些键出现（切组后填入）。未参与分区
   在 defined_fields 的数据层就不存在（消费 DTO 已裁剪），不是靠下游过滤。
2. 同源：data / catalog / custom_labels 由同一次遍历产生——自定义字段与无网申目录键的
   默认字段以 CUSTOM_<field_id> 出现且带同一标签，人工清单行与 data 相邻可对照。
3. 专用项例外：网申专用来源（旧 user_profile 专用列 + 「网申资料」）不参与组过滤，
   组只含基本信息时 wechat / height 等仍然取得到（R-39）。
4. 私密红线（验收 H / R-40）：证书编号在 data / catalog / custom_labels 三处都不出现。
5. 与 F1/F2 的真实集成：用 HTTP 建条目/组并切当前组，再走真实 resolver + reader 的
   网申快照，验证"当前组不含实习 → 空；切回默认组 → 填入"（不依赖任何桩）。

不跑真实库；本地 pytest 必须带 -p rf_pytest_bootstrap（F5 契约 §6）。
"""

import json

from app.models.profile import UserProfile
from app.models.web_form_profile import WebFormProfileEntry
from app.schemas.profile_projection import (
    ConsumedEntry,
    ConsumedFieldSpec,
    ConsumedProfile,
    ConsumedSection,
)
from app.services.webform.data import defined_fields, profile_snapshot

_BASIC_FIELDS = (
    ConsumedFieldSpec("basic_info.name", "name", "姓名", "single_line", 1, True, True, False, True),
    ConsumedFieldSpec(
        "basic_info.political_status",
        "political_status",
        "政治面貌",
        "single_line",
        2,
        True,
        True,
        False,
        True,
    ),
)
_EXPERIENCE_FIELDS = (
    ConsumedFieldSpec(
        "experiences.company", "company", "公司/机构", "single_line", 1, True, True, False, True
    ),
    ConsumedFieldSpec(
        "experiences.title", "title", "职位/角色", "single_line", 2, True, True, False, True
    ),
    ConsumedFieldSpec(
        "experiences.start_date", "start_date", "开始时间", "date_text", 3, True, True, False, True
    ),
    ConsumedFieldSpec(
        "experiences.end_date", "end_date", "结束时间", "date_text", 4, True, True, False, True
    ),
)
_PROJECT_FIELDS = (
    ConsumedFieldSpec(
        "projects.name", "name", "项目名称", "single_line", 1, True, True, False, True
    ),
    ConsumedFieldSpec(
        "projects.project_size",
        "project_size",
        "项目规模",
        "single_line",
        2,
        True,
        True,
        False,
        True,
    ),
    ConsumedFieldSpec(
        "custom-partner", "custom-partner", "合作方", "single_line", 3, True, True, False, False
    ),
)
_CREDENTIAL_FIELDS = (
    ConsumedFieldSpec(
        "credentials.title", "title", "证书名称", "single_line", 1, True, True, False, True
    ),
    ConsumedFieldSpec(
        "credentials.credential_number",
        "credential_number",
        "证书编号",
        "single_line",
        2,
        False,
        False,
        True,
        True,
    ),
)


def _entry(entry_id: str, sort_order: int, values: dict[str, str]) -> ConsumedEntry:
    return ConsumedEntry(entry_id=entry_id, sort_order=sort_order, values=dict(values))


def _section(
    key: str,
    name: str,
    *,
    form: str,
    fields: tuple[ConsumedFieldSpec, ...],
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


def _profile(sections: dict[str, ConsumedSection]) -> ConsumedProfile:
    keys = tuple(sections)
    return ConsumedProfile(
        group_id="g-1",
        group_name="默认组",
        is_default=True,
        participating_keys=keys,
        section_order=keys,
        workspace_revision=1,
        sections=dict(sections),
    )


def _full_profile() -> ConsumedProfile:
    return _profile(
        {
            "basic_info": _section(
                "basic_info",
                "基本信息",
                form="singleton",
                fields=_BASIC_FIELDS,
                entries=(_entry("e-basic", 0, {"basic_info.name": "张三"}),),
            ),
            "experiences": _section(
                "experiences",
                "实习/工作经历",
                form="multi",
                fields=_EXPERIENCE_FIELDS,
                entries=(
                    _entry(
                        "e-exp",
                        0,
                        {
                            "experiences.company": "简历公司",
                            "experiences.title": "后端实习生",
                            "experiences.start_date": "2024-07",
                            "experiences.end_date": "2024-09",
                        },
                    ),
                ),
            ),
        }
    )


def test_group_without_experiences_has_no_experience_keys():
    """D：当前组不含实习/工作经历 → data 里整键不出现（不是空字符串占位）。"""
    full = defined_fields.data_from_consumed(_full_profile())
    filtered = defined_fields.data_from_consumed(
        _profile({"basic_info": _full_profile().sections["basic_info"]})
    )

    assert full["company"] == "简历公司" and full["experience_1_company"] == "简历公司"
    assert full["job_title"] == "后端实习生"
    for key in ("company", "job_title", "work_start", "work_end", "experience_1_company"):
        assert key not in filtered
    assert filtered["name"] == "张三"


def test_data_catalog_and_custom_labels_share_one_traversal():
    """R-16：三份输出同源——自定义字段与无目录键默认字段都以 CUSTOM_ 出现且标签同源。"""
    profile = _profile(
        {
            "projects": _section(
                "projects",
                "项目经历",
                form="multi",
                fields=_PROJECT_FIELDS,
                entries=(
                    _entry(
                        "e-proj",
                        0,
                        {
                            "projects.name": "推荐系统",
                            "projects.project_size": "10 人",
                            "custom-partner": "合作方A",
                        },
                    ),
                ),
            )
        }
    )

    built = defined_fields.build_defined_fields(profile, job_title="AI 应用开发")

    assert built.data["project_1_name"] == "推荐系统"
    assert built.data["CUSTOM_custom-partner"] == "合作方A"
    assert built.data["CUSTOM_projects.project_size"] == "10 人"
    assert built.custom_labels["CUSTOM_custom-partner"] == "合作方"
    assert built.custom_labels["CUSTOM_projects.project_size"] == "项目规模"
    # 清单行与 data 用同一个 key，人工挑选与整页预填不会出现"两套字段名"。
    catalog_keys = {row["key"] for row in built.catalog}
    assert {"CUSTOM_custom-partner", "CUSTOM_projects.project_size"} <= catalog_keys
    custom_catalog = next(row for row in built.catalog if row["key"] == "CUSTOM_custom-partner")
    assert custom_catalog["label"] == "合作方" and custom_catalog["value"] == "合作方A"


def test_private_credential_number_never_leaks_to_any_output():
    """H / R-40：证书编号是本地私密字段，data/catalog/custom_labels 三处都不出现。"""
    secret = "SECRET-CRED-9527"
    profile = _profile(
        {
            "credentials": _section(
                "credentials",
                "证书资质",
                form="multi",
                fields=_CREDENTIAL_FIELDS,
                entries=(
                    _entry(
                        "e-cred",
                        0,
                        {
                            "credentials.title": "信息系统项目管理师",
                            "credentials.credential_number": secret,
                        },
                    ),
                ),
            )
        }
    )

    built = defined_fields.build_defined_fields(profile)
    dumped = json.dumps(
        {"data": built.data, "catalog": built.catalog, "labels": built.custom_labels},
        ensure_ascii=False,
    )

    assert secret not in dumped
    assert "credential_number" not in dumped
    # 非私密的证书名称照常可填（职业资格证书规范键 + CUSTOM_ 行）。
    assert "信息系统项目管理师" in built.data.get("professional_cert", "")


def test_webform_forbidden_field_is_excluded_from_the_same_source():
    profile = _profile(
        {
            "projects": _section(
                "projects",
                "项目经历",
                form="multi",
                fields=(
                    ConsumedFieldSpec(
                        "projects.name",
                        "name",
                        "项目名称",
                        "single_line",
                        1,
                        True,
                        False,
                        False,
                        True,
                    ),
                ),
                entries=(_entry("e-proj", 0, {"projects.name": "不参与网申"}),),
            )
        }
    )

    built = defined_fields.build_defined_fields(profile)

    assert built.data == {}
    assert built.catalog == ()


def test_webform_snapshot_end_to_end_follows_current_group(client, db_session):
    """D 集成：HTTP 建条目与组 → 真实 group_scope/profile_reader 的快照按当前组裁剪。"""
    basic = client.post(
        "/api/profile/sections/basic_info/entries",
        json={
            "values": {
                "basic_info.name": "张三",
                "basic_info.political_status": "中共党员",
            }
        },
    )
    assert basic.status_code == 201, basic.text
    experience = client.post(
        "/api/profile/sections/experiences/entries",
        json={
            "values": {
                "experiences.company": "简历公司",
                "experiences.title": "后端实习生",
            }
        },
    )
    assert experience.status_code == 201, experience.text

    # 网申专用来源：旧 user_profile 专用列（微信）与「网申资料」（身高）都不受组过滤。
    db_session.add(UserProfile(wechat="wx-end2end", political_status="群众"))
    db_session.add(WebFormProfileEntry(field_key="height", value="178"))
    db_session.commit()

    listing = client.get("/api/profile/groups").json()
    default_id = listing["default_group_id"]
    group = client.post("/api/profile/groups", json={"name": "应届生"}).json()
    members = client.put(
        f"/api/profile/groups/{group['group_id']}/members",
        json={"section_keys": ["projects", "educations"], "expected_revision": group["revision"]},
    )
    assert members.status_code == 200, members.text
    switched = client.put(
        "/api/profile/current-group",
        json={
            "group_id": group["group_id"],
            "expected_revision": listing["workspace_revision"],
        },
    )
    assert switched.status_code == 200, switched.text

    db_session.rollback()
    filtered_snapshot = profile_snapshot.load_webform_profile_snapshot(db_session)
    filtered_data, warnings = profile_snapshot.snapshot_form_data(filtered_snapshot)

    assert filtered_snapshot.consumed.group_name == "应届生"
    # 当前组不含实习/工作经历 → 整键不出现。
    assert "company" not in filtered_data and "experience_1_company" not in filtered_data
    # R-39：专用项不受组过滤；height 来自「网申资料」，wechat 来自旧专用列。
    assert filtered_data["wechat"] == "wx-end2end"
    assert filtered_data["height"] == "178"
    # R-75：新基本条目显式写入政治面貌后覆盖旧专用列值。
    assert filtered_data["political_status"] == "中共党员"
    assert warnings == ()

    # 切回默认组（13 项）→ 实习字段重新出现（验收 D 的"切组后填入"）。
    current = client.get("/api/profile/groups").json()
    back = client.put(
        "/api/profile/current-group",
        json={"group_id": default_id, "expected_revision": current["workspace_revision"]},
    )
    assert back.status_code == 200, back.text
    db_session.rollback()
    full_snapshot = profile_snapshot.load_webform_profile_snapshot(db_session)
    full_data, _warnings = profile_snapshot.snapshot_form_data(full_snapshot)

    assert full_data["company"] == "简历公司"
    assert full_data["experience_1_company"] == "简历公司"
