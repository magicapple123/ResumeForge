"""网申填表接口 · 「网申资料」。

用户专门为网申表单录的补充资料。**只给网申填表用**——简历生成读的是 UserProfile，
不经过这两个接口（边界的主断言在主文件与 tests/test_webform_extra_profile.py）。
共享桩见 ``test_webform_api.py``。
"""
from app.services.webform import FormEngine, get_snapshot_store
from test_webform_api import HEIGHT_CONTROLS, browser_port

# browser_port 是 pytest fixture（定义在主文件），经本模块命名空间解析；显式 re-export。
__all__ = ["browser_port"]


def test_extra_profile_starts_empty_with_the_catalog(client, browser_port):
    body = client.get("/api/webform/extra-profile").json()

    keys = [item["key"] for item in body["fields"]]
    # 清单只含"要用户自己录"的那批，**不含**从简历资料取值的字段（否则界面会把
    # "学校""专业"也渲染成网申资料的输入框）。
    assert "student_id" in keys
    assert "name" not in keys and "school" not in keys
    # 四六级分数已挪进**教育经历**（简历资料），所以它不该再出现在这一区——
    # 同一个值有两个来源，改哪边都不对。
    assert "cet4_score" not in keys and "cet6_score" not in keys
    assert body["values"] == {}
    # 分区标题来自后端，界面不写死。
    assert "语言与证书" in body["groups"]


def test_extra_profile_round_trips(client, browser_port):
    put = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "2022012345", "height": "178"}},
    )
    assert put.status_code == 200
    assert put.json()["values"] == {"student_id": "2022012345", "height": "178"}

    # 重新读一次也还在（真的落库了，不是只回显）。
    body = client.get("/api/webform/extra-profile").json()
    assert body["values"] == {"student_id": "2022012345", "height": "178"}


def test_extra_profile_put_is_a_full_overwrite(client, browser_port):
    """整份覆盖：没提到的 key 被删除——用户清空某一格时"删除"才是他要的语义。"""
    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345", "height": "178"}})
    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345"}})

    assert client.get("/api/webform/extra-profile").json()["values"] == {"student_id": "2022012345"}


def test_extra_profile_put_rolls_back_single_value_changes_when_repeated_save_fails(
    client, browser_port, monkeypatch
):
    """单值资料与多条资料必须一起提交，后半段失败时不能只保存前半段。"""
    client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "旧学号"}, "repeated": {}},
    )

    from app.api import webform as webform_api

    def fail(*_args, **_kwargs):
        raise ValueError("重复资料无效")

    monkeypatch.setattr(webform_api.repeated_profile, "save_groups", fail)
    response = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "新学号"}, "repeated": {}},
    )

    assert response.status_code == 422
    assert response.json()["detail"] == "重复资料无效"
    assert client.get("/api/webform/extra-profile").json()["values"] == {
        "student_id": "旧学号"
    }


def test_extra_profile_drops_keys_outside_the_catalog(client, browser_port):
    """目录外的键丢弃但不报错——前端多传一个键不该让整次保存失败。"""
    put = client.put(
        "/api/webform/extra-profile",
        json={"values": {"student_id": "2022012345", "definitely_not_a_field": "x"}},
    )

    assert put.status_code == 200
    assert put.json()["values"] == {"student_id": "2022012345"}


def test_extra_profile_values_reach_the_webform_fill_data(client, browser_port, db_session):
    """录进去的资料要能被网申填表读到——不然录了也白录。"""
    from app.services.webform.data import build_form_data

    client.put("/api/webform/extra-profile", json={"values": {"student_id": "2022012345"}})

    assert build_form_data(db_session)["student_id"] == "2022012345"


# ===== 学到的（2026-09-27）=====


def test_extra_profile_reports_source_and_level(client, browser_port):
    """``details`` 要带上来源与档位——界面靠它区分"手录的/学到的"并显示档位。

    默认（不传 details）落成 ``manual`` + ``general``：那是「我的资料」那一屏的语义。
    """
    client.put("/api/webform/extra-profile", json={"values": {"height": "178"}})

    body = client.get("/api/webform/extra-profile").json()

    assert body["details"]["height"] == {
        "value": "178",
        "source": "manual",
        "reuse": "general",
        # 显式给出来，前端就不必自己判断"这个 key 是自定义的还是目录的"。
        "label": "身高(cm)",
    }


