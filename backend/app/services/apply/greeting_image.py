# SPDX-License-Identifier: Apache-2.0
"""招呼语附带图片：全局设置、图片来源解析、临时文件落盘与审计（T8）。

为什么单独成模块：``task_apply.py`` 贴着 500 行预算，而这一支的规则（选哪几张图、图从哪
拿到字节、临时文件放哪里、谁来删、结果怎么记）既要被执行链调用，也要被单测直接盯着断言。
把它抽出来之后，"解析顺序"和"临时文件一定被删"这两条可以脱离浏览器单独验证。

三条硬约束（来自台账第 10 条，改动前请先读）：

1. **只存引用**：``apply_queue_item.image_ids`` 里是 ``user_file.id``，不是 data URL。
   一张截图 base64 进来就是 MB 级，队列列表接口会被整个撑爆。
2. **解析顺序固定**：行内 ``image_ids`` → 全局 ``apply.greeting_image_id`` → 不发图。
   行内一旦选了就压过全局（这是"每岗可覆盖"的唯一含义），全局开关只管兜底那一档。
3. **失败不进投递状态**：文本已经送达，图片失败只是"图片没送到"，由调用方写
   ``image_status=upload_failed``；本模块只负责把原因说清楚。

临时文件的生命周期：``stage_greeting_images`` 建一个独立目录 → 调用方在 ``finally`` 里
``cleanup()``。目录名带固定前缀（:data:`TEMP_DIR_PREFIX`），单测据此断言"异常路径也没留下
残骸"。
"""

from __future__ import annotations

import json
import logging
import shutil
import tempfile
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from ...models.apply import (
    IMAGE_TARGET_GREETING_IMAGE,
    ApplyQueueItem,
    ApplyTaskItem,
)
from ...models.profile import utcnow
from ...models.setting import AppSetting
from ...models.user_file import UserFile
from .. import attachments
from ..user_files import user_files_dir

logger = logging.getLogger(__name__)

# 全局设置键（``AppSetting`` KV，JSON 存储）。默认**关闭**：发图属于"主动外发内容"，
# 比发文本更容易被站点判成营销，而且发出去不可撤回——必须由用户显式打开。
KEY_GREETING_IMAGE_ENABLED = "apply.greeting_image_enabled"
KEY_GREETING_IMAGE_ID = "apply.greeting_image_id"

# 临时目录前缀：单测与运维据此判断"有没有留下残骸"。
TEMP_DIR_PREFIX = "rf-greeting-image-"

# MIME → 临时文件扩展名。**扩展名必须与内容一致**：站点按扩展名/魔数判格式，写错会让
# 本来合法的图片在站点侧被拒，而错误会以"上传失败"的形态回来，排查时完全看不出原因。
_EXTENSION_BY_MIME = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


class GreetingImageError(ValueError):
    """图片这一支自己的错误：文案面向用户，且**永不**把整条投递判失败。

    继承 ``ValueError`` 与 ``attachments`` / ``image_conversion`` 的错误同一口径：
    它们是"这张图不能用"，不是"站点坏了"。
    """


@dataclass(frozen=True)
class GreetingImageSetting:
    """全局默认图片：``enabled`` 是兜底总开关，``image_id`` 是默认哪一张（可空）。"""

    enabled: bool = False
    image_id: int | None = None


@dataclass
class StagedImage:
    """一张已经落到临时文件里的图片。"""

    file_id: int
    name: str
    mime: str
    size_bytes: int
    path: Path


@dataclass
class Staging:
    """一次发图动作的临时目录；**调用方必须 ``cleanup()``**（放 ``finally``）。"""

    directory: Path
    images: list[StagedImage] = field(default_factory=list)
    # 被本地规则挡下来的原因（例如"第 2 张是 SVG"）。有值时 ``images`` 一定为空：
    # 校验是"全或全无"，不做半发——发一半比一张不发更难解释。
    rejections: list[str] = field(default_factory=list)

    def paths(self) -> list[str]:
        return [str(image.path) for image in self.images]

    def file_ids(self) -> list[int]:
        return [image.file_id for image in self.images]

    def cleanup(self) -> None:
        """删掉整个临时目录；删不掉只记 warning（用户投递已经成功，不该被清理失败打断）。"""
        shutil.rmtree(self.directory, ignore_errors=True)


# ===== 全局设置 =====


