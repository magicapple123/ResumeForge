# SPDX-License-Identifier: Apache-2.0
"""备份包下载名（R15）：用户可自定义，中文保留、非法字符被替换、缺省带数据集名与时间戳。

此前导出名固定为 ``resumeforge-backup-<时间戳>-<随机>.zip``：用户在下载目录里攒了十几份
备份后，只能靠时间戳猜哪一份是"校招线"。这里钉住三件事：

1. 规则只在 ``services/data_backup/naming.py`` 一处实现（单数据集 / 全量 / 未来其它入口共用）；
2. 中文原样保留、Windows/macOS 不允许的字符替换掉、控制字符（含换行）不会进入响应头；
3. 不填时默认 ``<数据集名>-<YYYYMMDD-HHMMSS>.zip``，全量导出是 ``全部数据集-<时间戳>.zip``。
"""

from __future__ import annotations

import re
import urllib.parse

import pytest
from app.services.data_backup.naming import (
    MAX_STEM_LENGTH,
    default_backup_stem,
    safe_backup_filename,
)

MAIN = "main"


def _download_name(response) -> str:
    """从 Content-Disposition 里取出真实下载名（RFC 5987 的 UTF-8 形式）。"""
    disposition = response.headers["Content-Disposition"]
    marker = "filename*=UTF-8''"
    assert marker in disposition
    return urllib.parse.unquote(disposition.split(marker, 1)[1])


# ===== 纯函数 =====


def test_chinese_name_is_kept_as_is():
    assert safe_backup_filename("校招线备份", default_stem="x") == "校招线备份.zip"


def test_illegal_characters_become_dashes():
    assert (
        safe_backup_filename('a/b\\c:d*e?f"g<h>i|j', default_stem="x") == "a-b-c-d-e-f-g-h-i-j.zip"
    )


def test_control_characters_never_reach_the_header():
    # 换行会把 Content-Disposition 拆成两条响应头，是最危险的一种输入。
    assert (
        safe_backup_filename("备份\nSet-Cookie: x=1", default_stem="x")
        == "备份-Set-Cookie- x=1.zip"
    )


def test_suffix_is_added_once():
    assert safe_backup_filename("备份.zip", default_stem="x") == "备份.zip"
    assert safe_backup_filename("备份.txt", default_stem="x") == "备份.txt.zip"


def test_long_name_is_truncated_to_the_budget():
    name = safe_backup_filename("备" * 200, default_stem="x")
    assert len(name) == MAX_STEM_LENGTH + len(".zip")


@pytest.mark.parametrize("raw", ["", "   ", "///", None])
def test_empty_or_all_illegal_falls_back_to_default(raw):
    assert safe_backup_filename(raw, default_stem="主数据-20261019-101500") == (
        "主数据-20261019-101500.zip"
    )


def test_default_stem_has_dataset_name_and_timestamp():
    stem = default_backup_stem("校招线")
    assert re.fullmatch(r"校招线-\d{8}-\d{6}", stem)


# ===== API =====


def test_export_uses_the_requested_name(client):
    response = client.get(f"/api/settings/datasets/{MAIN}/export", params={"filename": "我的备份"})

    assert response.status_code == 200
    assert _download_name(response) == "我的备份.zip"


def test_export_sanitises_illegal_characters(client):
    response = client.get(f"/api/settings/datasets/{MAIN}/export", params={"filename": "a/b:c*?"})

    assert response.status_code == 200
    assert _download_name(response) == "a-b-c.zip"


def test_export_without_name_uses_dataset_name_and_timestamp(client):
    response = client.get(f"/api/settings/datasets/{MAIN}/export")

    assert response.status_code == 200
    name = _download_name(response)
    assert name.endswith(".zip")
    assert re.search(r"-\d{8}-\d{6}\.zip$", name)
    # 默认名里带数据集名（主数据可能被用户改名，所以只断言不是旧的固定前缀）。
    assert not name.startswith("resumeforge-backup-")


def test_export_all_has_its_own_default_name(client):
    response = client.get("/api/settings/datasets/export-all")

    assert response.status_code == 200
    name = _download_name(response)
    assert name.startswith("全部数据集-")
    assert name.endswith(".zip")


def test_export_all_also_accepts_a_custom_name(client):
    response = client.get("/api/settings/datasets/export-all", params={"filename": "迁移包-2026"})

    assert response.status_code == 200
    assert _download_name(response) == "迁移包-2026.zip"


def test_too_long_name_is_rejected_at_the_edge(client):
    """超过 128 字的输入直接 422：不静默截断成另一个名字，也不让它进响应头。"""
    response = client.get(f"/api/settings/datasets/{MAIN}/export", params={"filename": "备" * 200})

    assert response.status_code == 422
