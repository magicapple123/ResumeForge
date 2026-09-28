"""「网申资料」的读写与**边界**。

这个文件里最重要的一条不是读写本身，而是
``test_the_resume_generation_path_never_sees_this_table``：用户的原话要求是"生成简历模块
默认不读这里的信息"。那不是一句约定——它由"独立一张表 + 简历生成只读 ``UserProfile``"
保证。这条测试**真的去调用简历生成那条路径的取数入口**并断言看不到，因为一旦有人把它并进
``to_profile_out``（看起来是"顺手统一一下"），失败方式是**静默的**：简历里会多出四六级分数、
身高、父母工作单位，而没有任何报错。
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
    assert extra_profile.EXTRA_FIELD_KEYS == expected
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


# ===== 学到的（2026-09-27）=====
#
# 填表时发现"简历通里没有"的值，问用户要不要记下来。下面这些钉住三件事：
# 判据本身、来源与档位的落地、以及**"只记不填"那档真的不填**。


class _Item:
    """``service.PreviewItem`` 的最小替身：``learnable`` 只用这三个属性。"""

    def __init__(self, field: str, value: str, source: str = "rule") -> None:
        self.field = field
        self.value = value
        self.source = source


def test_learnable_only_proposes_fields_the_profile_does_not_have(db_session):
    """判据的核心：**在库里没有值的字段**才提案。已有的字段不提案、不重复提示。"""
    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"student_id": "2022012345"})
    known = build_form_data(db_session)

    proposals = extra_profile.learnable(
        db_session,
        [
            _Item("height", "178", source="ai"),  # 库里没有 → 提案
            _Item("student_id", "2022012345"),  # 网申资料里已有 → 不提案
            _Item("name", "张三"),  # 简历资料里有 → 不提案
        ],
        known,
    )

    assert [item["key"] for item in proposals] == ["height"]
    assert proposals[0]["value"] == "178"
    # 标签取自字段目录（不在这里硬编码文案）——目录改了文案，这里不该跟着变红。
    from app.services.webform.fields import FIELD_LABELS

    assert proposals[0]["label"] == FIELD_LABELS["height"]
    assert proposals[0]["from"] == "ai"


def test_learnable_marks_ai_values_so_the_ui_can_warn(db_session):
    """AI 认的要比规则认的更醒目——它更可能认错字段，核对时的怀疑程度应当不同。"""
    _seed_profile(db_session)
    known = build_form_data(db_session)

    proposals = extra_profile.learnable(
        db_session,
        [_Item("height", "178", source="ai"), _Item("weight", "65", source="rule")],
        known,
    )

    assert {item["key"]: item["from"] for item in proposals} == {
        "height": "ai",
        "weight": "rule",
    }


def test_learnable_refuses_fields_that_are_not_extra_profile_fields(db_session):
    """**不学 ``source="profile"`` 的字段**——学了会让它冒充简历资料字段。

    规则偶尔会把「姓名」这类映射到一个"资料里恰好为空"的框上；那种 ``field`` 不在
    ``EXTRA_FIELD_KEYS`` 里。若让它进来，学到的值会在下次**覆盖**用户自己在「我的资料」
    填的东西，而 ``save_entries`` 又会把它静默丢掉——用户勾了半天发现没存上。

    2026-09-27：收窄条件从"必须在 ``EXTRA_FIELD_KEYS`` 里"放宽成"``_accepts()``"（多收了
    ``CUSTOM_`` 前缀的自定义字段）。**这条守的边界没变**——目录外的普通 key（比如 ``name``）
    仍然被拒；变的只是它旁边多开了一个明确命名的口子。见下一条。
    """
    _seed_profile(db_session)
    # 清掉姓名，模拟"规则把一个空框认成了姓名"。
    db_session.query(UserProfile).delete()
    db_session.commit()
    known = build_form_data(db_session)
    assert "name" not in known  # 前提成立

    proposals = extra_profile.learnable(db_session, [_Item("name", "李四")], known)

    assert proposals == [], "简历资料字段不该进学习提案"


def test_learnable_allows_custom_prefixed_fields(db_session):
    """**``CUSTOM_`` 前缀的进得来**——这正是这次放宽的唯一口子。

    与上一条成对：目录外的普通 key 照样拒，只有带前缀的（=用户在填表时攒出来的自定义
    字段）才收。把两条放一起看，收窄规则就是一句"``_accepts()``"，而不是一堆特例。
    """
    _seed_profile(db_session)
    known = build_form_data(db_session)

    proposals = extra_profile.learnable(
        db_session, [_Item("CUSTOM_导师姓名", "王教授")], known
    )

    assert [item["key"] for item in proposals] == ["CUSTOM_导师姓名"]


def test_learnable_skips_empty_values_and_duplicates(db_session):
    _seed_profile(db_session)
    known = build_form_data(db_session)

    proposals = extra_profile.learnable(
        db_session,
        [
            _Item("recruit_source", "   "),  # 空值没什么可记
            _Item("height", "178"),
            _Item("height", "179"),  # 同一次里重复：只留第一次
        ],
        known,
    )

    assert [item["key"] for item in proposals] == ["height"]
    assert proposals[0]["value"] == "178"


def test_learnable_stops_proposing_once_the_value_is_remembered(db_session):
    """记住之后就不再提案——否则这条提示会变成每次填表都弹的骚扰。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"height": "178"},
        details={"height": {"source": "learned", "reuse": "general"}},
    )

    proposals = extra_profile.learnable(
        db_session, [_Item("height", "178")], build_form_data(db_session)
    )

    assert proposals == []


