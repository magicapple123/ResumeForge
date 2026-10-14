"""写入提案批准端点的真实 HTTP 路径（PR-02 / PR-03，2026-10-13 生产审计）。

既有 ``test_assistant_authorization.py`` 只覆盖内存状态机；本文件用 TestClient 走
**真实 POST /approve 端点**，钉住：

- 批准端点真的把写入落库（PR-02 复现：工厂未实例化直接 ``with`` → TypeError）；
- 二次点击不重复写入；
- 会话打开失败 / 提交失败返回结构化错误且提案进入可解释终态（不卡"已核销未执行"）；
- 提案绑定数据集代次：A→B→A 之后旧提案批准被拒（410/409 类语义）；
- GET 提案状态不暴露其他作用域的提案详情；
- 冻结工厂从租约身份派生：切换尝试期间写入仍落原库。
"""

from datetime import datetime

from app import database
from app.models.reminder import Reminder
from app.runtime import dataset_scope
from app.services.assistant_tools import policy as tool_policy
from app.services.assistant_tools.authorization import (
    WritePreview,
    create_proposal,
)

_APPROVE = "/api/assistant/write-proposals/{}/approve"
_GET = "/api/assistant/write-proposals/{}"
_TARGET_TOOL = "create_reminder"
_ARGUMENTS = {"title": "复盘", "remind_at": "2026-10-12T10:00:00"}


def _preview() -> WritePreview:
    return WritePreview(target="日历提醒新提醒", scope="新增 1 条", changes=[])


def _proposal(writable: bool = True):
    ctx = tool_policy.build_context(writable=writable)
    return create_proposal(ctx, _TARGET_TOOL, dict(_ARGUMENTS), _preview())


def _reminder_count() -> int:
    with database.SessionLocal() as session:
        return session.query(Reminder).count()


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


# ===== PR-02：真实 POST 批准路径 =====


def test_approve_endpoint_actually_persists_the_write(client):
    """批准端点应成功执行写入并落库（PR-02 复现：修复前 TypeError，写入不发生）。"""
    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["proposal"]["status"] == "executed"
    assert body["changed"] is True
    # 写入真的落了库，而不只是状态机翻转。
    assert _reminder_count() == 1


def test_second_approve_click_does_not_duplicate_the_write(client):
    proposal = _proposal()
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 200
    second = client.post(_APPROVE.format(proposal.proposal_id))
    assert second.status_code == 409
    assert _reminder_count() == 1  # 绝不因二次点击写两条


def test_session_open_failure_returns_structured_error_and_marks_failed(client, monkeypatch):
    """会话打不开：结构化错误 + mark_failed（可解释终态），不卡"已核销未执行"。"""

    def broken_factory(_identity=None):
        def _open():
            raise OSError("SYNTHETIC_PRIVATE_DATABASE_PATH token=synthetic-secret")

        return _open

    monkeypatch.setattr(dataset_scope, "frozen_session_factory", broken_factory)
    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))
    assert response.status_code == 503, response.text
    assert "写入" in response.json()["detail"]
    assert "SYNTHETIC_PRIVATE" not in response.text
    assert "synthetic-secret" not in response.text
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.status_code == 200
    assert final.json()["proposal"]["status"] == "failed"
    assert "SYNTHETIC_PRIVATE" not in final.text
    assert _reminder_count() == 0
    # 终态不可重放：再点批准仍是 409，不会出现第二次写入尝试。
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409


def test_commit_failure_returns_explicit_uncertain_state(client, monkeypatch):
    """提交阶段失败：返回明确的"结果未知"状态，绝不自动二次写入。

    写服务在 handler 内部自行提交（第一次 commit 放行）；端点收尾提交
    （第二次）失败 —— 此时写入可能已生效也可能没有，置 unknown。
    """
    from sqlalchemy.orm import Session

    real_commit = Session.commit
    calls = {"n": 0}

    def flaky_commit(self):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise OSError("模拟：提交时磁盘写入失败")
        return real_commit(self)

    monkeypatch.setattr(Session, "commit", flaky_commit)
    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))
    assert response.status_code == 409, response.text
    assert "未知" in response.json()["detail"]
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.json()["proposal"]["status"] == "unknown"
    # "结果未知"绝不自动二次执行：再点批准被拒。
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409


def test_handler_failure_marks_failed_and_does_not_leave_approved_state(client, monkeypatch):
    def broken_create(_db, _payload):
        raise OSError("模拟：写入执行失败")

    # report_tools 在导入时绑定了 create_reminder_record，patch 必须打在绑定处。
    monkeypatch.setattr(
        "app.services.assistant_tools.report_tools.create_reminder_record", broken_create
    )
    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))
    assert response.status_code == 422, response.text
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.json()["proposal"]["status"] == "failed"
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409


