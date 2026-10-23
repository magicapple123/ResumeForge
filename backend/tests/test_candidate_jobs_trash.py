# SPDX-License-Identifier: Apache-2.0
"""备选岗位的软删除闭环（0050）：删掉 → 回收站 → 恢复 → 彻底删除。

**为什么单独一份**：``test_trash.py`` 验的是"每类内容删掉之后到处都看不到"的横向一致性，
而这里钉的是备选岗位**独有**的那一条取舍——它进回收站之后，去重判据必须**排除**已删的候选
（与岗位广场相反）。写反了不会报错，只会让用户"删了这条岗位之后就再也采集不回来"，
而这个现象极难和"网站没搜到"区分开。

同时也覆盖"每一个读取入口都要排除已删"：列表 / 分页 / 全选 id / 单条 / CSV 导出 /
助手工具 ——漏掉任何一处，用户就会看到"删了但某处还在"。
"""

from __future__ import annotations

import json

from app.models.material import CandidateJob
from app.schemas.material import CandidateJobCreate
from app.services import trash
from app.services.apply.collector import Collector
from app.services.assistant_tools.data_tools.candidate_jobs import _tool_list_candidate_jobs
from app.services.candidate_csv import find_duplicate, import_candidate_rows
from app.services.candidate_jobs import (
    candidate_or_none,
    delete_candidate_job,
    find_staged_candidate,
    import_candidates,
    list_candidate_job_ids,
    list_candidate_jobs,
    list_candidate_jobs_page,
    stage_candidate_job,
)
from app.services.sites.base import SearchResult


def _candidate(db, **overrides) -> CandidateJob:
    """建一条待处理候选（与采集落库同一个函数，字段齐全）。"""
    data = {
        "title": "后端开发",
        "company": "A公司",
        "source_url": "https://example.com/job/1",
        "description": "岗位职责：负责后端服务。",
        "requirements": "任职要求：三年经验。",
        "source": "示例站点",
    }
    data.update(overrides)
    candidate = stage_candidate_job(db, **data)
    db.commit()
    db.refresh(candidate)
    return candidate


# ===== ① 闭环：软删 → 回收站 → 恢复 → 彻底删除 =====


def test_soft_delete_then_restore_then_purge(db_session, client):
    candidate = _candidate(db_session)
    candidate_id = candidate.id

    # 删除：列表 / 分页 / 全选 id 三处同时看不到（它们共用 _filtered_query）。
    assert client.delete(f"/api/candidate-jobs/{candidate_id}").status_code == 204
    assert client.get("/api/candidate-jobs").json() == []
    assert client.get("/api/candidate-jobs/page").json()["total"] == 0
    assert client.get("/api/candidate-jobs/ids").json() == []
    # 单条读取按 404 处理：列表里看不到、知道 id 也不能继续打开或编辑。
    assert client.get(f"/api/candidate-jobs/{candidate_id}").status_code == 404
    assert (
        client.put(f"/api/candidate-jobs/{candidate_id}", json={"title": "改个名"}).status_code
        == 404
    )

    # 但回收站里有它，且带类型标签。
    summary = client.get("/api/trash").json()
    mine = [item for item in summary["items"] if item["type"] == "candidate_job"]
    assert [item["id"] for item in mine] == [candidate_id]
    assert mine[0]["type_label"] == "备选岗位"
    assert mine[0]["title"] == "后端开发"
    assert mine[0]["subtitle"] == "A公司"

    # 恢复：回到列表，且字段完整。
    assert client.post(f"/api/trash/candidate_job/{candidate_id}/restore").status_code == 204
    restored = client.get("/api/candidate-jobs").json()
    assert [item["id"] for item in restored] == [candidate_id]

    # 彻底删除：只有先进回收站才允许（"删除"永远先经过可恢复的一步）。
    assert client.delete(f"/api/trash/candidate_job/{candidate_id}").status_code == 404, (
        "不在回收站里的记录不许被彻底删除"
    )
    assert client.delete(f"/api/candidate-jobs/{candidate_id}").status_code == 204
    assert client.delete(f"/api/trash/candidate_job/{candidate_id}").status_code == 204
    # 接口用的是自己的会话，本会话的 identity map 里还是删除前那一份：先失效再查。
    db_session.expire_all()
    assert db_session.get(CandidateJob, candidate_id) is None, "彻底删除必须真的删掉这一行"
    assert candidate_or_none(db_session, candidate_id) is None


def test_soft_delete_is_idempotent_on_the_timestamp(db_session):
    """重复软删不刷新删除时间：否则重复点删除会让它在回收站里不断上浮。"""
    candidate = _candidate(db_session)
    assert delete_candidate_job(db_session, candidate.id) is True
    first = candidate.deleted_at
    assert first is not None

    # 已删的再删一次按"不存在"处理（接口 404），时间戳保持不变。
    assert delete_candidate_job(db_session, candidate.id) is False
    db_session.refresh(candidate)
    assert candidate.deleted_at == first


