# SPDX-License-Identifier: Apache-2.0
"""事实台账「关联资料条目」的判据与口径（问题清单 §20 D1 / D5 / P0）。

这一层测的不是 CRUD，而是**关联判据本身**——页面说 10 条可用、生成时说 0 条可用的
那个缺陷就是它造成的，所以每条断言都对应一种"看起来关联了、实际没关联"的形态：

- 只有 entry_ids、没有 evidence sources → 修复前是 0 条，现在必须进基线；
- 只有 URL 形态的 evidence sources → 仍然不算关联（判据不再是 location 文本）；
- 旧数据把 entry_id 填在 sources[].location → 继续算关联（兼容，不要求重录）；
- 页面口径的「全量 M / 已关联 K」两段读数与生成口径的 confirmed_count 各自独立；
- 显式 entry_ids 才改写关联：旧客户端/助手局部更新不会顺手清掉它。
"""

from __future__ import annotations

from datetime import datetime

import pytest
from app.models.claim import (
    CLAIM_CATEGORY_PROJECT,
    RESPONSIBILITY_PARTICIPATED,
    VERIFICATION_CONFIRMED,
    VERIFICATION_PENDING,
    ClaimRecord,
)
from app.models.profile_entry import ProfileEntry
from app.schemas.claim import ClaimCreate, ClaimUpdate
from app.services.claims import build_baseline, create_claim, update_claim
from pydantic import ValidationError
from sqlalchemy import text

# 24 位十六进制 = profile_entry 真实 entry_id 的形态（不是自增 id）。
ENTRY_A = "a1" * 12
ENTRY_B = "b2" * 12
ENTRY_C = "c3" * 12
LOCATION_URL = "https://example.com/pr/1"


def _payload(**overrides) -> dict:
    base = {
        "title": "检索接口",
        "category": CLAIM_CATEGORY_PROJECT,
        "subject": "校园知识检索平台",
        "source_fact": "负责检索接口的实现与联调。",
        "candidate_wording": "实现检索接口并联调上线",
        "responsibility_level": RESPONSIBILITY_PARTICIPATED,
        "verification_status": VERIFICATION_CONFIRMED,
        "boundary": "接口由本人实现。",
    }
    base.update(overrides)
    return base


def _profile_entry(
    db_session, entry_id: str, section_key: str, values: dict, sort_order: int = 0
) -> ProfileEntry:
    row = ProfileEntry(
        entry_id=entry_id,
        section_key=section_key,
        sort_order=sort_order,
        values=values,
    )
    db_session.add(row)
    db_session.commit()
    return row


def _confirmed_claim(db_session, **overrides) -> ClaimRecord:
    return create_claim(db_session, ClaimCreate(**_payload(**overrides)))


def _set_auto_flag(db_session, record: ClaimRecord) -> None:
    """模拟迁移回填留下的「已自动关联」标记（ORM 写入会把它重置，只能直接改库）。"""
    db_session.execute(
        text("UPDATE claim_record SET entry_ids_auto = 1 WHERE id = :claim_id"),
        {"claim_id": record.id},
    )
    db_session.commit()
    db_session.refresh(record)


# ===== 关联判据 =====


def test_entry_ids_alone_put_the_claim_into_the_baseline(db_session):
    """D1 反证：sources=[] 但 entry_ids 命中快照 → 必须进入基线（修复前恒为 0）。"""
    _confirmed_claim(db_session, entry_ids=[ENTRY_A], sources=[])

    baseline = build_baseline(db_session, source_entry_ids={ENTRY_A})
    assert baseline.confirmed_count == 1
    assert "负责检索接口的实现与联调" in baseline.baseline_text
    assert baseline.covered_entries == ["校园知识检索平台"]


def test_a_url_in_sources_does_not_count_as_a_link(db_session):
    """把链接填进证据来源仍然关联不上——这正是"恒为空"的成因，不能被当成修复。"""
    _confirmed_claim(
        db_session,
        entry_ids=[],
        sources=[{"type": "link", "location": LOCATION_URL, "public": True, "note": ""}],
    )

    baseline = build_baseline(db_session, source_entry_ids={ENTRY_A})
    assert baseline.confirmed_count == 0
    assert any("来自旧资料，本次未自动带入" in item for item in baseline.warnings)


def test_legacy_source_location_entry_id_still_links(db_session):
    """旧字段兼容：0009 之前把 entry_id 填进 sources[].location 的数据仍然算关联。"""
    _confirmed_claim(
        db_session,
        entry_ids=[],
        sources=[{"type": "link", "location": ENTRY_B, "public": False, "note": ""}],
    )

    assert build_baseline(db_session, source_entry_ids={ENTRY_B}).confirmed_count == 1
    # 换一个快照就不算关联：判据是"交集"，不是"有来源"。
    assert build_baseline(db_session, source_entry_ids={ENTRY_A}).confirmed_count == 0