# ===== PR-03：数据集身份贯穿创建 → 批准 → 执行 =====


def test_stale_proposal_after_a_b_a_switch_is_rejected(client):
    """A→B→A：dataset_id 相同但代次已前进，旧提案批准被拒、不落库。"""
    other = _create_dataset(client, "目标库 B")
    # 在 A（主数据）上创建提案。
    proposal_on_a = _proposal()
    # 切到 B 再创建一条针对 B 的提案。（失败带响应体：detail 点名残留租约 owner）
    activate_b_first = _activate(client, other)
    assert activate_b_first.status_code == 200, activate_b_first.text
    proposal_on_b = _proposal()
    # A → B → A（主数据）→ B：dataset_id 回到 B，代次已前进了两步。
    activate_main = _activate(client, "main")
    assert activate_main.status_code == 200, activate_main.text
    activate_back = _activate(client, other)
    # 失败时带响应体：detail 里点名残留的租约 owner，便于定位排空窗的阻塞者。
    assert activate_back.status_code == 200, activate_back.text

    response = client.post(_APPROVE.format(proposal_on_b.proposal_id))
    assert response.status_code == 409, response.text
    assert _reminder_count() == 0  # B 库没有串入旧提案的写入
    # 主数据上的旧提案同样失效。
    response_a = client.post(_APPROVE.format(proposal_on_a.proposal_id))
    assert response_a.status_code == 409


def test_get_proposal_hides_details_of_other_scope(client):
    """GET 提案状态：作用域（数据集代次）不一致时不暴露提案详情。"""
    proposal = _proposal()
    assert client.get(_GET.format(proposal.proposal_id)).status_code == 200
    other = _create_dataset(client, "别的作用域")
    assert _activate(client, other).status_code == 200
    hidden = client.get(_GET.format(proposal.proposal_id))
    assert hidden.status_code == 409
    assert "proposal" not in hidden.json()


def test_frozen_factory_from_lease_identity_survives_a_switch_attempt(client):
    """冻结工厂从租约身份派生：持有租约时切换被挡，写入始终落在原库。"""
    from app.dataset_registry import dataset_database_file
    from app.models.job import Job

    with database.SessionLocal() as session:
        session.add(Job(title="租约期间的原库岗位", company="A"))
        session.commit()

    lease = dataset_scope.acquire_lease("proposal-test")
    try:
        factory = dataset_scope.frozen_session_factory(lease.identity)
        other = _create_dataset(client, "租约挡住的切换")
        assert _activate(client, other).status_code == 409  # 租约封死切换
        # 即便身份漂移，工厂仍绑定租约发布时刻的引擎。
        with factory() as db:
            db.add(Job(title="租约工厂写入", company="A"))
            db.commit()
    finally:
        lease.release()

    # 原库（主数据文件）里能看到两条；目标库 B 文件保持空。
    main_file = dataset_database_file("main")
    probe = database.build_engine(database.database_url_for(main_file))
    try:
        from sqlalchemy import select
        from sqlalchemy.orm import Session

        with Session(bind=probe) as session:
            titles = {row for row in session.execute(select(Job.title)).scalars()}
        assert {"租约期间的原库岗位", "租约工厂写入"} <= titles
    finally:
        probe.dispose()


# ===== PR-18：切换持锁期间的批准请求（「租约先行」的端点级分支，此前无测试） =====


def test_approve_while_switch_lock_held_returns_409_and_keeps_proposal_pending(client):
    """切换持锁期间批准 → 409，提案保持 pending；锁释放后同一提案可重试成功。

    端点契约是「租约先行」：拿不到租约直接 409，且**不**把提案推进到任何终态
    （不是 approved/failed）——这条失败必须可重试。授权层单测
    （test_dataset_scope.py::test_acquire_lease_fails_while_switch_lock_is_held）
    钉过锁语义，但端点级"409 + 提案原样保留 + 稍后重试成功"整条链此前没人守。
    """
    proposal = _proposal()
    with dataset_scope.switch_lock():
        response = client.post(_APPROVE.format(proposal.proposal_id))
        assert response.status_code == 409
        assert "切换" in response.json()["detail"]
        # 提案原样保留：没有 approved/executed/failed 的脏迁移，写入也没有发生。
        status = client.get(_GET.format(proposal.proposal_id))
        assert status.status_code == 200
        assert status.json()["proposal"]["status"] == "pending"
        assert _reminder_count() == 0
    # 锁释放后重试成功：409 是"稍后再试"，不是终态。
    retry = client.post(_APPROVE.format(proposal.proposal_id))
    assert retry.status_code == 200, retry.text
    assert _reminder_count() == 1


# ===== RR-05：提交后失败必须是"结果未知"，不能报成"执行失败" =====


