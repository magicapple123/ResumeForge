# SPDX-License-Identifier: Apache-2.0
"""W18 离线对象批注：批注包 v1 解析、导入校验、状态机与评审包生成。

契约（wave3 §4）要点：

- 锚点用 W01 的 object_id/point_id；path 只作兼容兜底；都找不到 → stale，
  **绝不下标回退**（plan §D17）。
- 导入九步顺序即契约：permission → token → 格式/上限 → 快照不一致（不拒绝，整批 stale）
  → document_version 归属 → 逐条锚点（stale 不整批失败）→ 去重（不覆盖已 resolved/
  dismissed 状态）→ 单事务写库。
- 隐私：批注正文按不可信输入处理（长度上限、纯文本存储、不写日志正文、不调用模型）；
  批注永不进入简历导出产物。
"""

from __future__ import annotations

import io
import json
import re
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.review_annotation import (
    ANNOTATION_STATUS_DISMISSED,
    ANNOTATION_STATUS_OPEN,
    ANNOTATION_STATUS_RESOLVED,
    ANNOTATION_STATUS_STALE,
    MAX_ANNOTATION_EXTERNAL_ID,
    MAX_ANNOTATION_FILE_BYTES,
    MAX_ANNOTATION_QUOTED,
    MAX_ANNOTATION_REVIEWER,
    MAX_ANNOTATION_TEXT,
    MAX_ANNOTATIONS_PER_FILE,
    REVIEW_FORMAT_VERSION,
    REVIEW_KIND,
    ResumeReviewAnnotation,
)
from ...models.share_package import SHARE_PERMISSION_COMMENT, SharePackage
from ...models.versions import ResumeVersion
from ..share_package import ensure_package_files, package_directory, verify_share_token
from . import document_io
from .document_identity import is_object_id, resolve_object_path, resolve_point_path
from .document_paths import identity_path, read_document_value, resolve_document_path
from .document_provenance import canonical_fingerprint
from .resume_delivery import canonical_content_sha256

_TOKEN_RE = re.compile(r"[0-9a-f]{32}")
_ALLOWED_TRANSITIONS = {
    ANNOTATION_STATUS_OPEN: {ANNOTATION_STATUS_RESOLVED, ANNOTATION_STATUS_DISMISSED},
    ANNOTATION_STATUS_RESOLVED: {ANNOTATION_STATUS_OPEN, ANNOTATION_STATUS_DISMISSED},
    ANNOTATION_STATUS_STALE: {ANNOTATION_STATUS_DISMISSED},
    ANNOTATION_STATUS_DISMISSED: {ANNOTATION_STATUS_DISMISSED},
}
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


def annotation_brief(row: ResumeReviewAnnotation) -> dict[str, Any]:
    return {
        "id": row.id,
        "share_package_id": row.share_package_id,
        "resume_id": row.resume_id,
        "document_version_id": row.document_version_id,
        "snapshot_sha256": row.snapshot_sha256,
        "external_id": row.external_id,
        "object_id": row.object_id,
        "point_id": row.point_id,
        "path": row.path,
        "field": row.field,
        "quoted_text": row.quoted_text,
        "text": row.text,
        "reviewer": row.reviewer,
        "status": row.status,
        "resolved_at": row.resolved_at,
        "created_at": row.created_at,
    }


def _require_text(value: Any, name: str, limit: int) -> str:
    if not isinstance(value, str):
        raise ReviewAnnotationError(f"批注字段 {name} 必须是文本")
    if len(value) > limit:
        raise ReviewAnnotationError(f"批注字段 {name} 超过长度上限 {limit}")
    return value


