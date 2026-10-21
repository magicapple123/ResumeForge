# SPDX-License-Identifier: Apache-2.0
"""``user_file`` 副本的校验与自愈（P5）：缺失/损坏时按库内原件补回。

**为什么单独一个模块**：``user_files.py`` 已经挂着"登记/去重/回填/后台调度"四件事，
行数顶到 500 的预算；而"副本到底对不对"是一条独立的判定（先 stat 再算哈希、原子写、
安全边界），值得有自己的名字与测试。这里只做判定与补写，**不登记新行、不删任何文件**。

安全边界（方案 P5 / D5，改这里之前先读）：

- 只有 ``sha256(content) == row.sha256`` 才允许写盘。原件与行登记不一致说明库自身
  有问题，此时**不动磁盘、只报警**——否则"自愈"会把来路不明的字节写成用户的文件；
- 覆盖条件严格是"副本缺失 / 大小不符 / 哈希不符"，用户手工放进 ``user_files/`` 的
  同名自制文件在哈希一致时不会被重写；
- 写入用临时文件 + ``os.replace``，半截文件不会留在用户目录里；
- 整个过程不删除任何磁盘文件（孤儿清理是独立需求）。
"""

from __future__ import annotations

import binascii
import hashlib
import json
import logging
import os
from pathlib import Path

from sqlalchemy.orm import Session

from ..models.user_file import UserFile

logger = logging.getLogger(__name__)

# 与 user_files 的回填批量保持一致：取数分批，避免大表整表入内存。
_BATCH = 200


def copy_matches(path: Path, expected_size: int, expected_sha: str) -> bool:
    """副本是否"在、且字节还是它登记的那一份"。

    先比大小再算哈希：大文件在绝大多数情况下一次 ``stat`` 就能判定，不必整份读。
    """
    try:
        if path.stat().st_size != expected_size:
            return False
        digest = hashlib.sha256()
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1 << 20), b""):
                digest.update(chunk)
    except OSError:
        return False
    return digest.hexdigest() == expected_sha


def write_atomic(target: Path, content: bytes) -> None:
    """临时文件 + ``os.replace``：中途失败不会在用户目录里留下半截副本。"""
    temporary = target.with_name(f"{target.name}.tmp")
    temporary.write_bytes(content)
    os.replace(temporary, target)


def ensure_copy(directory: Path, row: UserFile, content: bytes) -> bool:
    """确保行的磁盘副本存在且正确；真正补写过返回 True。

    调用方传进来的 ``content`` 必须是**库内原件**（不是包里的字节）：安全边界见模块
    docstring——哈希对不上就只记 warning，绝不覆盖磁盘。
    """
    target = directory / row.disk_name
    if copy_matches(target, int(row.size or 0), row.sha256 or ""):
        return False
    digest = hashlib.sha256(content).hexdigest()
    if not row.sha256 or digest != row.sha256:
        logger.warning(
            "用户文件副本：库内原件与行登记哈希不符，未改动磁盘（disk_name=%s）", row.disk_name
        )
        return False
    try:
        directory.mkdir(parents=True, exist_ok=True)
        write_atomic(target, content)
    except OSError:
        logger.warning("用户文件副本：补写磁盘失败（disk_name=%s）", row.disk_name, exc_info=True)
        return False
    logger.warning("用户文件副本缺失或已损坏，已按库内原件重写：%s", row.disk_name)
    return True


def _source_entries(row: UserFile) -> list[dict[str, str]]:
    """该行登记过的来源，行上的主来源优先（新来源追加在 ``sources_json`` 尾部）。"""
    entries: list[dict[str, str]] = []
    try:
        parsed = json.loads(row.sources_json or "[]")
    except ValueError:
        parsed = []
    if isinstance(parsed, list):
        for item in parsed:
            if isinstance(item, dict) and isinstance(item.get("source_ref"), str):
                entries.append(
                    {
                        "source_type": str(item.get("source_type") or ""),
                        "source_ref": item["source_ref"],
                    }
                )
    primary = {
        "source_type": str(row.source_type or ""),
        "source_ref": str(row.source_ref or ""),
    }
    if primary["source_ref"]:
        entries.insert(0, primary)
    return entries


