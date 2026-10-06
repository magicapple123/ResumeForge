"""「网申资料」的读写与**边界**。

这个文件里最重要的一条不是读写本身，而是
``test_the_resume_generation_path_never_sees_this_table``：用户的原话要求是"生成简历模块
默认不读这里的信息"。那不是一句约定——它由"独立一张表 + 简历生成只读 ``UserProfile``"
保证。这条测试**真的去调用简历生成那条路径的取数入口**并断言看不到，因为一旦有人把它并进
``to_profile_out``（看起来是"顺手统一一下"），失败方式是**静默的**：简历里会多出四六级分数、
身高、父母工作单位，而没有任何报错。

本文件是主文件（目录契约、CRUD 往返与"网申读得到、简历读不到"边界）；学习提案/学到的
在 ``test_webform_extra_profile_learn.py``，remember 与自定义字段读写
在 ``test_webform_extra_profile_remember.py``，记忆目标在
``test_webform_extra_profile_memory_target.py``。
"""
from __future__ import annotations

from app.models.profile import UserProfile
from app.services.webform import extra_profile
from app.services.webform.data import build_form_data, profile_to_form_data
from app.services.webform.fields import FORM_FIELDS, SOURCE_EXTRA


def _seed_profile(db) -> None:
    db.add(UserProfile(name="张三", phone="13800000000", city="天津"))
    db.commit()


def _string_values(node) -> list[str]:
    """把序列化结果里**所有字符串值**递归摊平。

    **不要在整份 ``repr`` 上做子串搜索。** 那份 repr 里含 ``updated_at`` 的微秒
    （``datetime(2026, 9, 28, 11, 47, 2, 646937)``），于是像 ``"65"`` ``"178"`` 这种
    短数字会**偶发地撞进去**——这条隐私边界测试因此随机变红过（实测几次全量里中一次）。
    假红比不测更糟：它训练人忽略这条测试，而这条恰恰是不该被忽略的。

    只比对"值"：字段名用 ``key not in profile`` 单独查，也不必做子串搜索。
    """
    if isinstance(node, str):
        return [node]
    if isinstance(node, dict):
        return [v for item in node.values() for v in _string_values(item)]
    if isinstance(node, (list, tuple, set)):
        return [v for item in node for v in _string_values(item)]
    return []


def test_extra_field_keys_are_exactly_the_catalog_extras():
    """写入白名单与目录必须一致——目录改了这里没改，就会出现"填了存不进去"。"""
    from app.services.webform.fields import SOURCE_PROFILE

    expected = {field.key for field in FORM_FIELDS if field.source == SOURCE_EXTRA}
    assert expected == extra_profile.EXTRA_FIELD_KEYS
    # 而且这批与"从简历资料取值"的那批**不相交**：同一个字段不该有两个来源。
    profile_keys = {field.key for field in FORM_FIELDS if field.source == SOURCE_PROFILE}
    assert not (expected & profile_keys)


def test_the_extras_cover_the_common_chinese_web_form_columns():
    """目录要覆盖中国校招网申常问、而简历里没有的那些栏目。

    不详尽的话用户还是得每次现找——那正是这个分区要解决的问题。这里按**类**抽查，
    不逐个钉字段名（字段增删是常事，类别才是这份清单的承诺）。
    """
    keys = extra_profile.EXTRA_FIELD_KEYS

    # 学籍与派遣：校招网申几乎必问，简历上从不出现。
    assert {"student_id", "training_mode", "archives_location"} <= keys
    # 家庭与紧急联系人：国企/银行/公务员类要（政审、背调、亲属回避）。
    assert {"emergency_contact_name", "emergency_contact_phone"} <= keys
    for removed in (
        "relative_in_company",
        "driver_license",
        "is_fresh_graduate",
        "is_activist",
        "color_blind",
        "accept_adjustment",
        "accept_travel",
        "integrity_record",
        "military_service",
    ):
        assert removed not in keys
    # 党团与健康：国企/事业单位/公务员的硬性栏目。
    assert {"party_join_date", "height", "eyesight"} <= keys
    # 意向：仍保留可到岗时间，所有“是否”类字段不再进入目录。
    assert "available_date" in keys


def test_sensitive_extras_are_flagged():
    """含他人信息与健康隐私的项必须标出来——界面据此提示"只存本机"。"""
    by_key = {field.key: field for field in FORM_FIELDS}
    for key in (
        "emergency_contact_name",
        "emergency_contact_phone",
        "father_name",
        "mother_name",
        "home_address",
        "party_join_date",
        "height",
        "weight",
        "eyesight",
        "medical_history",
        ):
        assert by_key[key].sensitive, f"{key} 含他人信息或健康隐私，应标 sensitive"