def parse_annotation_file(raw: str, package: SharePackage) -> dict[str, Any]:
    """步骤 2–4：token、格式、上限。返回解析后的声明与逐条批注（未落库）。"""
    if len(raw.encode("utf-8")) > MAX_ANNOTATION_FILE_BYTES:
        raise ReviewAnnotationError("批注文件超过大小上限（512 KiB）")
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ReviewAnnotationError(
            "批注只能从 JSON 文件导入；Markdown 纯文本无法承载对象锚点，请使用评审包内的 annotations.json"
        ) from exc
    if not isinstance(payload, dict):
        raise ReviewAnnotationError("批注文件结构不正确")
    if payload.get("format_version") != REVIEW_FORMAT_VERSION:
        raise ReviewAnnotationError("批注格式版本不受支持，请让分享人重新生成评审包")
    if payload.get("kind") != REVIEW_KIND:
        raise ReviewAnnotationError("这不是 ResumeForge 的批注文件")
    token = payload.get("share_token")
    if not isinstance(token, str) or not _TOKEN_RE.fullmatch(token):
        raise ReviewAnnotationError("批注文件的分享码不合法", status_code=403)
    if not verify_share_token(package, token):
        raise ReviewAnnotationError("批注文件不属于这个分享包，已拒绝导入", status_code=403)
    snapshot_sha = _require_text(
        payload.get("package_snapshot_sha256"), "package_snapshot_sha256", 64
    )
    if len(snapshot_sha) != 64:
        raise ReviewAnnotationError("批注文件的快照指纹不合法")
    raw_annotations = payload.get("annotations")
    if not isinstance(raw_annotations, list):
        raise ReviewAnnotationError("批注文件缺少 annotations 数组")
    if len(raw_annotations) > MAX_ANNOTATIONS_PER_FILE:
        raise ReviewAnnotationError("单次导入批注条数超过上限（500 条）")
    reviewer = _require_text(payload.get("reviewer") or "", "reviewer", MAX_ANNOTATION_REVIEWER)
    parsed: list[dict[str, Any]] = []
    for index, item in enumerate(raw_annotations):
        if not isinstance(item, dict):
            raise ReviewAnnotationError(f"第 {index + 1} 条批注结构不正确")
        external_id = _require_text(
            item.get("external_id"), "external_id", MAX_ANNOTATION_EXTERNAL_ID
        )
        if not external_id.strip():
            raise ReviewAnnotationError(f"第 {index + 1} 条批注缺少 external_id")
        text = _require_text(item.get("text"), "text", MAX_ANNOTATION_TEXT)
        if not text.strip():
            raise ReviewAnnotationError(f"第 {index + 1} 条批注正文为空")
        quoted = _require_text(item.get("quoted_text") or "", "quoted_text", MAX_ANNOTATION_QUOTED)
        object_id = item.get("object_id")
        point_id = item.get("point_id")
        path = item.get("path")
        field = item.get("field")
        if object_id is not None:
            object_id = _require_text(object_id, "object_id", 32)
        if point_id is not None:
            point_id = _require_text(point_id, "point_id", 32)
        if path is not None:
            path = _require_text(path, "path", 256)
        if field is not None:
            field = _require_text(field, "field", 64)
        parsed.append(
            {
                "external_id": external_id.strip(),
                "text": text.strip(),
                "quoted_text": quoted.strip(),
                "object_id": object_id,
                "point_id": point_id,
                "path": path,
                "field": field,
            }
        )
    return {
        "share_token": token,
        "snapshot_sha256": snapshot_sha,
        "reviewer": reviewer.strip(),
        "annotations": parsed,
    }


def _lookup_value(content: Any, path: str) -> Any:
    if isinstance(content, dict) and content.get("version") == 2:
        return read_document_value(content, path)
    current: Any = content
    for segment in path.split("."):
        if isinstance(current, dict):
            if segment not in current:
                return None
            current = current[segment]
        elif isinstance(current, list):
            try:
                current = current[int(segment)]
            except (ValueError, IndexError):
                return None
        else:
            return None
    return current


