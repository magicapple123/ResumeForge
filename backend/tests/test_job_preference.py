# SPDX-License-Identifier: Apache-2.0
"""求职偏好档的目录 / 服务 / 隔离守卫（期二 T10/T11）。

覆盖三组性质：

1. 12 类闭集 + 逐 kind 校验器：非法值不进库（422 的来源都在 catalog 里）；
2. 服务状态机：active_pref 是唯一读取入口（grep 断言）、同值 no-op、编辑只置
   superseded、撤销只置 undone、删除只写 deleted_at、历史裁剪 20、恢复撞活动行；
3. **偏好隔离（最重要）**：只设偏好、不设资料的库里，资料提示 / 简历生成候选 /
   事实台账三条取数管线都不能出现「杭州」——偏好不得被当成发生过的事实。
"""

from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path
from uuid import uuid4

import pytest
from app.models.assistant import AssistantWriteProposal
from app.models.job_preference import (
    PREF_SOURCE_USER_EDITED,
    PREF_SOURCE_USER_STATED,
    PREF_STATE_ACTIVE,
    PREF_STATE_SUPERSEDED,
    PREF_STATE_UNDONE,
    JobPreference,
)
from app.models.profile import utcnow
from app.services import job_preference_catalog as catalog
from app.services import job_preference_service as service
from app.services import trash
from app.services.claims import list_claims
from app.services.profile.profile_context import (
    build_llm_profile_prompt_data,
    build_profile_prompt_data,
)
from app.services.profile.profile_service import get_profile_detail, to_profile_out
from sqlalchemy.exc import IntegrityError

APP_DIR = Path(__file__).resolve().parents[1] / "app"


def _upsert(db, value=None, *, kind="target_city", source=PREF_SOURCE_USER_EDITED, **kwargs):
    """默认写城市偏好；value 为 None 时才用「杭州」，避免传 None 被当成值。"""
    actual = ["杭州"] if value is None else value
    return service.upsert_preference(db, kind, actual, source=source, **kwargs)


def _proposal(
    db,
    *,
    status: str = "pending",
    tool_name: str = "create_job_preference",
    dataset_key: str | None = None,
) -> AssistantWriteProposal:
    record = AssistantWriteProposal(
        proposal_id=uuid4().hex[:16],
        dataset_key=dataset_key or service.current_dataset_key(),
        dataset_generation=0,
        tool_name=tool_name,
        arguments={"kind": "target_city", "value": ["杭州"]},
        arguments_digest="",
        preview={},
        target_fingerprint="",
        status=status,
        created_at=utcnow(),
        expires_at=utcnow() + timedelta(minutes=30),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


# ===== 1. 目录与校验器 =====


def test_catalog_is_the_closed_set_of_twelve_kinds():
    # 顺序 = inject_priority 顺序（注入块与列表都按它排）。
    assert catalog.PREFERENCE_KINDS == (
        "target_role_family",
        "target_city",
        "salary_floor",
        "work_mode",
        "exclude_company",
        "exclude_industry",
        "overtime",
        "available_from",
        "redline_banned_word",
        "redline_length",
        "redline_tone",
        "session_note",
    )
    kinds = {spec.kind: spec for spec in catalog.kind_specs()}
    assert kinds["target_city"].value_kind == catalog.PREF_VALUE_KIND_LIST
    assert kinds["salary_floor"].value_kind == catalog.PREF_VALUE_KIND_SCALAR
    # session_note 只服务「只在这次对话」按钮，永不进注入块。
    assert "session_note" not in catalog.INJECTABLE_KINDS
    assert len(catalog.INJECTABLE_KINDS) == 11
    # kind 是协议值，不落库；catalog_items 一次给前端 12 条。
    items = catalog.catalog_items()
    assert len(items) == 12
    assert {item["kind"] for item in items} == set(catalog.PREFERENCE_KINDS)


def test_unknown_kind_and_bad_shapes_are_rejected():
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("hobby", ["钓鱼"])
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("target_city", {"city": "杭州"})
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("target_city", [])
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("redline_banned_word", ["赋能", " "])


@pytest.mark.parametrize("bad", ["杭州1", "2026", "杭州某公司", "天津工业大学", "5人团队"])
def test_target_city_rejects_digits_and_resume_nouns(bad):
    """城市字段只收城市名：数字与履历名词都说明把经历混进了意图。"""
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("target_city", [bad])


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("月薪15k", {"amount": 15000, "unit": "month", "currency": "CNY"}),
        ("15K", {"amount": 15000, "unit": "month", "currency": "CNY"}),
        ("1.5万", {"amount": 15000, "unit": "month", "currency": "CNY"}),
        ("年薪30万", {"amount": 300_000, "unit": "year", "currency": "CNY"}),
        ("30万/年", {"amount": 300_000, "unit": "year", "currency": "CNY"}),
        (15000, {"amount": 15000, "unit": "month", "currency": "CNY"}),
        (
            {"amount": 20000, "unit": "month", "currency": "cny"},
            {"amount": 20000, "unit": "month", "currency": "CNY"},
        ),
    ],
)
def test_salary_floor_is_parsed_into_structured_object(raw, expected):
    assert catalog.normalize_value("salary_floor", raw) == expected


