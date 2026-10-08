"""「网申资料」· 自定义字段与「记住这条」（2026-09-27）。

用户在「点哪个填哪个」里按「记住这条」：认得出的按目录 key 记，认不出的按控件自己的话
规范成 ``CUSTOM_*``。这里管**存**的那一半（``remember`` / ``custom_key`` / 读写口径）。
共享夹具见 ``test_webform_extra_profile.py``。
"""
from app.services.webform import extra_profile
from test_webform_extra_profile import _seed_profile, _string_values


def test_custom_key_normalizes_the_users_own_words():
    """规范成 ``CUSTOM_`` + 去装饰的名字——中文、空格、标点都要处理干净。"""
    assert extra_profile.custom_key("导师姓名") == "CUSTOM_导师姓名"
    assert extra_profile.custom_key("  实验室 名称  ") == "CUSTOM_实验室名称"
    assert extra_profile.custom_key("意向岗位：") == "CUSTOM_意向岗位"
    assert extra_profile.custom_key("*紧急联系人*") == "CUSTOM_紧急联系人"
    assert extra_profile.custom_key("(导师)") == "CUSTOM_导师"


def test_custom_key_caps_the_length():
    """超长的名字要截断——key 有长度上限，界面上显示的名字不受这个限制。"""
    key = extra_profile.custom_key("字" * 100)

    assert len(key) == len(extra_profile.CUSTOM_KEY_PREFIX) + extra_profile.MAX_CUSTOM_LABEL_CHARS


def test_custom_key_refuses_an_empty_name():
    """**光有装饰符号等于没有名字**——返回空串，调用方据此拒绝并如实说明。"""
    assert extra_profile.custom_key("") == ""
    assert extra_profile.custom_key("   ") == ""
    assert extra_profile.custom_key("——:：") == ""


def test_remember_upserts_one_entry_without_touching_the_others(db_session):
    """``remember`` **只动这一条**，别的照旧。

    这与 ``save_entries`` 是刻意的分工：那个是"这一屏就是全部"的整份覆盖，在填表过程中
    用它会把用户这一屏之外的资料全删掉。
    """
    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"student_id": "2022012345", "height": "178"})

    ok = extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名"
    )

    assert ok is True
    entries = extra_profile.list_entries(db_session)
    assert entries["CUSTOM_导师姓名"] == "王教授"
    # **别的一条都没被碰过。**
    assert entries["student_id"] == "2022012345"
    assert entries["height"] == "178"


def test_remember_overwrites_the_same_key(db_session):
    """同一个 key 再记一次是**覆盖**，不是插出两条。"""
    _seed_profile(db_session)
    extra_profile.remember(db_session, key="CUSTOM_导师姓名", value="王教授")
    extra_profile.remember(db_session, key="CUSTOM_导师姓名", value="李教授")

    assert extra_profile.list_entries(db_session)["CUSTOM_导师姓名"] == "李教授"
    details = extra_profile.list_details(db_session)
    assert len([k for k in details if k == "CUSTOM_导师姓名"]) == 1


def test_remember_marks_entries_as_learned(db_session):
    """学到的值来源是 ``learned``——界面据此区别于用户手录的。"""
    _seed_profile(db_session)
    extra_profile.remember(db_session, key="CUSTOM_导师姓名", value="王教授")

    details = extra_profile.list_details(db_session)

    assert details["CUSTOM_导师姓名"]["source"] == "learned"
    assert details["CUSTOM_导师姓名"]["reuse"] == "general"
    assert details["CUSTOM_导师姓名"]["label"] == "导师姓名"


def test_remember_refuses_keys_outside_the_catalog_that_are_not_custom(db_session):
    """**目录外的普通 key 拒收**——与 ``save_entries`` 同一条边界。

    不拒的话，填表时攒下的值会冒充简历资料字段（正是当初立这条的原因）。
    """
    _seed_profile(db_session)

    assert extra_profile.remember(db_session, key="name", value="李四") is False
    assert extra_profile.list_entries(db_session) == {}