def test_handler_failure_after_internal_commit_is_unknown_not_failed(client, monkeypatch):
    """handler 内部已提交、随后步骤（如 refresh/构造返回值）失败。

    修复前这里返回 422「写入执行失败」并 mark_failed——而数据其实已经落库，用户照着
    提示重发就会二次写入。现在如实报"结果未知"（409）并封死这条提案。
    """
    from app.api import assistant_proposals as endpoint

    class _CommittingTool:
        name = _TARGET_TOOL

        def handler(self, db, arguments):
            # 真实写工具就是这么写的：服务层自己 commit，之后才构造返回值。
            db.add(
                Reminder(
                    title=str(arguments.get("title") or "复盘"),
                    remind_at=datetime(2026, 10, 12, 10, 0, 0),
                )
            )
            db.commit()
            raise RuntimeError("模拟：提交之后构造返回值时失败")

    monkeypatch.setattr(endpoint, "get_tool", lambda _name: _CommittingTool())

    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))

    assert response.status_code == 409, response.text
    assert "结果未知" in response.json()["detail"]
    # 数据确实写进去了：这才是"不能说执行失败"的理由。
    assert _reminder_count() == 1
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.status_code == 200
    assert final.json()["proposal"]["status"] == "unknown"
    # 终态封死重放：再点批准也不会有第二次写入。
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409
    assert _reminder_count() == 1


def test_handler_failure_before_any_commit_is_still_reported_as_failed(client, monkeypatch):
    """对照组：提交之前就抛，数据没有任何变化——这时"执行失败"才是真话。"""
    from app.api import assistant_proposals as endpoint

    class _FailingTool:
        name = _TARGET_TOOL

        def handler(self, db, arguments):
            raise RuntimeError("模拟：校验阶段失败")

    monkeypatch.setattr(endpoint, "get_tool", lambda _name: _FailingTool())

    proposal = _proposal()
    response = client.post(_APPROVE.format(proposal.proposal_id))

    assert response.status_code == 422, response.text
    assert "写入执行失败" in response.json()["detail"]
    assert _reminder_count() == 0
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.json()["proposal"]["status"] == "failed"
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409
    assert _reminder_count() == 0


def test_concurrent_approvals_write_at_most_once(client):
    """两个批准请求并发：只有一个能核销成功，写入恰好发生一次。"""
    import threading

    proposal = _proposal()
    results: list[int] = []
    barrier = threading.Barrier(2)

    def _approve() -> None:
        barrier.wait()
        # 每个线程各自一个 TestClient，避免共享连接状态。
        from app.main import app as fastapi_app
        from fastapi.testclient import TestClient

        with TestClient(fastapi_app) as thread_client:
            results.append(thread_client.post(_APPROVE.format(proposal.proposal_id)).status_code)

    threads = [threading.Thread(target=_approve) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    assert sorted(results) == [200, 409], results
    assert _reminder_count() == 1


def test_real_tool_failure_after_its_own_commit_is_reported_as_unknown(client, monkeypatch):
    """真实写工具（create_candidate_job）在 commit 之后的 refresh 上失败。

    这条用例不注入假 handler：直接让 SQLAlchemy 的 ``Session.refresh`` 在该工具的
    提交之后抛一次错，复现"数据已落库、但 handler 抛异常"的真实形态。
    """
    from app.models.material import CandidateJob
    from app.services.assistant_tools.authorization import WritePreview, create_proposal
    from sqlalchemy.orm import Session as OrmSession

    real_refresh = OrmSession.refresh

    def exploding_refresh(self, instance, *args, **kwargs):
        if isinstance(instance, CandidateJob):
            raise RuntimeError("模拟：提交之后 refresh 失败")
        return real_refresh(self, instance, *args, **kwargs)

    monkeypatch.setattr(OrmSession, "refresh", exploding_refresh)

    ctx = tool_policy.build_context(writable=True)
    proposal = create_proposal(
        ctx,
        "create_candidate_job",
        {"title": "后端开发（虚构）", "company": "示例科技"},
        WritePreview(target="备选岗位新条目", scope="新增 1 条", changes=[]),
    )

    response = client.post(_APPROVE.format(proposal.proposal_id))
    assert response.status_code == 409, response.text
    assert "结果未知" in response.json()["detail"]
    final = client.get(_GET.format(proposal.proposal_id))
    assert final.json()["proposal"]["status"] == "unknown"

    with database.SessionLocal() as session:
        stored = session.query(CandidateJob).all()
    assert [row.title for row in stored] == ["后端开发（虚构）"], "提交确实生效了"
    # 再次批准不会二次写入。
    assert client.post(_APPROVE.format(proposal.proposal_id)).status_code == 409
    with database.SessionLocal() as session:
        assert session.query(CandidateJob).count() == 1
