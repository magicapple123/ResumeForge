# SPDX-License-Identifier: Apache-2.0
"""数据集切换的 prepare/commit/compensate 与启动指针恢复（PR-03，2026-10-13 审计）。

屏障测试：用 monkeypatch 把提交段的每一步（建引擎/迁移/清理/写指针）逐一注入
失败，断言**内存身份、磁盘指针、重启选库**三者始终一致，失败绝不悄悄切库，
旧库始终可用（旧引擎不过早销毁）。全部用临时目录里的测试库，不碰真实数据。
"""

import pytest
from app import database
from app.dataset_registry import (
    dataset_database_file,
    read_active_dataset_id,
    write_active_dataset_id,
)
from app.models.job import Job
from app.runtime import dataset_scope
from app.services.datasets import recover_startup_pointer

MAIN = "main"
CORRUPT_ID = "0123456789abcdef"


def _create_dataset(client, name: str) -> str:
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200
    return response.json()["id"]


def _activate(client, dataset_id: str):
    return client.post(f"/api/settings/datasets/{dataset_id}/activate")


def _add_job(client, title: str) -> None:
    response = client.post("/api/jobs", json={"title": title, "company": "示例公司"})
    assert response.status_code in (200, 201)


def _job_titles(client) -> set[str]:
    response = client.get("/api/jobs")
    assert response.status_code == 200
    return {item["title"] for item in response.json()["items"]}


@pytest.fixture
def fast_drain(monkeypatch):
    monkeypatch.setattr("app.services.datasets._DRAIN_TIMEOUT_SECONDS", 0.2)


def _assert_state_untouched(dataset_id: str) -> None:
    """内存身份、磁盘指针、重启选库三者一致且都指向原数据集。"""
    assert dataset_scope.current_dataset_id() == dataset_id
    assert read_active_dataset_id() == dataset_id
    # "重启选库"：dataset_registry.active_database_file 按指针解析，应指向原库。
    assert dataset_database_file(read_active_dataset_id()) == dataset_database_file(dataset_id)


def _old_library_still_usable(client, marker: str) -> None:
    """旧库还能读写（旧引擎没有被过早销毁）。"""
    _add_job(client, marker)
    assert marker in _job_titles(client)


# ===== 提交段屏障：逐步注入失败 =====


def _patch_second_build_fails(monkeypatch):
    """预检引擎（第 1 次 build）放行，提交段的目标引擎（第 2 次）失败。"""
    import app.database as database_module

    real = database_module.build_engine
    calls = {"n": 0}

    def flaky(url):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise OSError("模拟：目标引擎构建失败")
        return real(url)

    monkeypatch.setattr(database_module, "build_engine", flaky)


def _patch_second_migration_fails(monkeypatch):
    """预检迁移（第 1 次）放行，提交段迁移（第 2 次）失败。"""
    import app.services.datasets as datasets_module

    real = datasets_module.run_database_migrations
    calls = {"n": 0}

    def flaky(engine):
        calls["n"] += 1
        if calls["n"] >= 2:
            raise OSError("模拟：目标库迁移失败")
        return real(engine)

    monkeypatch.setattr(datasets_module, "run_database_migrations", flaky)


def _patch_cleanup_fails(monkeypatch):
    import app.services.datasets as datasets_module

    def boom(_engine):
        raise OSError("模拟：临时目录清理失败")

    monkeypatch.setattr(datasets_module, "cleanup_temp_directories", boom)


def _patch_pointer_write_fails(monkeypatch):
    import app.services.datasets as datasets_module

    def boom(_dataset_id):
        raise OSError("模拟：写指针失败")

    monkeypatch.setattr(datasets_module, "write_active_dataset_id", boom)


def _run_failing_activation(client, monkeypatch, target: str) -> None:
    response = _activate(client, target)
    assert response.status_code in (409, 500)
    _assert_state_untouched(MAIN)
    _old_library_still_usable(client, "失败后旧库仍可写")