def test_remember_refuses_an_empty_value(db_session):
    """空值不落库——"没有这一项"与"这一项是空的"在这里是同一件事。"""
    _seed_profile(db_session)

    assert extra_profile.remember(db_session, key="CUSTOM_导师姓名", value="   ") is False
    assert extra_profile.list_entries(db_session) == {}


def test_remember_trims_and_caps_the_value(db_session):
    _seed_profile(db_session)
    extra_profile.remember(
        db_session,
        key="CUSTOM_导师姓名",
        value="  " + "x" * (extra_profile.MAX_VALUE_CHARS + 50),
    )

    stored = extra_profile.list_entries(db_session)["CUSTOM_导师姓名"]
    assert len(stored) == extra_profile.MAX_VALUE_CHARS
    assert not stored.startswith(" ")


# ===== 写入与读取的口径必须一起放宽 =====
#
# 这是最容易漏的一处：两处 ``_accepts()`` 写在不同函数里，改了一处忘了另一处，失败方式
# 是**静默的**——存进去了、读不出来，没有任何报错。所以**一条测试盯一处**，各管各的。


def test_the_write_side_accepts_custom_keys(db_session):
    """**写入侧**：``save_entries`` 要收 ``CUSTOM_`` 前缀的 key。

    对应 ``save_entries`` 里那个 ``_accepts()``。把那个判断改回
    ``key not in EXTRA_FIELD_KEYS``，这条就红。
    """
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session, {"CUSTOM_导师姓名": "王教授", "student_id": "2022012345"}
    )

    assert extra_profile.list_entries(db_session)["CUSTOM_导师姓名"] == "王教授"


def test_the_read_side_returns_custom_keys(db_session):
    """**读取侧**：``list_entries`` / ``list_details`` 要放行 ``CUSTOM_`` 前缀的行。

    对应那两个函数各自的 ``_accepts()``。**故意绕开 ``save_entries`` 直接往库里插**——
    这样测的就是读取侧自己的判断，而不是"写入那次侥幸成功了"。
    """
    from app.models.web_form_profile import WebFormProfileEntry

    _seed_profile(db_session)
    db_session.add(
        WebFormProfileEntry(field_key="CUSTOM_导师姓名", value="王教授", label="导师姓名")
    )
    db_session.commit()

    assert extra_profile.list_entries(db_session)["CUSTOM_导师姓名"] == "王教授"
    assert extra_profile.list_details(db_session)["CUSTOM_导师姓名"]["value"] == "王教授"


def test_custom_fields_show_up_in_the_field_list(db_session):
    """自定义字段要进「网申资料」的字段清单——不然录了也看不见。"""
    from app.services.webform import service

    _seed_profile(db_session)
    extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名"
    )

    listing = service.list_extra_fields(db_session)
    by_key = {field["key"]: field for field in listing["fields"]}

    assert "CUSTOM_导师姓名" in by_key
    assert by_key["CUSTOM_导师姓名"]["label"] == "导师姓名"
    assert by_key["CUSTOM_导师姓名"]["group"] == extra_profile.CUSTOM_GROUP
    assert extra_profile.CUSTOM_GROUP in listing["groups"]
    # 自定义字段可参与受约束匹配；目录字段仍显式可匹配。
    assert by_key["CUSTOM_导师姓名"]["matchable"] is True
    assert by_key["height"]["matchable"] is True


def test_an_empty_custom_field_is_not_listed(db_session):
    """没有值的自定义字段不进清单——与目录字段同一口径（空值不落库，也就不显示）。"""
    from app.services.webform import service

    _seed_profile(db_session)

    listing = service.list_extra_fields(db_session)

    assert extra_profile.CUSTOM_GROUP not in listing["groups"]


def test_custom_values_never_reach_the_resume_generation_path(db_session):
    """自定义字段同样**不能**进简历生成——它和目录字段住在同一张表里，同一条边界管着。"""
    from app.services.profile.profile_service import get_profile_detail, to_profile_out

    _seed_profile(db_session)
    extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名"
    )

    profile = to_profile_out(get_profile_detail(db_session)).model_dump()

    assert "王教授" not in _string_values(profile)
    assert "CUSTOM_导师姓名" not in profile