def test_unlinked_claims_stay_out_of_the_generation_baseline(db_session):
    """防旧主张串味：关联不上本次快照的已确认条目不自动带入。"""
    _confirmed_claim(db_session, entry_ids=[ENTRY_B])

    baseline = build_baseline(db_session, source_entry_ids={ENTRY_A})
    assert baseline.confirmed_count == 0
    assert baseline.baseline_text == ""
    assert any("重新核对并关联" in item for item in baseline.warnings)


# ===== 页面口径两段读数（M / K） =====


def test_page_counts_separate_total_confirmed_from_linked(db_session):
    """「全量 M 条已确认，其中 K 条已关联资料」：K 对照当前数据集的条目，不是快照。"""
    _profile_entry(db_session, ENTRY_A, "experiences", {"experiences.company": "某公司"})
    _confirmed_claim(db_session, entry_ids=[ENTRY_A])  # 已关联
    _confirmed_claim(db_session, entry_ids=[])  # 未关联
    create_claim(db_session, ClaimCreate(**_payload(verification_status=VERIFICATION_PENDING)))

    page = build_baseline(db_session)
    assert page.confirmed_count == 2, "页面口径仍是全量已确认（旧测试逐字节不变）"
    assert page.total_confirmed_count == 2
    assert page.linked_confirmed_count == 1
    # 覆盖清单按主体名去重：两条主张讲同一段经历，模型只需要看到一次边界。
    assert page.covered_entries == ["校园知识检索平台"]

    # 生成口径只保留关联上的那一条；M/K 两个读数不受影响。
    gen = build_baseline(db_session, source_entry_ids={ENTRY_A})
    assert gen.confirmed_count == 1
    assert gen.total_confirmed_count == 2
    assert gen.linked_confirmed_count == 1


def test_deleted_profile_entry_does_not_count_as_linked(db_session):
    """资料条目被删（软删）后不能再算"已关联"——K 与实际可用的关联保持一致。"""
    entry = _profile_entry(db_session, ENTRY_A, "experiences", {"experiences.company": "某公司"})
    _confirmed_claim(db_session, entry_ids=[ENTRY_A])
    entry.deleted_at = datetime(2026, 1, 1)
    db_session.commit()

    page = build_baseline(db_session)
    assert page.total_confirmed_count == 1
    assert page.linked_confirmed_count == 0


# ===== entry_ids 的保存语义 =====


def test_entry_ids_must_be_profile_entry_ids_not_auto_increment_ids():
    """存成自增 id 是第 20 条点名的坑：保存时就挡住，并说清该填什么。"""
    for bad in ("1", "42", "Z" * 24, "a" * 23):
        with pytest.raises(ValidationError) as excinfo:
            ClaimCreate(**_payload(entry_ids=[bad]))
        assert "entry_id" in str(excinfo.value)
    assert ClaimCreate(**_payload(entry_ids=[" " + ENTRY_A + " ", ENTRY_A])).entry_ids == [ENTRY_A]


def test_saving_a_different_link_clears_the_auto_flag(db_session):
    """用户改过关联后，「已自动关联，请核对」标记不再成立。"""
    record = _confirmed_claim(db_session, entry_ids=[ENTRY_A])
    _set_auto_flag(db_session, record)
    assert record.entry_ids_auto is True

    updated = update_claim(
        db_session, record, ClaimUpdate(**_payload(entry_ids=[ENTRY_B], title="改过的标题"))
    )
    assert updated.entry_ids == [ENTRY_B]
    assert updated.entry_ids_auto is False


def test_update_without_entry_ids_keeps_existing_links(db_session):
    """旧客户端 / 助手的局部更新不带 entry_ids：整体替换语义不能顺手清掉关联。"""
    record = _confirmed_claim(db_session, entry_ids=[ENTRY_A])
    _set_auto_flag(db_session, record)

    updated = update_claim(db_session, record, ClaimUpdate(**_payload(title="改过的标题")))
    assert updated.entry_ids == [ENTRY_A]
    assert updated.entry_ids_auto is True, "没动关联就不该把自动标记清掉"


def test_explicitly_clearing_links_is_persisted(db_session):
    """用户真的清空关联时要能清掉（与"没传字段"区分开）。"""
    record = _confirmed_claim(db_session, entry_ids=[ENTRY_A])
    updated = update_claim(db_session, record, ClaimUpdate(**_payload(entry_ids=[])))
    assert updated.entry_ids == []
