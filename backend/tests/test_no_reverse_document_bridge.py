# SPDX-License-Identifier: Apache-2.0
"""The v2 runtime never reconstructs a v1 analysis document."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_backend_reverse_document_bridge_is_removed():
    forbidden = (
        "document_to_legacy",
        "legacy_content_dict",
        "legacy_content_for_record",
        "legacy_or_422",
    )
    hits = []
    for source in (ROOT / "backend/app").rglob("*.py"):
        if "__pycache__" in source.parts:
            continue
        for number, line in enumerate(source.read_text(encoding="utf-8-sig").splitlines(), 1):
            if any(name in line for name in forbidden):
                hits.append(f"{source.relative_to(ROOT)}:{number}")
    assert not hits, hits
    assert not (ROOT / "backend/app/services/resume/document_legacy_view.py").exists()


def test_frontend_reverse_document_bridge_is_removed():
    hits = []
    for source in (ROOT / "frontend/src").rglob("*"):
        if not source.is_file() or source.suffix not in {".ts", ".tsx"}:
            continue
        if "documentToLegacy" in source.read_text(
            encoding="utf-8-sig"
        ) or "documentLegacy" in source.read_text(encoding="utf-8-sig"):
            hits.append(str(source.relative_to(ROOT)))
    assert not hits, hits
    assert not (ROOT / "frontend/src/features/resume/documentLegacy.ts").exists()