def _split_source_ref(ref: str) -> tuple[str, int] | None:
    """``"material:12"`` → ``("material", 12)``；形状不对返回 None。"""
    prefix, separator, value = (ref or "").partition(":")
    if not separator or not value.isdigit():
        return None
    return prefix, int(value)


def _decode(data_url: str) -> bytes | None:
    """复用 ``user_files._decode_data_url``（延迟导入：那边模块级 import 本模块）。"""
    from .user_files import _decode_data_url

    try:
        content, _mime = _decode_data_url(data_url)
    except (ValueError, binascii.Error, TypeError):
        return None
    return content


def _lookup_original(db: Session, source_ref: str, sha: str) -> bytes | None:
    """按来源反查库内原件，并**只认哈希一致的那一份**。

    原件是各业务表里的 base64（``user_file`` 只是镜像登记）。同一行的多个附属文件
    （资料箱多附件、岗位多张备注图）靠 sha256 定位到具体那一份。
    """
    parsed = _split_source_ref(source_ref)
    if parsed is None:
        return None
    prefix, ident = parsed
    if prefix == "material":
        from ..models.material import Material

        record = db.get(Material, ident)
        items = (
            [str((item or {}).get("data_url") or "") for item in (record.files or [])]
            if record is not None
            else []
        )
    elif prefix == "profile":
        from ..models.profile import UserProfile

        record = db.get(UserProfile, ident)
        items = [str(record.photo or "")] if record is not None else []
    elif prefix == "job":
        from ..models.job import Job

        record = db.get(Job, ident)
        items = [str(url) for url in (record.note_images or [])] if record is not None else []
    elif prefix == "candidate_job":
        from ..models.material import CandidateJob

        record = db.get(CandidateJob, ident)
        items = [str(url) for url in (record.images or [])] if record is not None else []
    elif prefix == "chat_message":
        from ..models.assistant import ChatMessage

        record = db.get(ChatMessage, ident)
        items = (
            [str((item or {}).get("data_url") or "") for item in (record.attachments or [])]
            if record is not None
            else []
        )
    else:
        return None
    for data_url in items:
        if not data_url:
            continue
        content = _decode(data_url)
        if content is not None and hashlib.sha256(content).hexdigest() == sha:
            return content
    return None


def ensure_copies(bind) -> dict[str, int]:
    """遍历 ``user_file``，把缺失/损坏的副本按库内原件补回（P5，导出前调用）。

    这是"行在、文件不在"的兜底：``backfill_missing_copies`` 只在还能重新遇到
    data URL 时才修复，而这里直接按 ``user_file`` 走一遍，覆盖原件仍在库内、副本
    却被外部清理或改坏的情形。**不删行、不删文件**；取不到原件或原件与行登记哈希
    不符的计入 ``unresolved`` 并记 warning，留给导出告警如实呈现。
    """
    from .user_files import user_files_dir

    stats = {"checked": 0, "repaired": 0, "unresolved": 0}
    directory = user_files_dir(bind)
    with Session(bind) as session:
        rows = session.query(UserFile).yield_per(_BATCH)
        for row in rows:
            stats["checked"] += 1
            if copy_matches(directory / row.disk_name, int(row.size or 0), row.sha256 or ""):
                continue
            content = None
            for entry in _source_entries(row):
                content = _lookup_original(session, entry["source_ref"], row.sha256 or "")
                if content is not None:
                    break
            if content is None:
                stats["unresolved"] += 1
                logger.warning("用户文件副本无法自愈（库内已无原件）：%s", row.disk_name)
                continue
            if ensure_copy(directory, row, content):
                stats["repaired"] += 1
            else:
                stats["unresolved"] += 1
    return stats


__all__ = [
    "copy_matches",
    "ensure_copy",
    "ensure_copies",
    "write_atomic",
]
