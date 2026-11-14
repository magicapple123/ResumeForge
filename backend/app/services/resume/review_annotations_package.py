# SPDX-License-Identifier: Apache-2.0
"""评审包导出与批注错误类型（从 app.services.resume.review_annotations 纯搬迁拆出）。

批注错误类型（可直接展示给用户、带 status_code）、分享包快照指纹、annotations.json
模板与评审包 zip 生成。review_annotations 对这些名字做 re-export，路由与测试的旧 import
路径不变；批注的解析/导入/状态机仍在 review_annotations。
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.review_annotation import REVIEW_FORMAT_VERSION, REVIEW_KIND
from ...models.share_package import SHARE_PERMISSION_COMMENT, SharePackage
from ..share_package import ensure_package_files, package_directory
from .document_provenance import canonical_fingerprint
from .resume_delivery import canonical_content_sha256

REVIEW_PACKAGE_HINT = (
    "这是一份可离线查看的评审包。\n\n"
    "如果要回传批注：打开 annotations.json，按模板填写 annotations 数组后，\n"
    "把整个文件交回给分享人。格式版本、分享码与包内快照指纹请勿修改。\n"
)


class ReviewAnnotationError(Exception):
    """可直接展示给用户的批注错误；status_code 供路由使用。"""

    def __init__(self, message: str, status_code: int = 422) -> None:
        super().__init__(message)
        self.status_code = status_code


class AnnotationNotFoundError(ReviewAnnotationError):
    def __init__(self, message: str = "批注不存在") -> None:
        super().__init__(message, status_code=404)


class AnnotationTransitionError(ReviewAnnotationError):
    def __init__(self, message: str) -> None:
        super().__init__(message, status_code=409)


def package_snapshot_sha256(package: SharePackage) -> str:
    """分享包快照的规范哈希：与批注包里的 package_snapshot_sha256 同一口径。"""
    return canonical_fingerprint(package.snapshot or {})


def build_annotations_template(db: Session, package: SharePackage) -> dict[str, Any]:
    """评审包里的 annotations.json 模板（只读模板，可无批注）。"""
    record = db.get(ResumeRecord, package.resume_id) if package.resume_id else None
    return {
        "format_version": REVIEW_FORMAT_VERSION,
        "kind": REVIEW_KIND,
        "share_token": package.share_token,
        "package_snapshot_sha256": package_snapshot_sha256(package),
        "resume_snapshot_sha256": (
            canonical_content_sha256(record.content or {}) if record is not None else ""
        ),
        "document_version_id": None,
        "reviewer": "",
        "created_at": datetime.now(UTC).isoformat(timespec="seconds"),
        "annotations": [],
    }


def build_review_package_zip(db: Session, package: SharePackage) -> tuple[bytes, str]:
    """生成评审包 zip（既有产物 + annotations.json 模板 + 说明.txt）。"""
    if package.permission != SHARE_PERMISSION_COMMENT:
        raise ReviewAnnotationError("这份分享包不支持批注，无法生成评审包", status_code=400)
    ensure_package_files(db, package)
    directory = package_directory(db.get_bind(), package.id)
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for entry in package.files or []:
            name = str(entry.get("name") or "")
            raw_path = Path(str(entry.get("path") or ""))
            if not name or Path(name).name != name:
                continue
            try:
                resolved = raw_path.resolve()
                resolved.relative_to(directory.resolve())
            except (OSError, ValueError):
                continue
            if not resolved.is_file():
                continue
            archive.write(resolved, arcname=name)
        archive.writestr(
            "annotations.json",
            json.dumps(
                build_annotations_template(db, package), ensure_ascii=False, indent=2
            ).encode("utf-8"),
        )
        archive.writestr("说明.txt", REVIEW_PACKAGE_HINT.encode("utf-8"))
    filename = f"resume-review-{package.id}.zip"
    return buffer.getvalue(), filename
