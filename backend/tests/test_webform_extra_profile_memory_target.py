"""「网申资料」· 记忆目标与单字段写入（2026-09-27；边界收紧于 2026-09-28）。

「记住这条」的落点**只有「网申资料」**。以前这里还能看到 ``profile:name``、
``educations:<id>:courses`` 这类目标——按一下就能改你简历资料里的字段，而简历是要
投出去的。2026-09-28 收掉了：不是界面上藏起来，是这一层**结构上做不到**。
共享夹具见 ``test_webform_extra_profile.py``。
"""
from app.services.webform import extra_profile
from test_webform_extra_profile import _seed_profile


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
    assert extra_profile.list_details(db_session)["CUSTOM_实验室名称"]["reuse"] == "general"
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
