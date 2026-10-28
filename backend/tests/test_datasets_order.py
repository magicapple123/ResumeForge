# SPDX-License-Identifier: Apache-2.0
"""设置里的数据集列表顺序：激活的排最前，其余按创建时间**倒序**（新导入的在上）。

用户的实际感受：导入一份数据集后要在设置里找到它、切过去——按名字排的时候它可能落在
列表中间（名字里没带日期时更是随机），看起来就是"乱"。所以排序口径固定成
「激活优先 → 创建时间新→旧 → 名称」，并且时间缺失（主数据集没有元信息）按最旧处理。

这里直接调 ``list_datasets()``（列表端点只是把它包成 JSON）：要验的是排序本身，
不是 HTTP 形状；端点形状由 ``test_api_datasets.py`` 守着。
"""

from __future__ import annotations

from datetime import datetime, timedelta

from app.dataset_registry import read_metadata, write_active_dataset_id, write_metadata
from app.services.datasets_admin import list_datasets
from dataset_api_helpers import MAIN


def _create(client, name: str) -> dict:
    """走端点新建一份空数据集：这样 id / 目录 / 元信息都是真实形状。"""
    response = client.post("/api/settings/datasets", json={"name": name})
    assert response.status_code == 200, response.text
    return response.json()


def _stamp(dataset_id: str, *, days_ago: float) -> None:
    """把元信息里的 created_at 改成指定的时间点（导入时间无法在测试里等待）。"""
    metadata = read_metadata(dataset_id) or {}
    metadata["created_at"] = (datetime.now().astimezone() - timedelta(days=days_ago)).isoformat(
        timespec="seconds"
    )
    write_metadata(dataset_id, metadata)


def test_list_is_active_first_then_newest_first(client):
    """激活的排最前，其余按创建时间倒序；主数据集没有时间 → 排最后。"""
    oldest = _create(client, "三天前导入")
    middle = _create(client, "昨天导入")
    newest = _create(client, "今天导入")
    _stamp(oldest["id"], days_ago=3)
    _stamp(middle["id"], days_ago=1)
    _stamp(newest["id"], days_ago=0)
    # 激活的是"昨天"那份：它必须排第一，哪怕它不是最新的。
    write_active_dataset_id(middle["id"])

    ids = [item["id"] for item in list_datasets()]

    assert ids == [middle["id"], newest["id"], oldest["id"], MAIN]


def test_missing_created_at_sorts_last_and_never_crashes(client):
    """没有 created_at 的条目按"最旧"处理：排在所有有时间的数据集之后，且不抛 TypeError。"""
    stamped = _create(client, "有时间的数据集")
    _stamp(stamped["id"], days_ago=2)
    undated = _create(client, "没有时间的数据集")
    # 元信息里**故意不写** created_at（历史数据集就可能长这样）。
    write_metadata(undated["id"], {"name": "没有时间的数据集", "source": "导入"})

    ids = [item["id"] for item in list_datasets()]

    # 主数据集是当前激活的，永远第一；有时间的排在"时间未知"的前面。
    assert ids == [MAIN, stamped["id"], undated["id"]]


def test_same_timestamp_falls_back_to_name(client):
    """同一时刻的并列用名称兜底：顺序稳定，不会两次请求给出不同结果。"""
    second = _create(client, "B 数据集")
    first = _create(client, "A 数据集")
    for item in (first, second):
        _stamp(item["id"], days_ago=1)

    ids = [item["id"] for item in list_datasets()]

    # 主数据集是当前激活的（永远第一）；A 在 B 前是名称升序兜底，与创建顺序无关。
    assert ids == [MAIN, first["id"], second["id"]]


def test_unparsable_created_at_is_treated_as_unknown(client):
    """历史元信息里若写的是别的时间格式，按"时间未知"处理而不是让整张列表 500。"""
    broken = _create(client, "坏时间")
    write_metadata(broken["id"], {"name": "坏时间", "source": "导入", "created_at": "去年某天"})
    good = _create(client, "好时间")
    _stamp(good["id"], days_ago=1)

    ids = [item["id"] for item in list_datasets()]

    assert ids == [MAIN, good["id"], broken["id"]]