def test_learned_entries_keep_their_source_and_level(db_session):
    """来源与档位要落库、要读得回来——界面靠它区分"手录的/学到的"并显示档位。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"height": "178", "referral_code": "ABC123"},
        details={
            "height": {"source": "learned", "reuse": "general"},
            "referral_code": {"source": "learned", "reuse": "once"},
        },
    )

    details = extra_profile.list_details(db_session)

    assert details["height"]["source"] == "learned"
    assert details["height"]["reuse"] == "general"
    assert details["referral_code"]["reuse"] == "once"


def test_manual_entries_default_to_general(db_session):
    """「我的资料」那一屏保存时不传 details → 按"自己录的、默认档位"落库。"""
    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"height": "178"})

    details = extra_profile.list_details(db_session)

    assert details["height"] == {
        "value": "178",
        "source": "manual",
        "reuse": "general",
        # 目录字段的 label 由读取端从 FIELD_LABELS 回落出来。
        "label": "身高(cm)",
    }


def test_bogus_source_and_level_fall_back_to_the_safe_default(db_session):
    """前端传来不认识的来源/档位时**不能**原样落库——那会让界面渲染出一个没有含义的标签。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"height": "178"},
        details={"height": {"source": "guessed", "reuse": "whenever"}},
    )

    details = extra_profile.list_details(db_session)

    assert details["height"]["source"] == "manual"
    assert details["height"]["reuse"] == "general"


def test_once_entries_are_stored_but_never_prefilled(db_session):
    """**「本次」这一档的全部含义**：留在库里、在界面上看得见，但不参与自动预填。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"referral_code": "ABC123", "height": "178"},
        details={
            "referral_code": {"source": "learned", "reuse": "once"},
            "height": {"source": "learned", "reuse": "general"},
        },
    )

    # 填表用的那份数据里没有它。
    assert "referral_code" not in build_form_data(db_session)
    assert build_form_data(db_session)["height"] == "178"
    # 但库里还在、界面读得到——"只记不填"，不是"不记"。
    assert extra_profile.list_entries(db_session)["referral_code"] == "ABC123"
    assert extra_profile.list_details(db_session)["referral_code"]["reuse"] == "once"


def test_scenario_entries_are_still_prefilled(db_session):
    """「场景」档与「通用」一样参与预填——差别只在界面上标出来源。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"recruit_source": "BOSS直聘"},
        details={"recruit_source": {"source": "learned", "reuse": "scenario"}},
    )

    assert build_form_data(db_session)["recruit_source"] == "BOSS直聘"