@pytest.mark.parametrize("bad", ["面议", "0", "-5k", "15k美元", {"amount": 0}, {"amount": "15k"}])
def test_salary_floor_rejects_unparseable_values(bad):
    with pytest.raises(catalog.PreferenceValidationError):
        catalog.normalize_value("salary_floor", bad)


def test_enum_and_small_scalar_kinds_are_normalized():
    assert catalog.normalize_value("work_mode", "远程") == "remote"
    assert catalog.normalize_value("work_mode", "hybrid") == "hybrid"
    assert catalog.normalize_value("overtime", "不接受") == "reject"
    assert catalog.normalize_value("redline_tone", "平实") == "plain"
    assert catalog.normalize_value("redline_length", "一页") == {"max_pages": 1}
    assert catalog.normalize_value("redline_length", {"max_pages": 2}) == {"max_pages": 2}
    assert catalog.normalize_value("available_from", "2026-12") == "2026-12-01"
    assert catalog.normalize_value("available_from", "随时") == "immediate"
    assert catalog.normalize_value("target_city", "杭州、上海,杭州") == ["杭州", "上海"]
    assert catalog.describe_value("work_mode", "remote") == "远程"
    assert (
        catalog.describe_value("salary_floor", {"amount": 15000, "unit": "month"})
        == "月薪 ≥15,000 元"
    )


def test_active_row_uniqueness_is_enforced_by_a_partial_index(db_session):
    """活动行唯一性由 partial unique index 兜底，不只靠服务层自觉。

    绕过服务层直接插第二条 active 行：数据库必须拒绝（superseded / 回收站行能并存，
    是因为索引条件带 state='active' AND deleted_at IS NULL）。
    """
    _upsert(db_session, ["杭州"])
    now = utcnow()
    duplicate = JobPreference(
        pref_id="dup" + "0" * 21,
        dataset_key=service.current_dataset_key(),
        kind="target_city",
        value_kind="list",
        value=["北京"],
        value_digest="d" * 64,
        value_schema=1,
        source=PREF_SOURCE_USER_EDITED,
        note="",
        state=PREF_STATE_ACTIVE,
        created_at=now,
        updated_at=now,
    )
    db_session.add(duplicate)
    with pytest.raises(IntegrityError):
        db_session.commit()
    db_session.rollback()
    assert len(service.list_active_preferences(db_session)) == 1
    # 索引定义本身也钉住：条件必须同时含 state 与 deleted_at（反证的锚点）。
    index = next(
        item
        for item in JobPreference.__table__.indexes
        if item.name == "ux_job_preference_active_kind"
    )
    assert index.unique is True
    where = str(index.dialect_options["sqlite"]["where"])
    assert "state" in where and "deleted_at IS NULL" in where


# ===== 2. 唯一读取入口 =====


def test_job_preference_table_is_only_queried_through_the_service_entry():
    """本表的裸查只允许一处（service._query）：live_only 对本表不够。

    superseded / undone 行的 deleted_at 也是 NULL，任何地方直接 query 本表 + live_only
    都会把历史版本当成当前值（注入块会同时说出「杭州」和「北京」）。所以读取必须经
    active_pref / list_preferences，本测试 grep 全 app 钉住这一点。
    """
    hits: list[str] = []
    for path in sorted(APP_DIR.rglob("*.py")):
        text = path.read_text(encoding="utf-8")
        if "query(JobPreference" in text:
            hits.append(path.relative_to(APP_DIR).as_posix())
    assert hits == ["services/job_preference_service.py"], hits
    service_source = (APP_DIR / "services/job_preference_service.py").read_text(encoding="utf-8")
    assert service_source.count("query(JobPreference)") == 1


def test_active_pref_ignores_superseded_and_deleted_rows(db_session):
    first = _upsert(db_session, ["杭州"]).record
    second = _upsert(db_session, ["北京"]).record
    current = service.active_pref(db_session, service.current_dataset_key(), "target_city")
    assert current is not None and current.pref_id == second.pref_id
    assert current.value == ["北京"]
    assert first.state == PREF_STATE_SUPERSEDED
    # 删除后活动行消失，但历史行仍在（deleted_at 只表达"用户删了它"）。
    current = service.active_pref(db_session, service.current_dataset_key(), "target_city")
    service.delete_preference(db_session, current.pref_id)
    db_session.commit()
    assert service.active_pref(db_session, service.current_dataset_key(), "target_city") is None


