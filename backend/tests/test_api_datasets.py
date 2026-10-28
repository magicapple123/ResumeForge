# SPDX-License-Identifier: Apache-2.0
"""数据集接口测试：本机限制、类型校验、导入/切换/重命名/删除与导出。

2026-10-22（行数预算审计 A3）：导入导出/打包往返域已拆到
``test_api_datasets_transfer.py``，共享辅助在 ``dataset_api_helpers.py``；本文件只守
数据集生命周期（列表 / 创建 / 激活 / 改名 / 删除 / 路径逃逸 / 缺失）。
"""

from dataset_api_helpers import (
    MAIN,
    _add_job,
    _archive_bytes,
    _import,
    _job_titles,
    _list_datasets,
)


def test_list_datasets_starts_with_only_the_main_dataset(client):
    items = _list_datasets(client)

    assert [item["id"] for item in items] == [MAIN]
    assert items[0]["is_active"] is True
    # 来源同时下发稳定代码：界面按语言显示，`source` 只作为兜底原文。
    assert items[0]["source"] == "本机"
    assert items[0]["source_code"] == "machine"


def test_create_dataset_makes_a_named_empty_dataset(client):
    response = client.post("/api/settings/datasets", json={"name": "校招空库"})

    assert response.status_code == 200
    created = response.json()
    assert created["name"] == "校招空库"
    assert created["source"] == "新建"
    assert created["source_code"] == "created"
    assert created["is_active"] is False
    assert created["id"] != MAIN
    assert {item["id"] for item in _list_datasets(client)} == {MAIN, created["id"]}


def test_created_dataset_can_be_activated_and_starts_empty(client):
    """新建的空数据集激活后应为**空视图**（主数据里的内容不该漏进来）。"""
    created = client.post("/api/settings/datasets", json={"name": "空库"}).json()
    _add_job(client, "主数据里的岗位")

    assert client.post(f"/api/settings/datasets/{created['id']}/activate").status_code == 200
    assert _job_titles(client) == set()


def test_create_dataset_requires_a_loopback_client(client, monkeypatch):
    monkeypatch.setattr("app.api.settings._is_loopback_request", lambda _request: False)

    response = client.post("/api/settings/datasets", json={"name": "空库"})

    assert response.status_code == 403


def test_create_dataset_rejects_a_blank_name(client):
    # 空串：schema 层拦下。
    assert client.post("/api/settings/datasets", json={"name": ""}).status_code == 422
    # 全是空格：schema 层放行（长度 ≥1），由服务层拒绝并给出可操作的中文提示。
    response = client.post("/api/settings/datasets", json={"name": "   "})
    assert response.status_code == 400
    assert "名称不能为空" in response.json()["detail"]


def test_import_creates_a_new_dataset_without_touching_current_data(client, tmp_path):
    """导入是可撤销的：它只新增一份数据集，当前正在用的数据一点不变。"""
    _add_job(client, "导入前的岗位")
    payload = _archive_bytes(tmp_path)
    _add_job(client, "导出之后新增的岗位")

    response = _import(client, payload, name="备份 A")

    assert response.status_code == 200
    created = response.json()
    assert created["name"] == "备份 A"
    assert created["is_active"] is False
    # 当前数据没有被这次导入改动。
    assert _job_titles(client) == {"导入前的岗位", "导出之后新增的岗位"}
    assert {item["id"] for item in _list_datasets(client)} == {MAIN, created["id"]}


def test_activate_switches_the_whole_application_to_that_dataset(client, tmp_path):
    _add_job(client, "导出时的岗位")
    payload = _archive_bytes(tmp_path)
    _add_job(client, "导出之后新增的岗位")
    created = _import(client, payload).json()

    response = client.post(f"/api/settings/datasets/{created['id']}/activate")

    assert response.status_code == 200
    assert response.json()["is_active"] is True
    assert _job_titles(client) == {"导出时的岗位"}


def test_writes_after_switching_do_not_leak_into_the_other_dataset(client, tmp_path):
    """切到数据集 B 之后写入的数据，切回主数据时不能出现在主数据里。

    这是最容易出的静默错误：引擎换了但某个模块仍持有旧会话工厂，数据就写进了
    上一份数据集。
    """
    _add_job(client, "主数据里的岗位")
    created = _import(client, _archive_bytes(tmp_path)).json()

    client.post(f"/api/settings/datasets/{created['id']}/activate")
    _add_job(client, "只在数据集里")
    assert _job_titles(client) == {"主数据里的岗位", "只在数据集里"}

    client.post(f"/api/settings/datasets/{MAIN}/activate")

    assert _job_titles(client) == {"主数据里的岗位"}


def test_rename_dataset(client, tmp_path):
    created = _import(client, _archive_bytes(tmp_path)).json()

    response = client.patch(f"/api/settings/datasets/{created['id']}?name=校招专用")

    assert response.status_code == 200
    assert response.json()["name"] == "校招专用"
    assert "校招专用" in {item["name"] for item in _list_datasets(client)}


def test_delete_moves_the_dataset_out_of_the_list(client, tmp_path):
    """删除只移入回收目录，不永久删除（项目约定）。"""
    created = _import(client, _archive_bytes(tmp_path)).json()

    response = client.delete(f"/api/settings/datasets/{created['id']}")

    assert response.status_code == 204
    assert {item["id"] for item in _list_datasets(client)} == {MAIN}
    from app.dataset_registry import trash_directory

    assert list(trash_directory().glob(f"{created['id']}-*.db"))


def test_delete_refuses_the_active_dataset(client, tmp_path):
    created = _import(client, _archive_bytes(tmp_path)).json()
    client.post(f"/api/settings/datasets/{created['id']}/activate")

    response = client.delete(f"/api/settings/datasets/{created['id']}")

    assert response.status_code == 400
    assert "正在使用" in response.json()["detail"]


def test_activate_rejects_an_id_that_tries_to_escape_the_directory(client):
    response = client.post("/api/settings/datasets/....../activate")

    assert response.status_code == 400
    assert "无效" in response.json()["detail"]


def test_activate_reports_a_missing_dataset(client):
    response = client.post("/api/settings/datasets/0123456789abcdef/activate")

    assert response.status_code == 404