def resolve_anchor(
    content: dict[str, Any], object_id: str | None, point_id: str | None, path: str | None
) -> tuple[bool, str | None, str | None, str | None]:
    """解析批注锚点：返回 (是否命中, 当前路径, object_id, point_id)。"""
    if content.get("version") == 2:
        if object_id:
            target = identity_path(content, object_id, point_id)
        else:
            target = resolve_document_path(content, path or "")
            if target is not None and point_id and (target.item or {}).get("id") != point_id:
                target = None
        if target is None:
            return False, None, object_id, point_id
        if target.item is not None:
            object_id = target.entry["id"] if target.entry is not None else target.item["id"]
            point_id = target.item["id"]
        elif target.entry is not None:
            object_id, point_id = target.entry["id"], None
        return True, target.path, object_id, point_id
    if object_id and is_object_id(object_id):
        if point_id and is_object_id(point_id):
            resolved = resolve_point_path(content, object_id, point_id)
        else:
            resolved = resolve_object_path(content, object_id)
        if resolved is not None:
            return True, resolved, object_id, point_id or None
    if path and _lookup_value(content, path) is not None:
        return True, path, object_id, point_id
    return False, None, object_id, point_id


def _version_or_error(db: Session, version_id: Any, resume_id: int | None) -> int | None:
    if version_id is None:
        return None
    if not isinstance(version_id, int):
        raise ReviewAnnotationError("document_version_id 不合法")
    version = db.get(ResumeVersion, version_id)
    if version is None or (resume_id is not None and version.resume_id != resume_id):
        raise ReviewAnnotationError("批注绑定的版本不存在或不属于这份简历")
    return version.id


def import_annotations(db: Session, package: SharePackage, raw: str) -> dict[str, Any]:
    """导入批注：九步校验 + 去重 + 单事务写库；返回计数与新建批注。"""
    if package.permission != SHARE_PERMISSION_COMMENT:
        raise ReviewAnnotationError("这份分享包不支持批注", status_code=403)
    parsed = parse_annotation_file(raw, package)
    record = db.get(ResumeRecord, package.resume_id) if package.resume_id else None
    if record is not None and record.deleted_at is not None:
        record = None
    snapshot_match = parsed["snapshot_sha256"] == package_snapshot_sha256(package)
    version_id = _version_or_error(db, _read_version_id(raw), package.resume_id)
    existing = db.execute(
        select(ResumeReviewAnnotation.external_id, ResumeReviewAnnotation.status).where(
            ResumeReviewAnnotation.share_package_id == package.id
        )
    ).all()
    existing_status = {str(row[0]): str(row[1]) for row in existing}
    created: list[ResumeReviewAnnotation] = []
    duplicates = 0
    dismissed_existing = 0
    stale_count = 0
    content = document_io.document_for_record(db, record)[0] if record is not None else {}
    for item in parsed["annotations"]:
        if item["external_id"] in existing_status:
            duplicates += 1
            if existing_status[item["external_id"]] == ANNOTATION_STATUS_DISMISSED:
                dismissed_existing += 1
            continue
        hit = False
        resolved_path = item["path"]
        object_id = item["object_id"]
        point_id = item["point_id"]
        if record is not None and not snapshot_match:
            hit = False
        elif record is not None:
            hit, resolved_path, object_id, point_id = resolve_anchor(
                content, item["object_id"], item["point_id"], item["path"]
            )
        status = ANNOTATION_STATUS_OPEN if hit else ANNOTATION_STATUS_STALE
        if status == ANNOTATION_STATUS_STALE:
            stale_count += 1
        row = ResumeReviewAnnotation(
            share_package_id=package.id,
            resume_id=package.resume_id,
            document_version_id=version_id,
            snapshot_sha256=parsed["snapshot_sha256"],
            external_id=item["external_id"],
            object_id=object_id,
            point_id=point_id,
            path=resolved_path,
            field=item["field"],
            quoted_text=item["quoted_text"],
            text=item["text"],
            reviewer=parsed["reviewer"],
            status=status,
        )
        db.add(row)
        created.append(row)
    db.commit()
    for row in created:
        db.refresh(row)
    return {
        "imported": len(created),
        "duplicates": duplicates,
        "stale": stale_count,
        "dismissed_existing": dismissed_existing,
        "annotations": [annotation_brief(row) for row in created],
    }