def test_learned_values_never_reach_the_resume_generation_path(db_session):
    """学到的值同样**不能**进简历生成——``source="learned"`` 让这张表自动增长，
    所以这条边界不能只靠"用户自己录不了多少"这个前提。"""
    from app.services.profile.profile_service import get_profile_detail, to_profile_out

    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"emergency_contact_phone": "13900000000", "height": "178", "weight": "65"},
        details={
            key: {"source": "learned", "reuse": "general"}
            for key in ("emergency_contact_phone", "height", "weight")
        },
    )

    profile = to_profile_out(get_profile_detail(db_session)).model_dump()
    strings = _string_values(profile)

    for value in ("13900000000", "178", "65"):
        assert value not in strings, f"学到的值 {value!r} 进简历资料了"
    for key in ("emergency_contact_phone", "height", "weight"):
        assert key not in profile, f"简历资料里多出了学到的字段 {key!r}"


def test_learned_values_never_reach_a_share_package(client, db_session):
    """**分享包那条链也读不到**——它只取 ``ResumeContent`` 快照。

    学习会让这张表**自动增长**，所以"不进分享包"必须靠结构成立，不能靠"用户没录敏感项"。
    这里直接检查分享包的取数入口有没有碰网申资料那条链路。
    """
    import inspect

    from app.services import share_package

    source = inspect.getsource(share_package)
    assert "web_form_profile_entry" not in source
    assert "extra_profile" not in source


# ===== 自定义字段与「记住这条」（2026-09-27）=====
#
# 用户在「点哪个填哪个」里按「记住这条」：认得出的按目录 key 记，认不出的按控件自己的话
# 规范成 ``CUSTOM_*``。这里管**存**的那一半（``remember`` / ``custom_key`` / 读写口径）。


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
    # **如实标注不参与自动匹配**——目录字段都是 True。
    assert by_key["CUSTOM_导师姓名"]["matchable"] is False
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


# ===== 记忆目标与单字段写入（2026-09-27；边界收紧于 2026-09-28）=====
#
# 「记住这条」的落点**只有「网申资料」**。以前这里还能看到 ``profile:name``、
# ``educations:<id>:courses`` 这类目标——按一下就能改你简历资料里的字段，而简历是要
# 投出去的。2026-09-28 收掉了：不是界面上藏起来，是这一层**结构上做不到**。


def test_memory_targets_cover_only_the_web_form_profile(db_session):
    """落点只有网申资料：目录字段与自定义字段，别的一概没有。"""
    from app.services.webform.profile_targets import build_memory_targets

    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"height": "178"})
    extra_profile.remember(
        db_session, key="CUSTOM_导师姓名", value="王教授", label="导师姓名", source="manual"
    )

    targets = build_memory_targets(db_session)

    assert targets, "网申资料的目标不该是空的"
    assert all(t["source"] == "extra" for t in targets)
    for target in targets:
        assert target["target_id"].startswith("extra:"), (
            f"出现了网申资料之外的落点：{target['target_id']}"
        )
    by_id = {target["target_id"]: target for target in targets}
    assert by_id["extra:height"]["value"] == "178"
    assert by_id["extra:CUSTOM_导师姓名"]["label"] == "导师姓名"


def test_remember_target_updates_only_the_selected_web_form_field(db_session):
    """选中的那一条被更新，**别的一条都不动**。"""
    from app.services.webform.profile_targets import remember_target

    _seed_profile(db_session)
    extra_profile.save_entries(db_session, {"height": "178", "weight": "65"})

    assert remember_target(db_session, target_id="extra:height", value="180") is True

    entries = extra_profile.list_entries(db_session)
    assert entries["height"] == "180"
    assert entries["weight"] == "65", "没选中的那一条被改动了"


def test_remember_target_refuses_anything_that_is_not_the_web_form_profile(db_session):
    """**这是这次收紧的核心断言**：指向简历资料的 target_id 一律拒绝，且真的没写进去。

    直接拿它以前能用的那几个形态去打。这不是"界面上不提供"——``remember_target`` 里
    根本没有能改 ``UserProfile`` 的代码，所以连伪造的 target_id 也落不下去。
    最后把整份简历资料序列化后逐字比对，防止"拒绝是拒绝了、但顺手改了点别的"。
    """
    from app.services.profile.profile_service import get_profile_detail, to_profile_out
    from app.services.webform.profile_targets import remember_target

    _seed_profile(db_session)
    before = str(to_profile_out(get_profile_detail(db_session)).model_dump())

    for target_id in (
        "profile:name",
        "profile:phone",
        "profile:not_a_column",
        "educations:1:school",
        "experiences:1:company",
        "skills:1:name",
        "awards:1:name",
    ):
        assert (
            remember_target(db_session, target_id=target_id, value="被改掉了") is False
        ), f"{target_id} 不该被接受"

    assert str(to_profile_out(get_profile_detail(db_session)).model_dump()) == before, (
        "简历资料被改动了"
    )
    assert extra_profile.list_entries(db_session) == {}


