"""批次 B（多选能力补齐·后端侧）的用例：五个域的批量软删除端点。

语义对齐 ``POST /api/resumes/batch-delete``（批次 A 范本）：请求体带去重、上限
500 的 id 列表；任何一条 id 不存在或已在回收站里即整体 404 并附缺失 id 清单，
不做"删一半"；删除走 ``trash.soft_delete``（与各域单条删除同一软删语义），
回收站里可恢复。

``user-files`` 不在本批次内：该域只有列表/反查/下载/打开端点，没有删除能力
（文件副本的生命周期由资料/附件入口管理），不发明新删除语义。
"""

import pytest
from app.models.apply import (
    TASK_KIND_APPLY,
    TASK_STATUS_COMPLETED,
    ApplyTask,
    ApplyTaskItem,
)
from app.models.claim import ClaimRecord
from app.models.interview_experience import InterviewExperience
from app.models.knowledge_entry import KnowledgeEntry
from app.models.material import Material
from app.models.referral import Referral

pytestmark = pytest.mark.usefixtures("client")

# 每个域的接入参数：端点、请求体字段名、回收站类型键、列表端点与 ORM 造数据工厂。
DOMAINS: dict[str, dict] = {
    "knowledge": {
        "endpoint": "/api/knowledge/batch-delete",
        "field": "knowledge_ids",
        "trash_type": "knowledge_entry",
        "list_path": "/api/knowledge/page",
        "factory": lambda n: KnowledgeEntry(
            title=f"知识库条目 {n}", category="面试问答", content="批量删除测试正文"
        ),
    },
    "materials": {
        "endpoint": "/api/materials/batch-delete",
        "field": "material_ids",
        "trash_type": "material",
        "list_path": "/api/materials/page",
        "factory": lambda n: Material(
            title=f"资料 {n}", category="证书", content="批量删除测试正文"
        ),
    },
    "claims": {
        "endpoint": "/api/claims/batch-delete",
        "field": "claim_ids",
        "trash_type": "claim",
        "list_path": "/api/claims/page",
        "factory": lambda n: ClaimRecord(
            title=f"台账条目 {n}",
            subject="示例公司",
            source_fact="原始事实",
            candidate_wording="候选表述",
        ),
    },
    "interview_experiences": {
        "endpoint": "/api/interview-experiences/batch-delete",
        "field": "experience_ids",
        "trash_type": "interview_experience",
        "list_path": "/api/interview-experiences/page",
        "factory": lambda n: InterviewExperience(
            title=f"面经 {n}", company="示例公司", position="数据分析", content="正文"
        ),
    },
    "referrals": {
        "endpoint": "/api/referrals/batch-delete",
        "field": "referral_ids",
        "trash_type": "referral",
        "list_path": "/api/referrals",
        "factory": lambda n: Referral(
            referrer_name=f"内推人 {n}", position="数据分析", company="示例公司"
        ),
    },
}


def _insert(db_session, cfg: dict, n: int) -> int:
    row = cfg["factory"](n)
    db_session.add(row)
    db_session.commit()
    db_session.refresh(row)
    return row.id


def _list_ids_and_total(client, cfg: dict) -> tuple[set[int], int]:
    """列表端点的 (可见 id 集合, total)。内推是全量列表，total 即列表长度。"""
    payload = client.get(cfg["list_path"]).json()
    rows = payload["items"] if isinstance(payload, dict) else payload
    total = payload["total"] if isinstance(payload, dict) else len(rows)
    return {row["id"] for row in rows}, total


def _trash_hit_count(client, cfg: dict, ids: list[int]) -> int:
    items = client.get("/api/trash", params={"type": cfg["trash_type"]}).json()["items"]
    trashed = {item["id"] for item in items}
    return sum(1 for item_id in ids if item_id in trashed)


