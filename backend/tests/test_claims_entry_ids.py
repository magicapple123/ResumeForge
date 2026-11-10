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


# ===== 升级用户形态：迁移 0009 之后仍是 NULL 的旧行（读取层必须容忍） =====


def _legacy_null_claim(db_session) -> ClaimRecord:
    """造一条 pre-0009 形态的行：两个新列都是 NULL。

    迁移的保守回填只处理能按主体名匹配上的那部分，其余行**保持 NULL**（"不确定就不猜"）。
    ORM 插入会把 None 当成"未赋值"而套用 Python 默认值，所以 NULL 形态要用一条显式
    UPDATE 造出来——那正是 0009 加列时旧行的样子（造法同
    ``tests/test_migration_0009_claim_entry_ids.py``）。
    """
    record = _confirmed_claim(db_session, entry_ids=[])
    db_session.execute(
        text(
            "UPDATE claim_record SET entry_ids = NULL, entry_ids_auto = NULL WHERE id = :claim_id"
        ),
        {"claim_id": record.id},
    )
    db_session.commit()
    db_session.refresh(record)
    assert record.entry_ids is None, "前提：NULL 形态没造出来，后面的断言就没有意义"
    assert record.entry_ids_auto is None
    return record


def test_upgraded_rows_with_null_entry_ids_stay_readable(client, db_session):
    """2.0.0 升上来的库：NULL 行不能把列表与详情一起打挂（修复前两处都是 500）。

    缺省语义在读取边界收敛：NULL / 缺失 = 从未关联（``entry_ids == []``、
    ``entry_ids_auto is False``）。写入口径不受影响——这两列不进任何必填校验。
    """
    legacy = _legacy_null_claim(db_session)
    linked = _confirmed_claim(db_session, entry_ids=[ENTRY_A])
    _set_auto_flag(db_session, linked)

    listed = client.get("/api/claims")
    assert listed.status_code == 200, listed.text
    rows = {item["id"]: item for item in listed.json()["items"]}
    assert rows[legacy.id]["entry_ids"] == []
    assert rows[legacy.id]["entry_ids_auto"] is False
    # 已有关联的行一个字都不变：自动回填标记仍要读得出来（界面靠它显示「请核对」）。
    assert rows[linked.id]["entry_ids"] == [ENTRY_A]
    assert rows[linked.id]["entry_ids_auto"] is True

    detail = client.get(f"/api/claims/{legacy.id}")
    assert detail.status_code == 200, detail.text
    assert detail.json()["entry_ids"] == []
    assert detail.json()["entry_ids_auto"] is False

    # 界面真正在用的分页端点与事实基线同样不能被一条旧行打挂。
    page = client.get("/api/claims/page")
    assert page.status_code == 200, page.text
    page_rows = {item["id"]: item for item in page.json()["items"]}
    assert page_rows[legacy.id]["linked"] is False
    assert page_rows[legacy.id]["linked_auto"] is False
    assert client.get("/api/claims/baseline").status_code == 200


def test_read_defaults_do_not_loosen_the_write_path():
    """缺省语义只作用于回包：写入口径照旧拒绝 null 与非法 entry_id。"""
    for schema in (ClaimCreate, ClaimUpdate):
        with pytest.raises(ValidationError):
            schema(**_payload(entry_ids=None))
        with pytest.raises(ValidationError):
            schema(**_payload(entry_ids=["1"]))
