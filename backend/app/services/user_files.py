"""用户文件副本库（R6）。

数据库里的用户文件——资料箱附件（``material.files[].data_url``）、个人照片
（``user_profile.photo`` / ``profile_photo.image``）、岗位备注图（``job.note_images``）、
备选岗位截图（``candidate_job.images``）、助手消息附件（``chat_message.attachments``）——
都以 base64 data URL 存在 SQLite 列里。这里把同一份内容**额外**落一份磁盘副本，
统一放在 ``<数据库同目录>/user_files/``（与 ``referral_images`` 同一套"以数据库文件
所在目录为根"的规则，测试库自动隔离），按 ``sha256`` 去重，供文件副本库页预览、
用系统程序打开。

写入永远是 best-effort：解析失败、磁盘失败一律只记 warning，绝不影响主流程。
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import json
import logging
import re
import threading
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import DATA_DIR
from ..models.user_file import UserFile

logger = logging.getLogger(__name__)

# 副本目录名（相对数据库文件所在目录）：与 referral_images、share_packages 同级。
USER_FILES_DIRNAME = "user_files"

# sources_json 里最多保留多少条来源：超过后丢最旧的，防止一份数据被几十个入口
# 反复引用时把这一列撑成无底洞。
_SOURCES_MAX = 50

# 落盘原名里的非法字符（保留中文、字母数字与 ._-，其余换下划线）。
_UNSAFE_NAME_CHARS = re.compile(r"[^\w.\-\u4e00-\u9fff]+")

# 回填的分批大小：yield_per 的取数批量，避免一次把大表整表载入内存。
_BACKFILL_BATCH = 200


def user_files_dir(bind=None) -> Path:
    """副本目录：文件型 SQLite 落在数据库同目录，其余回退到数据目录。

    与 ``referral_service.referral_images_dir`` 完全同一套规则：测试库（独立的文件
    路径）自动隔离，内存库等回退到 ``DATA_DIR``。
    """
    url = getattr(bind, "url", None)
    database = getattr(url, "database", None)
    if database and database != ":memory:" and Path(database).is_absolute():
        return Path(database).resolve().parent / USER_FILES_DIRNAME
    return DATA_DIR / USER_FILES_DIRNAME


def _safe_original_name(name: str) -> str:
    """把用户给的原名压成可以安全落盘的一段文件名（不带目录、无非法字符）。"""
    cleaned = re.split(r"[/\\]", (name or "").strip())[-1]
    cleaned = _UNSAFE_NAME_CHARS.sub("_", cleaned).strip("._") or "file"
    return cleaned[:120]


def _stored_name(sha: str, original_name: str) -> str:
    """落盘名：``<sha 前 16 位>-<安全化原名>``，保留扩展名，总长不超 160。"""
    safe = _safe_original_name(original_name)
    stem, dot, extension = safe.rpartition(".")
    if not dot or not stem:
        stem, dot, extension = safe, "", ""
    return f"{sha[:16]}-{stem[:100]}{dot}{extension}"[:160]


def _merge_source(row: UserFile, source_type: str, source_ref: str) -> None:
    """把一个来源并入该行的 ``sources_json``（JSON 数组，去重追加，超限丢最旧）。"""
    entry = {"source_type": source_type, "source_ref": source_ref}
    try:
        sources = json.loads(row.sources_json or "[]")
        if not isinstance(sources, list):
            sources = []
    except ValueError:
        sources = []
    if entry in sources:
        return
    sources.append(entry)
    row.sources_json = json.dumps(sources[-_SOURCES_MAX:], ensure_ascii=False)


def save_from_bytes(
    db: Session,
    content: bytes,
    *,
    original_name: str,
    mime: str,
    source_type: str,
    source_ref: str,
) -> None:
    """把一份字节内容登记为用户文件副本。

    同 ``sha256`` 已有行：只把新来源并入 ``sources_json``，不重复落盘、不加行；
    否则写盘（磁盘上已有同 sha 文件时不重写）并插入一行。``original_name`` 会做
    服务端安全化，客户端给的任何路径成分都不会进落盘名。
    """
    if not content:
        return
    sha = hashlib.sha256(content).hexdigest()
    existing = db.execute(select(UserFile).where(UserFile.sha256 == sha)).scalar_one_or_none()
    if existing is not None:
        _merge_source(existing, source_type, source_ref)
        db.commit()
        return

    safe_name = _safe_original_name(original_name)
    disk_name = _stored_name(sha, safe_name)
    directory = user_files_dir(db.get_bind())
    directory.mkdir(parents=True, exist_ok=True)
    target = directory / disk_name
    if not target.exists():
        target.write_bytes(content)

    row = UserFile(
        sha256=sha,
        disk_name=disk_name,
        original_name=safe_name[:255],
        mime=(mime or "application/octet-stream").strip()[:120] or "application/octet-stream",
        size=len(content),
        source_type=(source_type or "")[:40],
        source_ref=(source_ref or "")[:120],
    )
    _merge_source(row, source_type, source_ref)
    db.add(row)
    db.commit()
    logger.info("已保存用户文件副本 id=%s name=%s size=%s", row.id, row.original_name, row.size)


def _decode_data_url(data_url: str) -> tuple[bytes, str]:
    """把 data URL（或无 ``data:`` 前缀的裸 base64）解码成字节与声明的 MIME。"""
    value = (data_url or "").strip()
    if not value:
        raise ValueError("空 data URL")
    mime = ""
    if value.casefold().startswith("data:"):
        header, separator, payload = value.partition(",")
        mime = header[5:].split(";", 1)[0].strip()
        if not separator or not payload:
            raise ValueError("data URL 缺少内容")
    else:
        payload = value
    content = base64.b64decode("".join(payload.split()), validate=False)
    if not content:
        raise ValueError("data URL 解码为空")
    return content, mime


def save_from_data_url(
    db: Session,
    data_url: str,
    *,
    source_type: str,
    source_ref: str,
    fallback_name: str = "",
    fallback_mime: str = "",
) -> None:
    """把一个 data URL（兼容裸 base64）保存为副本；解析失败只记 warning。"""
    try:
        content, mime = _decode_data_url(data_url)
    except (ValueError, binascii.Error, TypeError):
        logger.warning(
            "用户文件副本：data URL 解析失败，已跳过（source=%s:%s）", source_type, source_ref
        )
        return
    name = fallback_name or f"file-{sha_prefix(content)}"
    save_from_bytes(
        db,
        content,
        original_name=name,
        mime=mime or fallback_mime or "application/octet-stream",
        source_type=source_type,
        source_ref=source_ref,
    )


def sha_prefix(content: bytes) -> str:
    """没有原名时给副本起名的短指纹（仅用于展示，判重仍靠完整 sha256）。"""
    return hashlib.sha256(content).hexdigest()[:8]


def backfill_missing_copies(db: Session) -> int:
    """幂等回填：扫描各表里的 data URL 字段补齐磁盘副本，返回处理的条目数。

    每个来源逐行逐条 try/except：任何一条坏了只跳过自己，不中断整轮。重复回填
    是安全的——同 sha 的保存会合并来源而不是加行。
    """
    processed = 0
    processed += _backfill_material_files(db)
    processed += _backfill_profile_photos(db)
    processed += _backfill_job_note_images(db)
    processed += _backfill_candidate_images(db)
    processed += _backfill_chat_attachments(db)
    return processed


def _backfill_material_files(db: Session) -> int:
    from ..models.material import Material

    processed = 0
    rows = db.query(Material).yield_per(_BACKFILL_BATCH)
    for material in rows:
        for item in material.files or []:
            if not isinstance(item, dict):
                continue
            data_url = str(item.get("data_url") or "")
            if not data_url:
                continue
            try:
                save_from_data_url(
                    db,
                    data_url,
                    source_type="material",
                    source_ref=f"material:{material.id}",
                    fallback_name=str(item.get("name") or ""),
                    fallback_mime=str(item.get("mime_type") or ""),
                )
                processed += 1
            except Exception:  # noqa: BLE001 - 单条失败不中断回填
                logger.warning(
                    "回填资料附件副本失败 material:%s", material.id, exc_info=True
                )
    return processed


def _backfill_profile_photos(db: Session) -> int:
    from ..models.profile import UserProfile

    processed = 0
    rows = db.query(UserProfile).yield_per(_BACKFILL_BATCH)
    for profile in rows:
        photo = str(profile.photo or "")
        if not photo:
            continue
        try:
            save_from_data_url(
                db,
                photo,
                source_type="photo",
                source_ref=f"profile:{profile.id}",
                fallback_name=f"profile-{profile.id}",
            )
            processed += 1
        except Exception:  # noqa: BLE001 - 单条失败不中断回填
            logger.warning("回填个人照片副本失败 profile:%s", profile.id, exc_info=True)
    return processed


def _backfill_job_note_images(db: Session) -> int:
    from ..models.job import Job

    processed = 0
    rows = db.query(Job).yield_per(_BACKFILL_BATCH)
    for job in rows:
        for index, data_url in enumerate(job.note_images or []):
            if not data_url:
                continue
            try:
                save_from_data_url(
                    db,
                    str(data_url),
                    source_type="job_note",
                    source_ref=f"job:{job.id}",
                    fallback_name=f"job-{job.id}-note-{index + 1}",
                )
                processed += 1
            except Exception:  # noqa: BLE001 - 单条失败不中断回填
                logger.warning("回填岗位备注图副本失败 job:%s", job.id, exc_info=True)
    return processed


def _backfill_candidate_images(db: Session) -> int:
    from ..models.material import CandidateJob

    processed = 0
    rows = db.query(CandidateJob).yield_per(_BACKFILL_BATCH)
    for candidate in rows:
        for index, data_url in enumerate(candidate.images or []):
            if not data_url:
                continue
            try:
                save_from_data_url(
                    db,
                    str(data_url),
                    source_type="candidate_image",
                    source_ref=f"candidate_job:{candidate.id}",
                    fallback_name=f"candidate-{candidate.id}-{index + 1}",
                )
                processed += 1
            except Exception:  # noqa: BLE001 - 单条失败不中断回填
                logger.warning(
                    "回填备选岗位截图副本失败 candidate_job:%s", candidate.id, exc_info=True
                )
    return processed


def _backfill_chat_attachments(db: Session) -> int:
    from ..models.assistant import ChatMessage

    processed = 0
    rows = db.query(ChatMessage).yield_per(_BACKFILL_BATCH)
    for message in rows:
        for item in message.attachments or []:
            if not isinstance(item, dict):
                continue
            data_url = str(item.get("data_url") or "")
            if not data_url:
                continue
            try:
                save_from_data_url(
                    db,
                    data_url,
                    source_type="chat_attachment",
                    source_ref=f"chat_message:{message.id}",
                    fallback_name=str(item.get("name") or ""),
                    fallback_mime=str(item.get("mime_type") or ""),
                )
                processed += 1
            except Exception:  # noqa: BLE001 - 单条失败不中断回填
                logger.warning(
                    "回填助手附件副本失败 chat_message:%s", message.id, exc_info=True
                )
    return processed


def schedule_backfill(path: Path | None = None) -> None:
    """在后台线程里跑一次回填，绝不抛错、绝不阻断调用方。

    ``path`` 为空时对**当前激活库**（``database.SessionLocal``）回填；给了路径
    （例如刚导入的数据集文件）则临时建引擎跑完即释放。切换/导入完成后各调一次，
    覆盖"数据集迁移后副本再生"。
    """

    def _run() -> None:
        try:
            if path is None:
                from .. import database as app_database

                with app_database.SessionLocal() as session:
                    backfill_missing_copies(session)
            else:
                from ..database import build_engine, database_url_for

                engine = build_engine(database_url_for(path))
                try:
                    with Session(engine) as session:
                        backfill_missing_copies(session)
                finally:
                    engine.dispose()
        except Exception:  # noqa: BLE001 - 后台线程绝不能把服务拖垮
            logger.warning("用户文件副本回填线程异常退出", exc_info=True)

    threading.Thread(target=_run, name="resumeforge-user-files-backfill", daemon=True).start()
