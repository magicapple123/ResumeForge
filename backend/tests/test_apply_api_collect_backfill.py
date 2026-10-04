"""投递台 API：投递记录、采集配置/任务与补齐详情（从 test_apply_queue_and_api.py 拆出）。

fake_runner fixture 定义在主文件（test_apply_queue_and_api.py），
经本模块命名空间解析；显式 re-export。
"""
import pytest

from app.models.apply import TASK_KIND_COLLECT
from app.services.apply import apply_service

from test_apply_queue_and_api import browser_port, fake_runner

# fake_runner 依赖 browser_port，两者都必须在本模块命名空间可解析。
__all__ = ["browser_port", "fake_runner"]


def test_records_endpoint_returns_a_page(client, db_session, fake_runner):
    response = client.get("/api/apply/records")

    assert response.status_code == 200
    body = response.json()
    assert body["items"] == []
    assert body["total"] == 0


# ===== 采集 =====


def test_collect_config_and_task(client, db_session, fake_runner):
    assert client.put("/api/collect/config", json={"keywords": ["后端"], "city": "北京"}).status_code == 200

    created = client.post("/api/collect/tasks")
    assert created.status_code == 200
    assert created.json()["kind"] == "collect"

    detail = client.get(f"/api/collect/tasks/{created.json()['id']}")
    assert detail.status_code == 200


def test_collect_task_requires_keywords(client, db_session, fake_runner):
    response = client.post("/api/collect/tasks")

    assert response.status_code == 400


def test_collect_task_omits_the_sample_flag_by_default(client, db_session, fake_runner):
    """默认不保存站点原文：不带该字段时任务 config 里**没有**这个键（保持旧任务的形状）。"""
    client.put("/api/collect/config", json={"keywords": ["后端"], "city": "北京"})

    created = client.post("/api/collect/tasks")

    assert created.status_code == 200
    assert "save_site_samples" not in created.json()["config"]


def test_collect_task_carries_the_sample_flag_when_requested(client, db_session, fake_runner):
    """请求体里带 ``save_site_samples=true`` 才写进 task.config，运行器据此安装录制装饰器。"""
    client.put("/api/collect/config", json={"keywords": ["后端"], "city": "北京"})

    created = client.post("/api/collect/tasks", json={"save_site_samples": True})

    assert created.status_code == 200
    assert created.json()["config"]["save_site_samples"] is True


def test_sample_flag_is_not_a_persisted_collect_config_field(client, db_session, fake_runner):
    """``save_site_samples`` 是每次采集一次性的，**不进**保存的采集配置：往返后不出现该键，
    而且把它塞进配置接口会被 ``extra="forbid"`` 拒绝（免得它变成一个会被回显的持久设置）。"""
    assert (
        client.put(
            "/api/collect/config", json={"keywords": ["后端"], "save_site_samples": True}
        ).status_code
        == 422
    )

    saved = client.put("/api/collect/config", json={"keywords": ["后端"], "city": "北京"})
    assert saved.status_code == 200
    body = client.get("/api/collect/config").json()
    assert "save_site_samples" not in body


# ===== 补齐详情（按岗位点名补抓 JD，仍然是 kind=collect）=====


def test_create_backfill_task_rejects_an_empty_selection(db_session, fake_runner):
    """空选择不能在业务层被放过：前端万一送来空数组，要给出一条可操作的中文提示，
    而不是建出一个"没岗位可补"的空任务。"""
    with pytest.raises(apply_service.ApplyBadRequest) as excinfo:
        apply_service.create_backfill_task(db_session, [])

    assert "选择" in excinfo.value.detail


def test_create_backfill_task_explains_the_batch_limit(db_session, fake_runner):
    """超过单批上限（200）时，报错文案必须给出可操作的说明（含上限数字 + "分批"），
    而不是一句干巴巴的"参数错误"——用户得知道该怎么做。"""
    ids = list(range(1, 202))  # 201 条 > MAX_BACKFILL_JOBS

    with pytest.raises(apply_service.ApplyBadRequest) as excinfo:
        apply_service.create_backfill_task(db_session, ids)

    message = excinfo.value.detail
    assert "200" in message
    assert "分批" in message


def test_create_backfill_task_dedupes_and_preserves_order(db_session, fake_runner):
    """重复 id 去重、且**保序**：``total`` 用去重后的数量，config 里的目标清单也去重保序
    （前端分批提交时会出现重复 id，不去重会让同一岗位被补两次、进度也虚高）。"""
    task = apply_service.create_backfill_task(db_session, [30, 10, 30, 20, 10])

    assert task.kind == TASK_KIND_COLLECT
    assert task.total == 3
    assert task.config["backfill_job_ids"] == [30, 10, 20]
    assert fake_runner.started == task.id


def test_create_backfill_task_conflicts_with_a_running_task(db_session, fake_runner):
    """同一时刻只跑一个批次：已有任务在跑时不许再建补详情任务，否则两个任务抢同一个浏览器。"""
    fake_runner.running = True

    with pytest.raises(apply_service.ApplyConflict):
        apply_service.create_backfill_task(db_session, [1])


def test_backfill_route_rejects_an_empty_selection(client, fake_runner):
    """路由层：空数组（或空 body）→ 400，错误来自业务层那句中文提示，不是 422 的校验噪音。"""
    assert client.post("/api/collect/backfill", json={"job_ids": []}).status_code == 400
    assert client.post("/api/collect/backfill", json={}).status_code == 400


def test_backfill_route_creates_a_collect_task(client, fake_runner):
    """正常路径：返回 kind=collect 的任务（不新增任务类型），total 与目标清单都正确。"""
    response = client.post("/api/collect/backfill", json={"job_ids": [5, 6, 5]})

    assert response.status_code == 200
    body = response.json()
    assert body["kind"] == "collect"
    assert body["total"] == 2
    assert body["config"]["backfill_job_ids"] == [5, 6]


def test_backfill_route_is_registered():
    """把路由名与它对外的路径绑死：改名会让前端 ``startBackfill`` 静默打到一个 404 上
    （与 datasets/skills 那两条"中间件豁免常量绑死"同一手法）。"""
    from app.application import create_app

    assert "/api/collect/backfill" in set(create_app().openapi()["paths"])