# ===== 3. 写入状态机 =====


def test_same_value_upsert_is_noop_and_keeps_updated_at(db_session):
    first = _upsert(db_session, ["杭州", "上海"])
    assert first.created is True
    before = first.record.updated_at
    again = _upsert(db_session, ["上海", "杭州"])  # 顺序不同但 digest 相同（规范化后等值）
    assert again.created is False
    assert again.summary == "已存在，未改动"
    assert again.record.pref_id == first.record.pref_id
    assert again.record.updated_at == before
    assert db_session.query(JobPreference).count() == 1


def test_new_value_supersedes_old_and_never_touches_deleted_at(db_session):
    old = _upsert(db_session, ["杭州"]).record
    new = _upsert(db_session, ["北京"]).record
    db_session.refresh(old)
    assert old.state == PREF_STATE_SUPERSEDED
    assert old.deleted_at is None
    assert new.state == PREF_STATE_ACTIVE
    assert new.deleted_at is None
    assert old.pref_id != new.pref_id
    assert "更新了城市" in _upsert(db_session, ["上海"]).summary


@pytest.mark.parametrize("status", ["pending", "rejected", "failed", "expired", "unknown", None])
def test_user_stated_requires_a_confirmed_proposal(db_session, status):
    proposal = _proposal(db_session, status=status or "pending")
    if status is None:
        db_session.delete(proposal)
        db_session.commit()
        proposal_id = "missing-proposal"
    else:
        proposal_id = proposal.proposal_id
    with pytest.raises(service.PreferenceSourceError):
        _upsert(db_session, source=PREF_SOURCE_USER_STATED, source_proposal_id=proposal_id)


def test_user_stated_without_proposal_id_is_rejected(db_session):
    with pytest.raises(service.PreferenceSourceError):
        _upsert(db_session, source=PREF_SOURCE_USER_STATED, source_proposal_id=None)


@pytest.mark.parametrize("status", ["approved", "executed"])
def test_user_stated_accepts_approved_and_executed_proposal(db_session, status):
    """approve 端点先执行 handler 再 mark_executed，所以执行期状态是 approved。"""
    proposal = _proposal(db_session, status=status)
    result = _upsert(
        db_session, source=PREF_SOURCE_USER_STATED, source_proposal_id=proposal.proposal_id
    )
    assert result.record.source == PREF_SOURCE_USER_STATED
    assert result.record.source_proposal_id == proposal.proposal_id


def test_user_stated_rejects_a_proposal_from_another_dataset(db_session):
    proposal = _proposal(db_session, status="approved", dataset_key="0123456789abcdef")
    with pytest.raises(service.PreferenceSourceError):
        _upsert(db_session, source=PREF_SOURCE_USER_STATED, source_proposal_id=proposal.proposal_id)


# ===== 4. 撤销 =====


def test_undo_restores_previous_version(db_session):
    first = _upsert(db_session, ["杭州"]).record
    second = _upsert(db_session, ["北京"]).record
    restored = service.undo_preference(db_session, second.pref_id)
    db_session.refresh(first)
    db_session.refresh(second)
    assert restored.pref_id == first.pref_id
    assert first.state == PREF_STATE_ACTIVE
    assert second.state == PREF_STATE_UNDONE
    assert first.deleted_at is None and second.deleted_at is None


def test_undo_twice_is_not_current_or_no_previous(db_session):
    first = _upsert(db_session, ["杭州"]).record
    second = _upsert(db_session, ["北京"]).record
    service.undo_preference(db_session, second.pref_id)
    with pytest.raises(service.PreferenceConflict) as info:
        service.undo_preference(db_session, second.pref_id)
    assert info.value.code == "not_current"
    # 再撤销恢复回来的那一版：上一版是 undone 而不是 superseded，所以没有可撤销版本。
    with pytest.raises(service.PreferenceConflict) as info:
        service.undo_preference(db_session, first.pref_id)
    assert info.value.code == "no_previous"


def test_undo_without_previous_version_is_no_previous(db_session):
    only = _upsert(db_session, ["杭州"]).record
    with pytest.raises(service.PreferenceConflict) as info:
        service.undo_preference(db_session, only.pref_id)
    assert info.value.code == "no_previous"


def test_list_returns_active_only_with_has_previous(db_session):
    _upsert(db_session, ["杭州"])
    second = _upsert(db_session, ["北京"])
    views = service.list_preferences(db_session)
    assert [view.record.pref_id for view in views] == [second.record.pref_id]
    assert views[0].has_previous is True
    assert "杭州" not in json.dumps([view.record.value for view in views], ensure_ascii=False)


# ===== 5. 删除 / 恢复 / 裁剪 =====