def test_csv_export_refuses_deleted_candidates(db_session, client):
    """导出勾选里混进一条已删的：整批 404，不静默少导出几条。"""
    keep = _candidate(db_session, title="留下", source_url="https://example.com/keep")
    gone = _candidate(db_session, title="删掉", source_url="https://example.com/gone")
    assert client.delete(f"/api/candidate-jobs/{gone.id}").status_code == 204

    response = client.post(
        "/api/candidate-jobs/csv/export", json={"candidate_ids": [keep.id, gone.id]}
    )
    assert response.status_code == 404
    assert str(gone.id) in response.json()["detail"]


# ===== ② 去重：已删的候选不许继续拦住采集 / 导入 =====


def test_deleted_candidate_does_not_block_recollection(db_session):
    """删掉一条候选之后必须还能采回来（**与岗位广场那条相反**）。"""
    candidate = _candidate(db_session)
    identity = {"title": "后端开发", "company": "A公司", "source_url": "https://example.com/job/1"}
    assert find_staged_candidate(db_session, **identity) is not None

    trash.soft_delete(db_session, "candidate_job", candidate)
    db_session.commit()

    assert find_staged_candidate(db_session, **identity) is None, (
        "已软删的候选仍在去重里 —— 用户删了它，这条岗位就再也采集不回来了"
    )
    # 采集判定随之回到"没采过"，于是会重新落进暂存区。
    state = Collector()._already_known(
        db_session, SearchResult(title="后端开发", company="A公司", url="https://example.com/job/1")
    )  # noqa: SLF001
    assert state == ""


def test_trashed_job_still_blocks_recollection(db_session):
    """对照项：岗位广场那条**不改**——回收站里的正式岗位仍算"已存在"（否则会造出第二条）。"""
    from app.models.job import Job

    job = Job(title="后端开发", company="A公司", source_url="https://example.com/job/1")
    db_session.add(job)
    db_session.commit()
    trash.soft_delete(db_session, "job", job)
    db_session.commit()

    state = Collector()._already_known(
        db_session, SearchResult(title="后端开发", company="A公司", url="https://example.com/job/1")
    )  # noqa: SLF001
    assert state == "trashed", "岗位广场的去重必须把回收站里的也算已存在，这样界面才能说明原因"


def test_csv_duplicate_check_ignores_deleted_candidates(db_session):
    """删了再导同一份 CSV：不该每一行都被判"已有这一条"却看不见任何东西。"""
    candidate = _candidate(db_session)
    trash.soft_delete(db_session, "candidate_job", candidate)
    db_session.commit()

    assert find_duplicate(db_session, "后端开发", "A公司", "https://example.com/job/1") is None

    imported, failed = import_candidate_rows(
        db_session,
        [(2, {"title": "后端开发", "company": "A公司", "source_url": "https://example.com/job/1"})],
    )
    assert imported == 1 and failed == []
    live = list_candidate_jobs(db_session)
    assert len(live) == 1, "已删的那条仍在列表里，或者新导入的那条没进去"
    assert live[0].id != candidate.id, "导进来的是一条新候选，不是把已删的那条拽回来"


def test_import_marks_deleted_candidates_as_missing(db_session):
    """勾选导入里混进一条已删的：如实记 missing，不给它建正式岗位。"""
    candidate = _candidate(db_session)
    trash.soft_delete(db_session, "candidate_job", candidate)
    db_session.commit()

    result = import_candidates(db_session, [candidate.id])

    assert result["imported"] == 0
    assert result["missing"] == 1
    assert result["results"] == [{"candidate_id": candidate.id, "title": "", "outcome": "missing"}]


# ===== ③ 助手工具也要排除已删 =====


def test_assistant_list_excludes_deleted_candidates(db_session):
    keep = _candidate(db_session, title="留下", source_url="https://example.com/keep")
    gone = _candidate(db_session, title="删掉", source_url="https://example.com/gone")
    trash.soft_delete(db_session, "candidate_job", gone)
    db_session.commit()

    payload = _tool_list_candidate_jobs(db_session, {})
    listed = {item["id"] for item in json.loads(payload.text)["备选岗位"]}

    assert listed == {keep.id}


def test_page_listing_excludes_deleted_candidates(db_session):
    """分页列表与旧列表共用过滤口径：一处漏了就会"翻页后又看见它"。"""
    keep = _candidate(db_session, title="留下", source_url="https://example.com/keep")
    gone = _candidate(db_session, title="删掉", source_url="https://example.com/gone")
    trash.soft_delete(db_session, "candidate_job", gone)
    db_session.commit()

    rows, total = list_candidate_jobs_page(db_session, page=1, page_size=20)

    assert total == 1
    assert [row.id for row in rows] == [keep.id]
    assert list_candidate_job_ids(db_session) == [keep.id]


