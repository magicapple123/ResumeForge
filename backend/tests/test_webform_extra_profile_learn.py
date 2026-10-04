"""「网申资料」· 学习提案与学到的值（2026-09-27）。

填表时发现"简历通里没有"的值，问用户要不要记下来。这里钉住三件事：
判据本身、来源与档位的落地、以及**"只记不填"那档真的不填**。
共享夹具见 ``test_webform_extra_profile.py``。
"""
from app.models.profile import UserProfile
from app.services.webform import extra_profile
from app.services.webform.data import build_form_data

from test_webform_extra_profile import _seed_profile, _string_values


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
    assert details["referral_code"]["reuse"] == "general"


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


def test_historical_once_entries_are_stored_and_prefilled(db_session):
    """历史「本次」档位归一为通用资料，仍保留值且参与自动预填。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"referral_code": "ABC123", "height": "178"},
        details={
            "referral_code": {"source": "learned", "reuse": "once"},
            "height": {"source": "learned", "reuse": "general"},
        },
    )

    assert build_form_data(db_session)["referral_code"] == "ABC123"
    assert build_form_data(db_session)["height"] == "178"
    # 但库里还在、界面读得到——"只记不填"，不是"不记"。
    assert extra_profile.list_entries(db_session)["referral_code"] == "ABC123"
    assert extra_profile.list_details(db_session)["referral_code"]["reuse"] == "general"


def test_historical_scenario_entries_are_still_prefilled(db_session):
    """历史「场景」档与通用资料一样参与预填并归一为通用。"""
    _seed_profile(db_session)
    extra_profile.save_entries(
        db_session,
        {"recruit_source": "BOSS直聘"},
        details={"recruit_source": {"source": "learned", "reuse": "scenario"}},
    )

    assert build_form_data(db_session)["recruit_source"] == "BOSS直聘"
    assert extra_profile.list_details(db_session)["recruit_source"]["reuse"] == "general"


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
