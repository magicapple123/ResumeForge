# SPDX-License-Identifier: Apache-2.0
"""大附件体积下的行为（RF-25）：列表轻、详情全、导出完整可恢复、快照可用、内存有界。

用 8 份资料 × 4 张 ~1.1 MB 的 PNG data URL（每份图片总量压在 MAX_MATERIAL_IMAGE_CHARS
之内）造出 ~35 MB 级的库内容——足够暴露"列表把 data_url 全带出来"这类问题，
又不至于让测试跑不动。文件签名是真 PNG 魔数 + 填充字节，过得了
``validate_photo_data_url`` 的签名校验；测完由 pytest 的 tmp_path 统一清理。
"""
import base64
import json
import sqlite3
import tracemalloc

from app.database import engine
from app.database_migrations import backup_sqlite_database
from app.services.data_backup import create_backup_archive
from app.services.data_backup.auto_backup import snapshot_is_valid
from app.services.data_backup.import_archive import extract_database

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


def _image_data_url(seed: int, payload_kb: int = 1050) -> str:
    payload = PNG_MAGIC + bytes([seed % 251]) * (payload_kb * 1024)
    return "data:image/png;base64," + base64.b64encode(payload).decode()


def test_large_attachments_list_is_light_and_archive_restores(client, tmp_path):
    tracemalloc.start()
    try:
        # 8 份资料 × 4 张 ~1.4M 字符的 base64 ≈ 每份 5.6M 字符，合计 ~35 MB 级内容。
        for index in range(8):
            files = [
                {
                    "name": f"cert-{index}-{part}.png",
                    "mime_type": "image/png",
                    "size_bytes": 1050 * 1024,
                    "text": "",
                    "data_url": _image_data_url(index * 10 + part),
                }
                for part in range(4)
            ]
            resp = client.post("/api/materials", json={"title": f"大附件资料 {index}", "files": files})
            assert resp.status_code == 201

        # 列表：不含 data_url，响应体必须显著小于库里的原始形态。
        listed = client.get("/api/materials")
        assert listed.status_code == 200
        assert len(listed.content) < 1_000_000
        summary = listed.json()[0]
        assert summary["files"][0]["has_image"] is True
        assert "data_url" not in json.dumps(summary)
        assert summary["files"][0]["text_length"] == 0

        # 详情：完整数据仍然可达。
        detail = client.get(f"/api/materials/{summary['id']}")
        assert detail.status_code == 200
        assert detail.json()["files"][0]["data_url"].startswith("data:image/png;base64,")

        # 导出 archive 完整可恢复：包内数据库带全部附件内容。
        archive = create_backup_archive(engine, tmp_path / "staging")
        candidate = extract_database(archive, tmp_path / "restored")
        with sqlite3.connect(candidate) as connection:
            rows = connection.execute("SELECT files FROM material ORDER BY id").fetchall()
        assert len(rows) == 8
        restored_chars = sum(len(row[0]) for row in rows)
        assert restored_chars > 20_000_000
        assert "data:image/png;base64," in rows[0][0]

        # 自动备份同款快照 + 验证：大库上 snapshot_is_valid 必须仍然给出可信结论。
        snapshot = backup_sqlite_database(engine, output_dir=tmp_path / "auto")
        assert snapshot is not None
        assert snapshot_is_valid(snapshot, engine)
    finally:
        _current, peak = tracemalloc.get_traced_memory()
        tracemalloc.stop()

    # 内存有界：全程峰值不超过 512 MB（正常跑完本身就是"没炸"的主判据）。
    assert peak < 512 * 1024 * 1024