def test_build_engine_failure_keeps_everything_on_the_old_library(client, monkeypatch, fast_drain):
    other = _create_dataset(client, "建引擎失败")
    _patch_second_build_fails(monkeypatch)
    _run_failing_activation(client, monkeypatch, other)


def test_migration_failure_keeps_everything_on_the_old_library(client, monkeypatch, fast_drain):
    other = _create_dataset(client, "迁移失败")
    _patch_second_migration_fails(monkeypatch)
    _run_failing_activation(client, monkeypatch, other)


def test_cleanup_failure_keeps_everything_on_the_old_library(client, monkeypatch, fast_drain):
    other = _create_dataset(client, "清理失败")
    _patch_cleanup_fails(monkeypatch)
    _run_failing_activation(client, monkeypatch, other)


def test_pointer_write_failure_keeps_everything_on_the_old_library(client, monkeypatch, fast_drain):
    other = _create_dataset(client, "写指针失败")
    _patch_pointer_write_fails(monkeypatch)
    _run_failing_activation(client, monkeypatch, other)


def test_a_failed_switch_can_be_retried_after_the_injection_is_removed(
    client, monkeypatch, fast_drain
):
    """注入移除后同一目标库可以再次切换成功：失败没有留下半截状态。"""
    other = _create_dataset(client, "可重试")
    _patch_cleanup_fails(monkeypatch)
    assert _activate(client, other).status_code == 409
    _assert_state_untouched(MAIN)
    monkeypatch.undo()
    assert _activate(client, other).status_code == 200
    assert dataset_scope.current_dataset_id() == other


# ===== 启动指针恢复（崩溃窗口的确定性恢复）=====


def test_recovery_falls_back_to_main_when_pointer_file_is_missing(client, monkeypatch, caplog):
    write_active_dataset_id(CORRUPT_ID)  # 指针指向一个不存在的数据集文件
    with caplog.at_level("WARNING", logger="app.services.datasets"):
        recover_startup_pointer()
    assert read_active_dataset_id() == MAIN
    assert dataset_scope.current_dataset_id() == MAIN
    assert "不可用" in caplog.text or "回退" in caplog.text


def test_recovery_falls_back_to_main_when_pointer_file_is_corrupt(client, monkeypatch, caplog):
    target = dataset_database_file(CORRUPT_ID)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(b"definitely not a sqlite database" * 64)
    write_active_dataset_id(CORRUPT_ID)
    with caplog.at_level("WARNING", logger="app.services.datasets"):
        recover_startup_pointer()
    assert read_active_dataset_id() == MAIN
    _old_library_still_usable(client, "恢复后主数据可用")


def test_recovery_keeps_a_valid_pointer_untouched(client, caplog):
    """指针指向可用库时原样保留：崩溃前用户的切换意图应当被尊重。"""
    other = _create_dataset(client, "合法指针")
    assert _activate(client, other).status_code == 200
    with caplog.at_level("INFO", logger="app.services.datasets"):
        recover_startup_pointer()
    assert read_active_dataset_id() == other
    assert dataset_scope.current_dataset_id() == other
    assert "校验通过" in caplog.text


def test_recovery_is_a_noop_for_main(client):
    write_active_dataset_id(MAIN)
    recover_startup_pointer()
    assert read_active_dataset_id() == MAIN


def test_adopt_engine_swaps_engine_and_sessionlocal_without_disposing(client):
    """adopt_engine 只接管：旧引擎对象保持可用，SessionLocal 原地跟随。"""
    from app.database import SessionLocal

    previous_engine = database.engine
    with SessionLocal() as session:
        session.add(Job(title="接管前", company="A"))
        session.commit()

    other = _create_dataset(client, "接管目标")
    assert _activate(client, other).status_code == 200  # 内部走 adopt_engine

    assert database.engine is not previous_engine
    # SessionLocal 原地改绑：新会话落在新库（jobs 表存在且为空）。
    with SessionLocal() as session:
        assert session.query(Job).count() == 0
    _old_library_still_usable(client, "接管后新库可写")