def _read_setting(db: Session, key: str, fallback: Any) -> Any:
    row = db.get(AppSetting, key)
    if row is None:
        return fallback
    try:
        return json.loads(row.value)
    except (TypeError, ValueError):
        logger.warning("设置项 %s 的内容无法解析，已按默认值处理", key)
        return fallback


def _write_setting(db: Session, key: str, value: Any) -> None:
    serialized = json.dumps(value, ensure_ascii=False)
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=serialized))
    else:
        row.value = serialized


def collect_reference_candidates(
    db: Session, global_image_id: int | None
) -> list[tuple[object, str]]:
    """扫出"可能引用了某张配图"的原始候选：``(值, 引用位置)``。

    为什么放在服务层：``api/apply_extra.py`` 的 ``_greeting_reference_labels`` 原来自己
    ``db.query(...)``，违反「服务层是唯一数据入口」，被 ``test_api_layer_rules`` 判红（CR-18 收口）。
    这里只固定"要扫哪三处"；脏 JSON 的宽容（``int()`` 失败就跳过）仍留在调用方——那是
    展示层的取舍，不是数据边界。

    审计行可能很多：先用"JSON 不是空数组"粗筛，再逐行精确判定（LIKE 子串会误中 12/2）。
    """
    candidates: list[tuple[object, str]] = []
    if global_image_id is not None:
        candidates.append((global_image_id, "全局默认图片"))
    for (image_ids,) in db.execute(select(ApplyQueueItem.image_ids)).all():
        for value in image_ids or []:
            candidates.append((value, "投递队列"))
    audit_rows = db.execute(
        select(ApplyTaskItem.image_file_ids).where(
            func.length(cast(ApplyTaskItem.image_file_ids, String)) > 2
        )
    ).all()
    for (image_ids,) in audit_rows:
        for value in image_ids or []:
            candidates.append((value, "投递记录"))
    return candidates


def get_greeting_image_setting(db: Session) -> GreetingImageSetting:
    """读全局设置；缺失 / 脏数据一律按"关闭 + 没有默认图"处理（保守方向）。"""
    enabled = _read_setting(db, KEY_GREETING_IMAGE_ENABLED, False)
    raw_id = _read_setting(db, KEY_GREETING_IMAGE_ID, None)
    image_id: int | None = None
    if isinstance(raw_id, int) and raw_id > 0:
        image_id = raw_id
    elif isinstance(raw_id, str) and raw_id.strip().isdigit():
        image_id = int(raw_id.strip())
    return GreetingImageSetting(enabled=bool(enabled), image_id=image_id)


def save_greeting_image_setting(
    db: Session, *, enabled: bool, image_id: int | None
) -> GreetingImageSetting:
    """写全局设置。``image_id`` 给了就必须是**已存在的图片副本**，否则明确拒绝。

    为什么不让它存一个不存在的 id：投递时才失败的话，用户看到的是"投递成功但图片没送到"，
    而原因（那张图早被删了）在设置页完全看不出来。
    """
    if image_id is not None:
        _require_image_row(db, image_id)
    _write_setting(db, KEY_GREETING_IMAGE_ENABLED, bool(enabled))
    _write_setting(db, KEY_GREETING_IMAGE_ID, image_id)
    db.commit()
    return GreetingImageSetting(enabled=bool(enabled), image_id=image_id)


# ===== 解析顺序 =====


def normalize_image_ids(values: Iterable[Any] | None) -> list[int]:
    """把库里的 JSON / 请求里的列表收敛成"去重、保序的正整数 id 列表"。

    脏值（字符串、0、负数、``None``）直接丢掉而不是报错：这一列是用户可编辑的 JSON，
    一条脏数据不该让整条队列读不出来。
    """
    result: list[int] = []
    for value in values or []:
        candidate: int | None = None
        if isinstance(value, bool):
            candidate = None
        elif isinstance(value, int):
            candidate = value
        elif isinstance(value, str) and value.strip().isdigit():
            candidate = int(value.strip())
        if candidate is None or candidate <= 0 or candidate in result:
            continue
        result.append(candidate)
    return result


def resolve_image_ids(item_ids: Iterable[Any] | None, setting: GreetingImageSetting) -> list[int]:
    """**唯一的解析顺序**：行内 ``image_ids`` → 全局 ``greeting_image_id`` → 不发图。

    - 行内选了就用行内的，**不看** ``enabled``：那是用户对这一条岗位的显式选择，
      与"默认关"不冲突（默认关只约束"没人选时用不用全局默认"）。
    - 行内为空时看全局：``enabled`` 为真且 ``image_id`` 有值才发。
    - 两档都空 → 空列表，调用方据此**连上传步骤都不开**（反证用例断言的就是这一条）。
    """
    own = normalize_image_ids(item_ids)
    if own:
        return own
    if setting.enabled and setting.image_id:
        return [int(setting.image_id)]
    return []


