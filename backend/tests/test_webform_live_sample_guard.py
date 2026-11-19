# SPDX-License-Identifier: Apache-2.0
"""示例数据集不得参与真实填表（台账第 11 条 A 部分）。

两层断言：
1. 判据本身是纯函数——`sample` 拦，空元信息/导入放行（历史数据集没有 sidecar 时不能被误伤）；
2. 两个入口真的把结论翻成 409：`/live/start` 与 `/preview`。断言必须落在 409 上，
   而不是"浏览器没启动"或"快照不存在"那两种本来就会出现的拒绝。
"""

import pytest
from app.dataset_registry import write_metadata
from app.services.webform import dataset_guard


@pytest.mark.parametrize(
    ("metadata", "expected"),
    [
        ({"source": "sample"}, True),
        ({"source": " Sample "}, True),
        ({}, False),
        (None, False),
        ({"source": ""}, False),
        ({"source": "导入"}, False),
        ({"source": "新建"}, False),
        ({"name": "没有来源字段"}, False),
    ],
)
def test_dataset_blocks_fill_only_for_sample(metadata, expected):
    assert dataset_guard.dataset_blocks_fill(metadata) is expected


def _activate_dataset_with_source(client, source: str) -> str:
    """建一份新数据集、切过去、按需写 sidecar（模拟「体验示例」的落盘形态）。"""
    created = client.post("/api/settings/datasets", json={"name": "守卫用数据集"}).json()
    assert client.post(f"/api/settings/datasets/{created['id']}/activate").status_code == 200
    if source:
        write_metadata(created["id"], {"name": "守卫用数据集", "source": source})
    return created["id"]


def test_live_start_is_rejected_on_sample_dataset(client):
    _activate_dataset_with_source(client, "sample")

    response = client.post("/api/webform/live/start", json={"ai": False})

    assert response.status_code == 409
    assert response.json()["detail"] == dataset_guard.SAMPLE_FILL_BLOCKED_DETAIL
    # 这条 409 必须是示例守卫给的，不能与「浏览器还没启动」撞车。
    assert "体验示例" in response.json()["detail"]


def test_preview_is_rejected_on_sample_dataset(client):
    _activate_dataset_with_source(client, "sample")

    # 快照 id 是假的：守卫若排在取快照之后，这里会是 404 而不是 409。
    response = client.post("/api/webform/preview", json={"snapshot_id": "nope"})

    assert response.status_code == 409
    assert response.json()["detail"] == dataset_guard.SAMPLE_FILL_BLOCKED_DETAIL


def test_preview_still_passes_through_on_a_non_sample_dataset(client):
    """导入/新建的数据集不受守卫影响：假快照仍然走原来的 404。"""
    _activate_dataset_with_source(client, "导入")

    response = client.post("/api/webform/preview", json={"snapshot_id": "nope"})

    assert response.status_code == 404
