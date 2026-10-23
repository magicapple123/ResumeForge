# SPDX-License-Identifier: Apache-2.0
"""本批（2026-10-19，R1/R10/R14/R16/R19…）修复的**对抗性**补充用例。

为什么单独一个文件：这里的每一条守的都是既有用例**没有真正守住**的性质——
换一种写法就会漏过去的那种。写之前逐条确认过"工人已有的断言为什么挡不住它"：

1. ``test_job_ties_stay_stable_across_requests_and_pages``
   既有排序用例（``test_api_jobs.py::test_job_list_sorts_by_the_four_keys_and_honours_order``）
   给的三条岗位标题/公司/时间各不相同，所以 **没有任何一条** 会走到 ``ORDER BY <列>, id``
   的 ``id`` 兜底上。而"同一批导入/采集的岗位撞在同一秒"正是 ``job_sorting.job_order_by``
   加 ``id`` 兜底要解决的现场：少了兜底，翻页会重复或漏项，而单页断言依然全绿。
   本条造 6 条同标题同公司的记录，跨两页比对"并集 == 全量、交集 == 空"。

2. ``test_recent_backups_are_kept_by_mtime_not_by_filename``
   既有 ``test_the_three_most_recent_backups_never_become_candidates`` 用的是
   ``b1.db``（最新）… ``b5.db``（最老）：**文件名序与 mtime 序完全一致**，所以把
   "按 mtime 倒序"误写成"按文件名倒序"照样全绿。本条让两者刻意相反
   （``a_newest``/``b_middle``/``c_older``/``z_oldest``），R19 的保护位才真的被钉住。

3. ``test_collection_import_rejects_a_traversal_entry`` /
   ``test_collection_import_rejects_a_traversal_member``
   整包（format 4）导入的两道穿越防线此前**没有用例**：清单条目 ``file`` 只能等于
   ``datasets/<合法 id>.zip``，包内成员也不能出现 ``../``。既有的
   ``test_collection_archive.py`` 只测了"坏子包隔离"，没测"恶意清单"。

4. ``test_render_survives_a_truncated_font``
   既有 ``test_embed_css_falls_back_when_font_is_broken`` 停在服务层
   （``embed_css() == ""``）。用户实际会撞到的是**HTTP 端点**：上传中断留下半截字体时，
   ``/render`` 必须照样 200 且正文完整——"退回系统字体"这件事要在真正的出口上被验一次。
"""

from __future__ import annotations

import json
import os
import time
import zipfile
from pathlib import Path

import pytest
from app import database
from app.services import cleanup, user_fonts
from app.services.data_backup import MANIFEST_MEMBER, BackupError
from app.services.datasets import export_all_datasets, import_dataset
from tests.font_fixtures import build_test_font, write_font

# ===== R14：并列项要稳定（id 兜底），分页不重不漏 =====


def test_job_ties_stay_stable_across_requests_and_pages(client):
    """同标题同公司的 6 条岗位：两次请求同序，第 1/2/3 页并起来恰好是全量。"""
    for _ in range(6):
        created = client.post("/api/jobs", json={"title": "同名岗位", "company": "同名公司"})
        assert created.status_code in (200, 201), created.text

    def ids(**params) -> list[int]:
        response = client.get("/api/jobs", params=params)
        assert response.status_code == 200, response.text
        return [item["id"] for item in response.json()["items"]]

    for sort in ("title_asc", "company_asc", "created_desc", "updated_desc"):
        whole = ids(sort=sort, page=1, page_size=6)
        assert ids(sort=sort, page=1, page_size=6) == whole, f"{sort} 两次请求顺序不一致"

        pages = [ids(sort=sort, page=page, page_size=2) for page in (1, 2, 3)]
        merged = [job_id for page in pages for job_id in page]
        assert len(set(merged)) == len(merged), f"{sort} 分页出现重复项"
        assert sorted(merged) == sorted(whole), f"{sort} 分页出现漏项"


# ===== R19：保留位按 mtime 而不是文件名 =====


def test_recent_backups_are_kept_by_mtime_not_by_filename(tmp_path, monkeypatch):
    """文件名序与 mtime 序刻意相反：被保护的必须是"最新的三份"。"""
    monkeypatch.setattr(cleanup, "DATA_DIR", str(tmp_path))
    assert cleanup._data_root() == tmp_path
    for name, age_days in (
        ("a_newest.zip", 40),
        ("b_middle.zip", 41),
        ("c_older.zip", 42),
        ("z_oldest.zip", 43),
    ):
        path = tmp_path / "backups" / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"x" * 8)
        stamp = time.time() - age_days * 86400
        os.utime(path, (stamp, stamp))

    plan = cleanup.plan_cleanup(older_than_days=30)

    # 只有最老那份（文件名最大、mtime 最旧）该被清；按文件名排序会把 a_newest 清掉。
    assert [item["path"] for item in plan["candidates"]] == ["backups/z_oldest.zip"]
    assert plan["totals"] == {"files": 1, "bytes": 8}
    assert {item["path"] for item in plan["skipped"]} == {
        "backups/a_newest.zip",
        "backups/b_middle.zip",
        "backups/c_older.zip",
    }