# ===== 落临时文件 =====


def _require_image_row(db: Session, file_id: int) -> UserFile:
    row = db.get(UserFile, int(file_id))
    if row is None:
        raise GreetingImageError(
            f"所选的图片（文件 id={int(file_id)}）已不在文件副本库里（可能被清理过），请重新选一张"
        )
    declared = attachments.declared_mime(row.mime or "")
    if declared not in set(attachments.IMAGE_MIME_BY_EXTENSION.values()):
        raise GreetingImageError(
            f"「{row.original_name or row.disk_name}」不是图片，不能作为招呼语配图"
        )
    return row


def _read_copy(db: Session, row: UserFile) -> bytes:
    path = user_files_dir(db.get_bind()) / row.disk_name
    try:
        return path.read_bytes()
    except OSError as exc:
        raise GreetingImageError(
            f"「{row.original_name or row.disk_name}」的磁盘副本读不出来"
            f"（{exc.strerror or exc.__class__.__name__}），"
            "请到「我的文件」里确认它还在，或换一张图"
        ) from exc


def _prepare_bytes(row: UserFile, content: bytes) -> tuple[bytes, str]:
    """校验并（必要时）转码一张图，返回 ``(字节, MIME)``。

    复用 ``attachments`` 的白名单 / 魔数判定与 ``image_conversion`` 的转码降采样——**不**
    在这里另写一份体积与格式规则：两份规则迟早会漂移，而漂移的后果是"界面允许、发不出去"。
    """
    name = row.original_name or row.disk_name
    mime = attachments.declared_mime(row.mime or "")
    if not attachments.image_signature_matches(mime, content):
        # 名字/MIME 说谎在现实里很常见（CDN 按 Accept 返回 WebP，另存下来仍是 .jpeg）。
        # 以内容为准：认得出真实格式就按它发；认不出才拒绝。
        detected = attachments.image_mime_of_content(content)
        if detected is None:
            raise GreetingImageError(str(attachments.format_mismatch_error(name, content)))
        mime = detected

    # 体积判定必须**在**转码之前，与 ``attachments.normalize_image_attachment`` 逐条同序：
    # 超限就是超限，不给它"降采样到能发"的机会。「超 2 MB 自动压小」表面上更好用，实际是
    # 绕开了用户自己设定的体积上限——用户压到 1.9 MB 是为了让招聘方那边加载得动，我们悄悄
    # 发一张被重编码过、画质更差、体积仍接近上限的图，等于替他改了主意（台账第 10 条明令
    # 不许为"能发"绕开 attachments 的限制）。只有 bmp/tiff 走转码——那是**格式**不受支持，
    # 不是尺寸超标，转码本身就该做，转完再看体积。
    if len(content) > attachments.MAX_ATTACHMENT_BYTES:
        raise GreetingImageError(f"「{name}」不能超过 2 MB，请先裁剪或压缩后再选")
    if mime in attachments.TRANSCODED_IMAGE_MIMES:
        from ..image_conversion import convert_to_supported_image

        try:
            content, mime = convert_to_supported_image(content, attachments.MAX_ATTACHMENT_BYTES)
        except ValueError as exc:
            raise GreetingImageError(f"「{name}」{exc}") from exc

    if len(content) > attachments.MAX_ATTACHMENT_BYTES:
        # 转码（含降采样阶梯）之后仍然超限：此时已经尽力，如实拒绝。
        raise GreetingImageError(f"「{name}」不能超过 2 MB，请先裁剪或压缩后再选")
    extension = _EXTENSION_BY_MIME.get(mime)
    if extension is None:
        raise GreetingImageError(f"「{name}」的格式不受支持：只支持 png/jpg/webp/gif 图片")
    return content, mime