def test_remember_target_can_still_create_a_custom_field(db_session):
    """新建自定义字段这条路仍然通——它是「记住这条」最常用的落点。"""
    from app.services.webform.profile_targets import remember_target

    _seed_profile(db_session)

    assert (
        remember_target(
            db_session,
            target_id="custom",
            label="实验室名称",
            value="智能计算实验室",
            reuse="scenario",
        )
        is True
    )
    assert extra_profile.list_entries(db_session)["CUSTOM_实验室名称"] == "智能计算实验室"
    assert extra_profile.list_details(db_session)["CUSTOM_实验室名称"]["reuse"] == "scenario"
    # 没有字段名建不出东西来。
    assert remember_target(db_session, target_id="custom", label="", value="x") is False


def test_resolve_default_target_never_points_at_the_resume_profile(db_session):
    """默认落点**永远**在网申资料——哪怕字段名就叫「姓名」。

    钉在最容易回退的地方：默认值是**自动选的**，用户不看提示就会按保存。它一旦指回
    简历资料，手滑的代价就是简历被改。
    """
    from app.services.webform.profile_targets import resolve_default_target

    _seed_profile(db_session)

    for field_key in ("name", "phone", "city", "school", "company", "advisor"):
        target = resolve_default_target(db_session, field_key=field_key, label=field_key)
        assert target["location"].startswith("网申资料"), (
            f"{field_key} 的默认落点跑到简历资料去了：{target}"
        )
        assert target["target_id"] == "custom" or target["target_id"].startswith("extra:"), target



def test_resolve_default_target_uses_existing_extra_field_before_custom(db_session):
    """网申资料目录已有但为空的字段，也应复用原字段。"""
    from app.services.webform.profile_targets import resolve_default_target

    extra_profile.save_entries(db_session, {})

    target = resolve_default_target(db_session, field_key="height", label="身高")

    assert target["target_id"] == "extra:height"
    assert target["location"].startswith("网申资料")


def test_resolve_default_target_creates_custom_only_for_unknown_field(db_session):
    from app.services.webform.profile_targets import resolve_default_target

    target = resolve_default_target(db_session, field_key="CUSTOM_实验室", label="实验室")

    assert target == {
        "target_id": "custom",
        "label": "实验室",
        "location": "网申资料 · 自定义 · 实验室",
    }


def test_custom_field_label_can_be_renamed_without_losing_value_or_matching(db_session):
    """改名只更新显示标签，稳定 key 与值保留，实时层能按新标签继续识别。"""
    from app.services.webform.data import build_live_form_data

    extra_profile.save_entries(
        db_session,
        {"CUSTOM_实验室": "智能计算实验室"},
        details={
            "CUSTOM_实验室": {
                "source": "manual",
                "reuse": "general",
                "label": "实验室",
            }
        },
    )
    extra_profile.save_entries(
        db_session,
        {"CUSTOM_实验室": "智能计算实验室"},
        details={
            "CUSTOM_实验室": {
                "source": "manual",
                "reuse": "general",
                "label": "导师姓名",
            }
        },
    )

    details = extra_profile.list_details(db_session)
    assert details["CUSTOM_实验室"]["label"] == "导师姓名"
    assert extra_profile.list_entries(db_session)["CUSTOM_实验室"] == "智能计算实验室"
    assert build_live_form_data(db_session)["CUSTOM_实验室"] == "智能计算实验室"


def test_custom_field_is_deleted_when_the_edited_profile_omits_it(db_session):
    """「我的资料」保存时去掉自定义字段会移除值，下一次实时刷新也不再提供它。"""
    extra_profile.save_entries(
        db_session,
        {"CUSTOM_实验室": "智能计算实验室", "height": "178"},
        details={"CUSTOM_实验室": {"label": "实验室"}},
    )
    extra_profile.save_entries(db_session, {"height": "178"})

    assert "CUSTOM_实验室" not in extra_profile.list_entries(db_session)
    assert "CUSTOM_实验室" not in extra_profile.list_details(db_session)