def test_create_candidate_job_still_lands_live(db_session):
    """新建的候选 ``deleted_at`` 必须是 None（默认值漏了会让新记录一进列表就消失）。"""
    from app.services.candidate_jobs import create_candidate_job

    created = create_candidate_job(
        db_session, CandidateJobCreate(title="新建候选", company="B公司", raw_text="JD 原文")
    )

    assert created.deleted_at is None
    assert [item.id for item in list_candidate_jobs(db_session)] == [created.id]


# ===== ④ QA 补充：去重 / 计数 / 备份口径的边界 =====


_IDENTITY = {"title": "后端开发", "company": "A公司", "source_url": "https://example.com/job/1"}


def test_recollection_after_delete_really_lands_a_new_row(db_session):
    """B7 的完整闭环：删掉之后**真的能重新入库**，不是只在判据上返回 None。

    上一条用例只证明 ``find_staged_candidate`` 不再挡；这条继续走到落库：
    新行必须真的插进去（表上没有唯一约束会抛 IntegrityError），列表里有它，
    回收站里那条仍在、且**不会被新行顶掉**。
    """
    gone = _candidate(db_session)

    trash.soft_delete(db_session, "candidate_job", gone)
    db_session.commit()

    recollected = stage_candidate_job(db_session, **_IDENTITY)
    db_session.commit()

    assert recollected.id != gone.id, "重新采集必须是一条新候选，不是把已删那条复活"
    assert recollected.deleted_at is None
    # 两行都在库里（软删除的语义：行还在，只是不显示）。
    assert db_session.query(CandidateJob).count() == 2
    live = list_candidate_jobs(db_session)
    assert [item.id for item in live] == [recollected.id]
    trashed = [item for item in trash.list_trashed(db_session, key="candidate_job")]
    assert [item["id"] for item in trashed] == [gone.id]


def test_live_candidate_still_blocks_recollection(db_session):
    """对照组：**没删**的候选仍必须拦住重复采集（否则同一岗位会越采越多）。"""
    live_candidate = _candidate(db_session)

    assert find_staged_candidate(db_session, **_IDENTITY) is live_candidate
    state = Collector()._already_known(  # noqa: SLF001
        db_session,
        SearchResult(title="后端开发", company="A公司", url="https://example.com/job/1"),
    )
    assert state == "existing"


def test_trash_counts_count_deleted_candidates_only(db_session, client):
    """回收站角标（``counts``）把已删的候选算进去，列表计数不把它算进去。"""
    kept = _candidate(db_session, title="留着", source_url="https://example.com/keep")
    gone = _candidate(db_session, title="删掉", source_url="https://example.com/gone")
    assert client.delete(f"/api/candidate-jobs/{gone.id}").status_code == 204

    payload = client.get("/api/trash").json()
    assert payload["counts"]["candidate_job"] == 1
    # 其它类型一条都没删：角标不该被候选的删除带偏。
    assert {key: value for key, value in payload["counts"].items() if value} == {"candidate_job": 1}
    assert client.get("/api/candidate-jobs/page").json()["total"] == 1
    assert [item["id"] for item in client.get("/api/candidate-jobs").json()] == [kept.id]


def test_backup_export_keeps_trashed_candidates_like_the_other_fifteen(db_session, tmp_path):
    """B9：备份导出对已软删的候选与其它 15 类**同一口径**（行照样进包）。

    导出走的是 SQLite 快照，所有类型的软删行都原样在包里——这条用例把"候选"与
    "岗位"并排比一次，防止有人以后给某一张表单独加 ``deleted_at IS NULL`` 过滤，
    造成"恢复备份后回收站里少了东西"。
    """
    import sqlite3
    import zipfile

    from app import database
    from app.models.job import Job
    from app.services.data_backup import DATABASE_MEMBER, create_backup_archive

    trashed_job = Job(title="删掉的岗位", company="某公司")
    trashed_candidate = _candidate(db_session)
    kept = _candidate(db_session, title="留着的候选", source_url="https://example.com/keep")
    db_session.add(trashed_job)
    db_session.commit()
    trash.soft_delete(db_session, "job", trashed_job)
    trash.soft_delete(db_session, "candidate_job", trashed_candidate)
    db_session.commit()

    archive = create_backup_archive(database.engine, tmp_path / "staging")
    snapshot = tmp_path / "snapshot.db"
    with zipfile.ZipFile(archive) as bundle:
        snapshot.write_bytes(bundle.read(DATABASE_MEMBER))

    with sqlite3.connect(snapshot) as connection:
        job_deleted = [row[0] for row in connection.execute("SELECT deleted_at FROM job")]
        candidate_rows = {
            title: deleted_at
            for title, deleted_at in connection.execute(
                "SELECT title, deleted_at FROM candidate_job"
            )
        }

    assert job_deleted and all(value is not None for value in job_deleted), (
        "岗位的软删行必须进包（这是既有口径，候选要与它一致）"
    )
    assert set(candidate_rows) == {trashed_candidate.title, kept.title}, (
        "候选的两行都必须进包：导出不是列表查询，不该过滤已软删的行"
    )
    assert candidate_rows[trashed_candidate.title] is not None, "已软删的候选必须原样在包里"
    assert candidate_rows[kept.title] is None