def _assert_budget(*, count: int, total_bytes: int) -> None:
    """把 ``attachments`` 的额度判定翻成 :class:`GreetingImageError`。

    额度本身**不在本模块重写**（单张 2 MB / 合计 5 MB / 最多 4 张只有 ``attachments``
    一份权威定义）；这里只换错误类型：``attachments`` 抛的是 ``ValueError``，而调用方
    （``task_apply._upload_greeting_images``）按 ``GreetingImageError`` 收口成"本地拒绝、
    记 skipped"。不换的话它会落到兜底 ``except Exception``，用户看到的是一句
    "内部错误"，而他真正需要知道的是"一次最多 4 张"。
    """
    try:
        attachments.assert_attachment_budget(count=count, total_bytes=total_bytes, word="图片")
    except ValueError as exc:
        raise GreetingImageError(str(exc)) from exc


def stage_greeting_images(db: Session, image_ids: Sequence[Any]) -> Staging:
    """把要发的图落到一个临时目录，并返回 :class:`Staging`。

    校验是**全或全无**：任何一张不合格就抛 :class:`GreetingImageError`，并立刻删掉已经
    建好的临时目录（不留下半份文件，也没有"发了三张"这种事）。
    """
    ids = normalize_image_ids(image_ids)
    if not ids:
        raise GreetingImageError("没有可发送的图片")
    _assert_budget(count=len(ids), total_bytes=0)

    directory = Path(tempfile.mkdtemp(prefix=TEMP_DIR_PREFIX))
    staging = Staging(directory=directory)
    total = 0
    try:
        for index, file_id in enumerate(ids, start=1):
            row = _require_image_row(db, file_id)
            content, mime = _prepare_bytes(row, _read_copy(db, row))
            total += len(content)
            _assert_budget(count=len(ids), total_bytes=total)
            path = directory / f"{index:02d}-{row.sha256[:8]}{_EXTENSION_BY_MIME[mime]}"
            path.write_bytes(content)
            staging.images.append(
                StagedImage(
                    file_id=int(file_id),
                    name=row.original_name or row.disk_name,
                    mime=mime,
                    size_bytes=len(content),
                    path=path,
                )
            )
    except BaseException:
        # 中途任何一步失败（含用户停止信号）：整目录删掉再抛，调用方拿不到"半份图"。
        staging.cleanup()
        raise
    return staging


# ===== 审计 =====


def record_image_result(
    session: Session,
    item: ApplyTaskItem,
    *,
    status: str,
    detail: str = "",
    file_ids: Sequence[int] | None = None,
    target: str = IMAGE_TARGET_GREETING_IMAGE,
) -> None:
    """把一次发图的结果写进记录行并留一行日志。

    审计四要素：``queue_item_id``（记录行上的列）+ ``file_id``（``image_file_ids``）+
    结果（``image_status`` / ``image_target``）+ 时间（``image_finished_at``）。日志里
    **不写文件名**：文件名常常就是"张三-简历截图.png"，落进日志等于把个人信息抄了一份。
    """
    item.image_status = status
    item.image_target = target if status else ""
    item.image_detail = detail
    item.image_file_ids = [int(value) for value in (file_ids or [])]
    item.image_finished_at = utcnow()
    session.commit()
    logger.info(
        "招呼语配图：queue_item_id=%s task_item_id=%s target=%s file_ids=%s result=%s",
        item.queue_item_id,
        item.id,
        item.image_target,
        item.image_file_ids,
        status,
    )


def image_options(db: Session, *, limit: int = 200) -> list[dict[str, Any]]:
    """可选的图片清单（"我的文件"里的图片副本，最新在前）。

    只读 ``user_file`` 的元信息，**不读盘**：设置页只需要缩略信息，而按需读盘会让一次
    打开设置弹窗变成 N 次文件 IO。真正的字节在发图时才读（见 ``stage_greeting_images``）。
    """
    rows = (
        db.query(UserFile)
        .filter(UserFile.mime.like("image/%"))
        .order_by(UserFile.id.desc())
        .limit(max(1, int(limit)))
        .all()
    )
    return [
        {
            "id": int(row.id),
            "name": row.original_name or row.disk_name,
            "size_bytes": int(row.size or 0),
        }
        for row in rows
    ]


__all__ = [
    "KEY_GREETING_IMAGE_ENABLED",
    "KEY_GREETING_IMAGE_ID",
    "TEMP_DIR_PREFIX",
    "GreetingImageError",
    "GreetingImageSetting",
    "StagedImage",
    "Staging",
    "get_greeting_image_setting",
    "image_options",
    "normalize_image_ids",
    "record_image_result",
    "resolve_image_ids",
    "save_greeting_image_setting",
    "stage_greeting_images",
]