def test_delete_moves_to_trash_and_restore_brings_it_back(db_session):
    record = _upsert(db_session, ["杭州"]).record
    service.delete_preference(db_session, record.pref_id)
    db_session.commit()
    db_session.refresh(record)
    assert record.deleted_at is not None
    assert record.state == PREF_STATE_ACTIVE  # 删除不改版本状态
    assert service.list_preferences(db_session) == []
    assert trash.restore(db_session, "job_preference", record.id) is True
    db_session.refresh(record)
    assert record.deleted_at is None
    assert service.active_pref(db_session, service.current_dataset_key(), "target_city") is not None


def test_restore_conflicts_with_another_active_row(db_session):
    record = _upsert(db_session, ["杭州"]).record
    service.delete_preference(db_session, record.pref_id)
    db_session.commit()
    _upsert(db_session, ["北京"])
    with pytest.raises(trash.RestoreConflict):
        trash.restore(db_session, "job_preference", record.id)


def test_history_trim_keeps_twenty_superseded_rows(db_session):
    # 城市值不能带数字（校验器会拒绝），所以用禁用词做"很多个不同版本"。
    for index in range(service.HISTORY_LIMIT + 2):
        _upsert(db_session, [f"禁用词{index}"], kind="redline_banned_word")
    superseded = (
        db_session.query(JobPreference).filter(JobPreference.state == PREF_STATE_SUPERSEDED).count()
    )
    assert superseded == service.HISTORY_LIMIT
    assert db_session.query(JobPreference).count() == service.HISTORY_LIMIT + 1


# ===== 6. 偏好隔离（最重要） =====


def _install_preferences_only(db_session) -> str:
    """只建偏好、不建任何资料：偏好若被当事实取用，这三条管线会露出来。"""
    _upsert(db_session, ["杭州", "上海"], kind="target_city")
    _upsert(db_session, ["不加班"], kind="redline_banned_word")
    return service.current_dataset_key()


def test_preferences_never_reach_the_profile_llm_prompt(db_session):
    _install_preferences_only(db_session)
    profile = to_profile_out(get_profile_detail(db_session))
    data = build_llm_profile_prompt_data(build_profile_prompt_data(profile))
    serialized = json.dumps(data, ensure_ascii=False)
    assert serialized and serialized != "{}", "空负载会让这条隔离断言空转"
    assert "杭州" not in serialized


def test_preferences_never_reach_the_resume_generation_payload(db_session, monkeypatch):
    """简历生成候选来自冻结的 ProfileOut/消费快照，**不读 preference 表**。

    等价入口说明：生成提示词里的 profile_json = selection.serialized（见
    resume_generator_prompts.render_generation_messages）。这里直接构造 selection 并断言
    序列化候选，不拉起模型；container 断言（"天津" 在）保证负载非空。
    """
    from app.schemas.resume import GenerateOptions
    from app.services.resume.resume_generator_prompts import (
        MAX_PROFILE_CHARS,
        build_profile_selection,
    )
    from tests.test_resume_generator import make_job, make_profile

    _install_preferences_only(db_session)
    selection = build_profile_selection(
        consumed=None,
        profile=make_profile(),
        job=make_job(),
        general=False,
        options=GenerateOptions(),
        fact_sections=None,
        max_chars=MAX_PROFILE_CHARS,
    )
    serialized = selection.serialized
    assert serialized, "生成候选为空会让这条隔离断言空转"
    assert "天津" in serialized
    assert "杭州" not in serialized


def test_preferences_never_reach_the_claims_pipeline(db_session):
    from app.schemas.claim import ClaimCreate
    from app.services.claims import create_claim

    _install_preferences_only(db_session)
    create_claim(
        db_session,
        ClaimCreate(
            title="用户增长",
            category="实习/工作",
            subject="示例公司",
            source_fact="负责会员增长活动",
            verification_status="待确认",
        ),
    )
    claims = list_claims(db_session)
    assert len(claims) == 1, "台账为空会让这条隔离断言空转"
    serialized = json.dumps(
        [
            {"title": item.title, "subject": item.subject, "fact": item.source_fact}
            for item in claims
        ],
        ensure_ascii=False,
    )
    assert "用户增长" in serialized
    assert "杭州" not in serialized


def test_claims_model_has_no_preference_channel(db_session):
    """结构性约束：台账表与偏好表之间没有任何列/关联，偏好没有"进事实台账"的通道。"""
    from app.models.claim import ClaimRecord as ClaimModel

    claim_columns = set(ClaimModel.__table__.columns.keys())
    preference_columns = set(JobPreference.__table__.columns.keys())
    assert claim_columns.isdisjoint({"kind", "pref_id", "value_digest"})
    assert preference_columns.isdisjoint({"verification_status", "category", "source_fact"})