# ===== ⑤ QA 补第二轮：去重的**第二个判据**、恢复后的对称性、以及第三条单条入口 =====


def test_deleted_candidate_does_not_block_recollection_without_a_url(db_session):
    """去重有两条判据（先比链接，再退回"公司 + 岗位名"）：**两条都要排除已删的**。

    上面的用例都用同一条 ``source_url``，只走得到"比链接"那一支。若 ``skip_deleted``
    只加在链接那一支上，采集到一个**没有链接**（或链接变了，比如招聘网站改版重发）的
    同一岗位时，仍会被那条已删候选挡住——用户照样"删了却采不回来"，只是这种情形更难
    复现（要那个岗位恰好没链接）。
    """
    gone = _candidate(db_session, source_url="")
    trash.soft_delete(db_session, "candidate_job", gone)
    db_session.commit()

    # ① 没有链接：走"公司 + 岗位名"那一支。
    assert (
        find_staged_candidate(db_session, title="后端开发", company="A公司", source_url="") is None
    )
    # ② 链接不同（同一岗位换了发布地址）：链接那一支不命中，仍要落到第二支且不命中。
    assert (
        find_staged_candidate(
            db_session,
            title="后端开发",
            company="A公司",
            source_url="https://example.com/job/1-reposted",
        )
        is None
    )
    # ③ 采集侧同一套判据：结论回到"没采过"，于是会重新落进暂存区。
    state = Collector()._already_known(  # noqa: SLF001
        db_session, SearchResult(title="后端开发", company="A公司", url="")
    )
    assert state == ""


def test_live_candidate_without_a_url_still_blocks_by_name_and_company(db_session):
    """对照组：**没删**的候选在"没有链接"时仍必须拦住——否则同一岗位会越采越多。"""
    live_candidate = _candidate(db_session, source_url="")

    assert find_staged_candidate(db_session, title="后端开发", company="A公司", source_url="") is (
        live_candidate
    )
    assert (
        find_staged_candidate(
            db_session,
            title="后端开发",
            company="A公司",
            source_url="https://example.com/job/1-reposted",
        )
        is live_candidate
    )


def test_restore_puts_the_dedupe_guard_back(db_session):
    """**对称性**：删除放开去重，恢复就必须重新收紧。

    只测"删了能采回来"是不够的：若 ``skip_deleted`` 写成了"永远跳过候选表"，那删除后
    能采集、恢复后也照样能采集，用户会得到两条一模一样的候选——而界面上两条都看得见，
    却分不清当初恢复的是哪一条。
    """
    candidate = _candidate(db_session)
    trash.soft_delete(db_session, "candidate_job", candidate)
    db_session.commit()
    assert find_staged_candidate(db_session, **_IDENTITY) is None

    assert trash.restore(db_session, "candidate_job", candidate.id) is True

    restored = find_staged_candidate(db_session, **_IDENTITY)
    assert restored is not None and restored.id == candidate.id, (
        "恢复之后这条候选又算「已存在」了，去重必须重新生效"
    )


def test_mark_imported_on_deleted_candidate_is_404(db_session, client):
    """第三条单条入口：``POST /{id}/imported``。

    它同样走 ``candidate_or_none``，但漏掉的后果与读取不同——会把一条用户已删掉的候选
    标成"已导入"并挂上正式岗位 id，于是回收站里那条的记录与实际业务状态对不上。
    """
    candidate = _candidate(db_session)
    assert client.delete(f"/api/candidate-jobs/{candidate.id}").status_code == 204

    response = client.post(f"/api/candidate-jobs/{candidate.id}/imported", json={"job_id": 1})

    assert response.status_code == 404, response.text
    # 库里那一行没被改：状态仍是 pending、没有挂上岗位 id。
    from app.models.material import CANDIDATE_JOB_PENDING

    db_session.expire_all()
    row = db_session.get(CandidateJob, candidate.id)
    assert row.status == CANDIDATE_JOB_PENDING
    assert row.imported_job_id is None
