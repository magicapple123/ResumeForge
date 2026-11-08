# SPDX-License-Identifier: Apache-2.0
"""RAG v3：本地权重/运行时目录必须"不进备份、也不出现在 uncovered 噪音里"。"""

from __future__ import annotations

from app.services.data_backup.coverage import is_covered, scan_uncovered


def test_rag_runtime_dirs_are_registered_runtime_only(tmp_path):
    for name in ("rag-model", "rag-runtime"):
        assert is_covered(name) is True
        directory = tmp_path / name
        directory.mkdir()
        (directory / "blob.bin").write_bytes(b"x" * 1024)

    # 单个未登记目录仍然会被兜底扫描报出来（证明上面的 True 不是扫描失效）。
    unknown = tmp_path / "some-new-cache"
    unknown.mkdir()
    (unknown / "data.bin").write_bytes(b"y")

    summary = scan_uncovered(tmp_path)
    assert [item["name"] for item in summary["items"]] == ["some-new-cache"]
    assert summary["count"] == 1


def test_rag_assets_dirs_do_not_add_backup_bytes(tmp_path):
    root = tmp_path
    before = scan_uncovered(root)
    (root / "rag-model" / "granite" / "model.onnx").parent.mkdir(parents=True)
    (root / "rag-model" / "granite" / "model.onnx").write_bytes(b"m" * 4096)
    (root / "rag-runtime" / "ort-1.31.1" / "site-packages").mkdir(parents=True)
    (root / "rag-runtime" / "ort-1.31.1" / "site-packages" / "onnxruntime.py").write_text("x")
    after = scan_uncovered(root)
    assert before == after  # 体积/条目都不因本地模型变大：它们永远不进备份