def test_save_then_list_round_trips(db_session):
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"student_id": "2022012345", "rank_position": "5", "height": "178"},
    )

    assert extra_profile.list_entries(db_session) == {
        "student_id": "2022012345",
        "rank_position": "5",
        "height": "178",
    }


def test_save_is_a_full_overwrite(db_session):
    """整份覆盖：没提到的 key 被删除。

    这一屏就是「网申资料」的全部，所以用户清空一格时**删除**才是他要的语义——否则那张
    空值会一直躺在库里。
    """
    extra_profile.save_entries(db_session, {"student_id": "2022012345", "height": "178"})
    extra_profile.save_entries(db_session, {"student_id": "2022012345"})

    assert extra_profile.list_entries(db_session) == {"student_id": "2022012345"}


def test_empty_values_are_not_stored(db_session):
    """"没有这一项"与"这一项是空的"在这里是同一件事——空值不落库。"""
    extra_profile.save_entries(db_session, {"student_id": "", "height": "   "})

    assert extra_profile.list_entries(db_session) == {}


def test_unknown_keys_are_dropped_without_failing_the_save(db_session):
    """目录外的键直接丢弃，**不让整次保存失败**——前端多传一个键不该白填一屏。"""
    extra_profile.save_entries(
        db_session, {"student_id": "2022012345", "not_a_real_key": "x"}
    )

    assert extra_profile.list_entries(db_session) == {"student_id": "2022012345"}


def test_values_are_trimmed_and_capped(db_session):
    extra_profile.save_entries(
        db_session,
        {"student_id": "  2022012345  ", "specialty": "x" * (extra_profile.MAX_VALUE_CHARS + 50)},
    )

    stored = extra_profile.list_entries(db_session)
    assert stored["student_id"] == "2022012345"
    assert len(stored["specialty"]) == extra_profile.MAX_VALUE_CHARS


def test_stale_rows_outside_the_catalog_are_not_returned(db_session):
    """目录删掉某个字段后，库里那条旧值不该再被读出来。

    否则它会填进一个我们已经不认识的字段——而"认不认识"由目录说了算。
    """
    from app.models.web_form_profile import WebFormProfileEntry

    extra_profile.save_entries(db_session, {"student_id": "2022012345"})
    db_session.add(WebFormProfileEntry(field_key="a_field_we_removed", value="旧值"))
    db_session.commit()

    assert "a_field_we_removed" not in extra_profile.list_entries(db_session)


# ===== 边界：网申读得到、简历读不到 =====


def test_build_form_data_merges_the_extras_in(db_session):
    """网申填表的取数入口要能看到这批资料——不然录了也白录。"""
    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"student_id": "2022012345"})

    data = build_form_data(db_session)

    assert data["student_id"] == "2022012345"
    # 简历资料那部分照旧在（合并不是替换）。
    assert data["name"] == "张三"


def test_the_resume_generation_path_never_sees_this_table(db_session):
    """**最关键的一条**：生成简历那条链路读不到「网申资料」。

    简历生成走的是 ``get_profile_detail()`` → ``UserProfile``（见
    ``resume/resume_generate_runner.py``），不经过 ``build_form_data``。所以只要这张表是
    独立的、只要没人把它并进 ``to_profile_out``，用户要求的那条边界就成立。

    断言的是**整份资料序列化之后**的内容——如果有人把它并进去，值会出现在这里。
    """
    from app.services.profile.profile_service import get_profile_detail, to_profile_out

    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {
            "student_id": "2022012345",
            "rank_position": "5",
            "emergency_contact_phone": "13900000000",
            "height": "178",
        },
    )

    profile = to_profile_out(get_profile_detail(db_session)).model_dump()
    strings = _string_values(profile)

    for value in ("2022012345", "13900000000", "178"):
        assert value not in strings, (
            f"「网申资料」的值 {value!r} 出现在了简历资料里——"
            "生成简历会把它写进简历正文，而用户明确要求这些内容不进简历。"
        )
    for key in ("student_id", "emergency_contact_phone", "height"):
        assert key not in profile, f"简历资料里多出了网申资料的字段 {key!r}"


def test_profile_to_form_data_alone_does_not_include_the_extras(db_session):
    """``profile_to_form_data`` 是**纯函数**（只看传进去的资料），不该知道这张表。

    合并发生在 ``build_form_data`` 那一层——这样单独测资料展开时不会被库里的网申资料干扰。
    """
    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"student_id": "2022012345"})

    from app.services.profile.profile_service import get_profile_detail

    flat = profile_to_form_data(get_profile_detail(db_session))

    assert "student_id" not in flat