def test_extra_profile_accepts_learned_details(client, browser_port):
    """学到的那些要能把 ``source="learned"`` 与档位一起写进去。"""
    put = client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"height": "178", "referral_code": "ABC123"},
            "details": {
                "height": {"value": "178", "source": "learned", "reuse": "general"},
                "referral_code": {"value": "ABC123", "source": "learned", "reuse": "once"},
            },
        },
    )

    assert put.status_code == 200
    details = put.json()["details"]
    assert details["height"]["source"] == "learned"
    assert details["referral_code"]["reuse"] == "general"


def test_all_saved_profile_values_are_offered_to_the_fill_engine(client, browser_port, db_session):
    """网申资料统一按通用资料参与填表，历史档位只保留兼容显示。"""
    from app.services.webform.data import build_form_data

    client.put(
        "/api/webform/extra-profile",
        json={
            "values": {"referral_code": "ABC123", "height": "178"},
            "details": {
                "referral_code": {"value": "ABC123", "source": "learned", "reuse": "once"},
                "height": {"value": "178", "source": "learned", "reuse": "general"},
            },
        },
    )

    data = build_form_data(db_session)
    assert data["referral_code"] == "ABC123"
    assert data["height"] == "178"
    # 但读得回来——"只记不填"不是"不记"。
    assert client.get("/api/webform/extra-profile").json()["values"]["referral_code"] == "ABC123"


def test_preview_proposes_nothing_for_a_recognized_but_empty_field(
    client, browser_port, db_session
):
    """**边界用例**：规则认得出这个框、但资料里没这一项 → **不提案**。

    这一行落在 ``missing_data``（"我们知道有这个字段、只是你没填"），不在 ``items`` 里。
    那不是"学一条新东西"的场合——用户该去「网申资料」把它补上。学习只看 ``items``，
    所以这条边界是**结构上**成立的，不是靠额外判断。

    钉住它是因为反过来做（把 ``missing_data`` 也拿去学）看起来更"贴心"，实际会把
    "目录里已有的字段"变成一堆学来的条目，而它们下次仍会走规则匹配、根本用不上。
    """
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(HEIGHT_CONTROLS), url="https://x/apply", title="网申"
    )

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert body["learning"]["candidates"] == []
    # 前提：它确实被认出来了，只是没值——所以这不是"没认出来"的另一种说法。
    assert [item["field"] for item in body["missing_data"]] == ["height"]


def test_preview_proposes_a_value_already_known_to_the_webform_profile(
    client, browser_port, db_session
):
    """已经被「网申资料」收录的值**不提案**——否则这条提示会变成每次填表都弹的骚扰。"""
    client.put("/api/webform/extra-profile", json={"values": {"height": "178"}})
    snapshot = get_snapshot_store().save(
        FormEngine().snapshot_controls(HEIGHT_CONTROLS), url="https://x/apply", title="网申"
    )

    body = client.post("/api/webform/preview", json={"snapshot_id": snapshot.id}).json()

    assert body["learning"]["candidates"] == []
    # 前提：它这次真的会填进去（在 items 里），所以"不提案"是因为值已在库里。
    assert [(item["field"], item["value"]) for item in body["items"]] == [("height", "178")]


def test_preview_proposes_a_field_the_profile_has_no_value_for(
    client, browser_port, db_session
):
    """**正面用例**：规则认出来、这次也填了一个值，而这个字段在库里没有 → 提案。

    要凑出这个场景必须让"值有来源、字段又不在库里"同时成立，所以这里模拟的是**AI 兜底
    认出字段**那条路：``source="ai"`` 的行其值来自候选，而字段本身可以是新的。

    断言的是提案的形状——前端弹提示、以及"记住"之后写回 ``/extra-profile`` 全靠它。
    """
    from app.services.webform import extra_profile
    from app.services.webform.fields import FIELD_LABELS
    from app.services.webform.service import PreviewItem

    item = PreviewItem(
        index=0,
        field="height",
        field_label=FIELD_LABELS["height"],
        value="178",
        control_label="身高",
        control_type="text",
        source="ai",
    )
    proposals = extra_profile.learnable(db_session, [item], {})

    assert [p["key"] for p in proposals] == ["height"]
    assert proposals[0]["value"] == "178"
    assert proposals[0]["from"] == "ai"