# ===== R16：整包导入的两道穿越防线 =====


def _two_datasets(client) -> str:
    """主数据 + 另一份数据集，各放一条岗位，返回后者的注册表 id。"""
    assert client.post("/api/jobs", json={"title": "主数据岗位"}).status_code in (200, 201)
    created = client.post("/api/settings/datasets", json={"name": "数据集B"}).json()
    assert client.post(f"/api/settings/datasets/{created['id']}/activate").status_code == 200
    assert client.post("/api/jobs", json={"title": "数据集B岗位"}).status_code in (200, 201)
    assert client.post("/api/settings/datasets/main/activate").status_code == 200
    return created["id"]


def _repack(
    source: Path, target: Path, *, edit_manifest=None, extra: dict[str, bytes] | None = None
):
    """重写外层包：可按需篡改清单、追加成员（其余成员原样搬运）。"""
    with zipfile.ZipFile(source) as src:
        manifest = json.loads(src.read(MANIFEST_MEMBER))
        if edit_manifest is not None:
            edit_manifest(manifest)
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as dst:
            for name in src.namelist():
                if name != MANIFEST_MEMBER:
                    dst.writestr(name, src.read(name))
            for name, payload in (extra or {}).items():
                dst.writestr(name, payload)
            dst.writestr(MANIFEST_MEMBER, json.dumps(manifest, ensure_ascii=False))
    return target


def test_collection_import_rejects_a_traversal_entry(client, tmp_path):
    """清单里的子包路径被改成 ``../evil.zip`` 时整体拒收，而不是解到包外。"""
    extra_id = _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")

    def _evil(manifest: dict) -> None:
        for entry in manifest["datasets"]:
            if entry["id"] == extra_id:
                entry["file"] = "../evil.zip"

    evil = _repack(archive, tmp_path / "evil-entry.zip", edit_manifest=_evil)

    with pytest.raises(BackupError) as excinfo:
        import_dataset(evil, "整包", database.engine, tmp_path / "staging-import")
    assert "不合法" in str(excinfo.value)


def test_collection_import_rejects_a_traversal_member(client, tmp_path):
    """包内真塞一个 ``../evil.txt`` 成员：``validate_archive`` 必须整包拒收。"""
    _two_datasets(client)
    archive = export_all_datasets(database.engine, tmp_path / "staging")
    evil = _repack(archive, tmp_path / "evil-member.zip", extra={"../evil.txt": b"payload"})

    with pytest.raises(BackupError) as excinfo:
        import_dataset(evil, "整包", database.engine, tmp_path / "staging-import")
    assert "路径" in str(excinfo.value)


# ===== R10：字体坏掉时端点照样出稿 =====


@pytest.fixture
def fonts_root(tmp_path, monkeypatch):
    """字体必须落在临时目录：写成真的 ``backend/data/fonts`` 会污染开发机的数据目录。"""
    monkeypatch.setattr(user_fonts, "DATA_DIR", str(tmp_path))
    yield tmp_path
    user_fonts.set_active(None)


def test_render_survives_a_truncated_font(client, fonts_root):
    """上传中断留下半截字体（能选中、解析必失败）时，``/render`` 仍 200 且正文完整。"""
    whole = build_test_font()
    write_font("截断.ttf", whole[:200])
    user_fonts.set_active("截断.ttf")

    response = client.post(
        "/api/resumes/render",
        json={
            "content": {
                "name": "张三",
                "summary": "三年后端开发经验，负责交易系统的设计与落地。",
                "experience": [
                    {
                        "company": "示例科技",
                        "role": "后端工程师",
                        "description": ["负责订单核心链路优化。"],
                    }
                ],
            },
            "template": "classic",
        },
    )

    assert response.status_code == 200, response.text
    assert "张三" in response.text and "三年后端开发经验" in response.text
    # 拿不出子集就退回模板自带的字体栈：不能插一段坏 base64 让浏览器解析失败。
    assert 'id="rf-font"' not in response.text


# 说明：本文件之外的两条"口径"提醒（不写成断言，避免把待裁决的语义钉死）——
# 1. R19 的保护位是**占位**的：最新那份若还没过龄，它照样占掉一个保护位，于是更老的
#    备份只会被清掉 `总数 - 3` 份。这与 fixlist #1「先按 mtime 倒序取前 3 份放入
#    skipped，其余才进候选」一致；若产品期望改成"只保 1 份"，需先改那份文档。
# 2. ``ExportRequest.margin_mm`` 仍被后端接受（旧客户端不会 4xx），但**已不是独立旋钮**：
#    页边距权威是 ``format_config.page_padding``，``margin_mm`` 只在没给 ``page_padding``
#    时按 8–26 clamp 后作回落值（``pdf_exporter.layout._resolve_margin_mm``）。前端自 R1
#    起不再发它，两者同时出现时也不再能制造"预览 8mm、PDF 30mm"——见
#    ``test_export_page_parity.py::test_margin_mm_never_overrides_page_padding``。