@pytest.mark.parametrize("domain", sorted(DOMAINS))
def test_batch_delete_soft_deletes_and_lands_in_trash(client, db_session, domain):
    cfg = DOMAINS[domain]
    ids = [_insert(db_session, cfg, n) for n in range(3)]
    assert _trash_hit_count(client, cfg, ids) == 0
    listed_before, total_before = _list_ids_and_total(client, cfg)

    response = client.post(cfg["endpoint"], json={cfg["field"]: ids})

    assert response.status_code == 200
    assert response.json() == {"deleted": 3}
    # 回收站该域 +3，且列表端点不再可见、total 相应减少。
    assert _trash_hit_count(client, cfg, ids) == 3
    listed_after, total_after = _list_ids_and_total(client, cfg)
    assert listed_before - listed_after == set(ids)
    assert total_after == total_before - 3


@pytest.mark.parametrize("domain", sorted(DOMAINS))
def test_batch_delete_rejects_unknown_id_without_partial_delete(client, db_session, domain):
    """缺一不删：混入一个不存在的 id，已有条目一条都不许动（全有全无）。"""
    cfg = DOMAINS[domain]
    keep = _insert(db_session, cfg, 0)

    response = client.post(cfg["endpoint"], json={cfg["field"]: [keep, keep + 999999]})

    assert response.status_code == 404
    assert "不存在或已被删除" in response.json()["detail"]
    listed, _total = _list_ids_and_total(client, cfg)
    assert keep in listed
    assert _trash_hit_count(client, cfg, [keep]) == 0


@pytest.mark.parametrize("domain", sorted(DOMAINS))
def test_batch_delete_rejects_empty_and_oversized(client, domain):
    cfg = DOMAINS[domain]
    assert client.post(cfg["endpoint"], json={cfg["field"]: []}).status_code == 422
    too_many = client.post(cfg["endpoint"], json={cfg["field"]: list(range(1, 502))})
    assert too_many.status_code == 422


# ===== 投递记录（POST /api/apply/records/batch-delete）=====

# 投递记录挂在批次（ApplyTask）下面，与上面五个"平铺域"的造数方式不同，
# 但端点语义完全同口径，单独写三例而不是硬塞进 DOMAINS 参数化。


@pytest.fixture
def apply_batch_with_records(db_session):
    task = ApplyTask(kind=TASK_KIND_APPLY, status=TASK_STATUS_COMPLETED, total=3)
    db_session.add(task)
    db_session.commit()
    ids = []
    for index in range(3):
        item = ApplyTaskItem(task_id=task.id, job_title=f"岗位{index}", company="某公司")
        db_session.add(item)
        db_session.commit()
        db_session.refresh(item)
        ids.append(item.id)
    return task, ids


def _visible_record_ids(client, task_id: int) -> set[int]:
    payload = client.get(f"/api/apply/records/batches/{task_id}/items").json()
    return {row["id"] for row in payload["items"]}


def _apply_record_trash_count(client, ids: list[int]) -> int:
    items = client.get("/api/trash", params={"type": "apply_record"}).json()["items"]
    trashed = {item["id"] for item in items}
    return sum(1 for item_id in ids if item_id in trashed)


def test_apply_records_batch_delete_soft_deletes_and_lands_in_trash(
    client, apply_batch_with_records
):
    task, ids = apply_batch_with_records
    assert _apply_record_trash_count(client, ids) == 0

    response = client.post("/api/apply/records/batch-delete", json={"record_ids": ids})

    assert response.status_code == 200
    assert response.json() == {"deleted": 3}
    assert _apply_record_trash_count(client, ids) == 3
    # 明细分页端点不再可见；批次行本身保留（与整批删除同一语义）。
    assert _visible_record_ids(client, task.id) == set()


def test_apply_records_batch_delete_rejects_unknown_id_without_partial_delete(
    client, apply_batch_with_records
):
    _task, ids = apply_batch_with_records
    keep = ids[0]

    response = client.post(
        "/api/apply/records/batch-delete", json={"record_ids": [keep, keep + 999999]}
    )

    assert response.status_code == 404
    assert "不存在或已被删除" in response.json()["detail"]
    assert _apply_record_trash_count(client, [keep]) == 0


def test_apply_records_batch_delete_rejects_empty_and_oversized(client):
    assert (
        client.post("/api/apply/records/batch-delete", json={"record_ids": []}).status_code == 422
    )
    too_many = client.post(
        "/api/apply/records/batch-delete", json={"record_ids": list(range(1, 502))}
    )
    assert too_many.status_code == 422