def _read_version_id(raw: str) -> Any:
    try:
        payload = json.loads(raw)
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None
    if not isinstance(payload, dict):
        return None
    return payload.get("document_version_id")


def list_annotations(db: Session, package_id: int) -> list[ResumeReviewAnnotation]:
    return list(
        db.execute(
            select(ResumeReviewAnnotation)
            .where(ResumeReviewAnnotation.share_package_id == package_id)
            .order_by(ResumeReviewAnnotation.id)
        )
        .scalars()
        .all()
    )


def get_annotation(db: Session, annotation_id: int) -> ResumeReviewAnnotation:
    row = db.get(ResumeReviewAnnotation, annotation_id)
    if row is None:
        raise AnnotationNotFoundError()
    return row


def _transition(
    db: Session, annotation_id: int, *, target: str, allowed_from: set[str]
) -> ResumeReviewAnnotation:
    row = get_annotation(db, annotation_id)
    if row.status not in allowed_from:
        raise AnnotationTransitionError("当前状态的批注不能执行这个动作")
    row.status = target
    if target == ANNOTATION_STATUS_RESOLVED:
        row.resolved_at = datetime.now(UTC)
    elif target in (ANNOTATION_STATUS_OPEN, ANNOTATION_STATUS_DISMISSED):
        row.resolved_at = None
    db.commit()
    db.refresh(row)
    return row


def resolve_annotation(db: Session, annotation_id: int) -> ResumeReviewAnnotation:
    return _transition(
        db,
        annotation_id,
        target=ANNOTATION_STATUS_RESOLVED,
        allowed_from={ANNOTATION_STATUS_OPEN, ANNOTATION_STATUS_RESOLVED},
    )


def reopen_annotation(db: Session, annotation_id: int) -> ResumeReviewAnnotation:
    return _transition(
        db,
        annotation_id,
        target=ANNOTATION_STATUS_OPEN,
        allowed_from={ANNOTATION_STATUS_RESOLVED, ANNOTATION_STATUS_OPEN},
    )


def dismiss_annotation(db: Session, annotation_id: int) -> ResumeReviewAnnotation:
    return _transition(
        db,
        annotation_id,
        target=ANNOTATION_STATUS_DISMISSED,
        allowed_from=set(_ALLOWED_TRANSITIONS),
    )


def reattach_annotation(
    db: Session, annotation_id: int, *, object_id: str, point_id: str | None
) -> ResumeReviewAnnotation:
    row = get_annotation(db, annotation_id)
    if row.status != ANNOTATION_STATUS_STALE:
        raise AnnotationTransitionError("只有已失联的批注需要重新挂接")
    record = db.get(ResumeRecord, row.resume_id) if row.resume_id else None
    if record is None or record.deleted_at is not None:
        raise ReviewAnnotationError("原简历不存在或已被删除，无法重挂")
    hit, resolved_path, resolved_object, resolved_point = resolve_anchor(
        document_io.document_for_record(db, record)[0], object_id, point_id, None
    )
    if not hit:
        raise ReviewAnnotationError("要重挂的对象在当前简历里找不到")
    row.object_id = resolved_object
    row.point_id = resolved_point
    row.path = resolved_path
    row.status = ANNOTATION_STATUS_OPEN
    row.resolved_at = None
    if row.share_package_id:
        package = db.get(SharePackage, row.share_package_id)
        if package is not None:
            row.snapshot_sha256 = package_snapshot_sha256(package)
    db.commit()
    db.refresh(row)
    return row


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


__all__ = [
    "AnnotationNotFoundError",
    "AnnotationTransitionError",
    "REVIEW_PACKAGE_HINT",
    "ReviewAnnotationError",
    "annotation_brief",
    "build_annotations_template",
    "build_review_package_zip",
    "dismiss_annotation",
    "get_annotation",
    "import_annotations",
    "list_annotations",
    "package_snapshot_sha256",
    "parse_annotation_file",
    "reattach_annotation",
    "reopen_annotation",
    "resolve_anchor",
    "resolve_annotation",
]
