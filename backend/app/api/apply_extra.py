# SPDX-License-Identifier: Apache-2.0
"""投递台补强端点（#14）：体检、漏斗、跟进、话术库、屏蔽清单。

**为什么单独成文件**：``api/apply.py`` 的行数预算只剩个位数余量（493/500），而本批要
新增 8 个端点。这里用 :func:`register_apply_extra_routes` 挂进同一个 ``/api/apply``
路由树——``apply.py`` 因此只多了「一行 import + 一行注册」。

端点清单（**前端只用这些，不要在本模块偷偷加**）：

============================  ==========================================
``POST /queue/preflight``     投递前体检（只读）
``GET  /summary``             最近 N 天执行量 + 在面快照
``GET  /records/stale``       投递 ≥N 天仍无回音的记录
``POST /records/{id}/track``  一键写进求职进度（先查重）
``GET  /greeting-templates``  话术库
``PUT  /greeting-templates``  整表覆盖话术库
``POST /greeting-templates/{id}/use``  套用次数 +N（增量）
``GET  /blocklist``           屏蔽清单（含不会生效的关键词）
``PUT  /blocklist``           整表覆盖屏蔽清单
``POST /greeting-image/upload``  配图就地上传（CR-18，按 sha 去重）
``DELETE /greeting-image/{id}``  删一张未被引用的配图（仍被引用 → 409）
============================  ==========================================

路由顺序：``/records/stale``（字面量段）与 ``/queue/preflight``（字面量段）都在本模块内
先于任何参数段注册；父子路由的相对顺序见 ``api/apply.py`` 的 include 顺序。
"""

from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from ..database import get_db
from ..models.user_file import UserFile
from ..runtime.blocking import run_sync
from ..schemas.apply import (
    ApplyBlocklistIn,
    ApplyBlocklistOut,
    ApplyGreetingImageIn,
    ApplyGreetingImageOption,
    ApplyGreetingImageOut,
    ApplyPreflightIn,
    ApplyPreflightOut,
    ApplyStaleListOut,
    ApplySummaryOut,
    ApplyTrackLinkOut,
    GreetingTemplateListOut,
    GreetingTemplateOut,
    GreetingTemplateSaveIn,
    GreetingTemplateUseIn,
)
from ..services.apply import funnel, greeting_templates, preflight
from ..services.apply._base import ApplyServiceError
from ..services.apply.blocklist import inactive_keywords
from ..services.apply.greeting_image import (
    GreetingImageError,
    collect_reference_candidates,
    get_greeting_image_setting,
    image_options,
    save_greeting_image_setting,
)
from ..services.attachments import (
    MAX_ATTACHMENT_BYTES,
    MAX_ATTACHMENT_COUNT,
    MAX_ATTACHMENTS_TOTAL_BYTES,
    image_mime_of_content,
    safe_attachment_name,
)
from ..services.settings_service import get_apply_blocklist, save_apply_blocklist
from ..services.user_files import delete_user_file, save_from_bytes
from .apply_insights import register_apply_insight_routes

extra_router = APIRouter(tags=["apply"])


def _raise(exc: ApplyServiceError) -> None:
    """与 ``api/apply.py`` 同口径：服务层异常统一翻成 ``HTTPException``。"""
    raise HTTPException(status_code=exc.status_code, detail=exc.detail)


# ===== 14A 投递前体检 =====


@extra_router.post("/queue/preflight", response_model=ApplyPreflightOut)
def queue_preflight(payload: ApplyPreflightIn | None = None, db: Session = Depends(get_db)):
    """检查队列（或点名的几条）现在投出去会不会白投。**只读**，不改任何状态。

    请求体可省略（= 整个队列），因为前端在点「开始投递」时会自动跑一次。
    """
    queue_ids = payload.queue_ids if payload is not None else None
    return preflight.preflight(db, queue_ids)


# ===== 14F 顶部漏斗条 =====


@extra_router.get("/summary", response_model=ApplySummaryOut)
def apply_summary(
    days: int = Query(default=funnel.DEFAULT_DAYS, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """最近 ``days`` 天的执行量（成功/失败/合计）与"现在几个在面"。

    与 ``/api/analytics`` 的分工：那边算**长期转化率**（面试率/Offer 率/渠道），这里只算
    **最近 N 天的执行量**。两个口径不许互相覆盖。
    """
    return funnel.summary(db, days)


# ===== 14C 跟进闭环 =====


@extra_router.get("/records/stale", response_model=ApplyStaleListOut)
def stale_records(
    days: int = Query(default=funnel.DEFAULT_DAYS, ge=1, le=90),
    db: Session = Depends(get_db),
):
    """投出去 ≥``days`` 天、进度仍停在「已投递 / 筛选中」的记录（静默提醒用）。"""
    return funnel.stale_records(db, days)


@extra_router.post("/records/{record_id}/track", response_model=ApplyTrackLinkOut)
def link_record_track(record_id: int, db: Session = Depends(get_db)):
    """把这条投递记录写进求职进度；**已存在则返回已有的那条**（``created=false``）。

    查重键：先按 ``job_id``，再按 ``(company_key, title_key)`` 兜底——同一家公司同一个
    岗位的多次投递归一条进度，否则漏斗会被"点了两次"污染。
    """
    try:
        return funnel.link_track(db, record_id)
    except ApplyServiceError as exc:
        _raise(exc)


# ===== 14D 话术库 =====


@extra_router.get("/greeting-templates", response_model=GreetingTemplateListOut)
def list_greeting_templates(db: Session = Depends(get_db)):
    """话术库（``AppSetting`` 里的 JSON 数组，零迁移）。"""
    return greeting_templates.list_templates(db)


@extra_router.put("/greeting-templates", response_model=GreetingTemplateListOut)
def save_greeting_templates(payload: GreetingTemplateSaveIn, db: Session = Depends(get_db)):
    """整表覆盖。``uses`` 省略时保留原计数——编辑正文不该把"用过几次"清零。"""
    return greeting_templates.save_templates(db, payload)


@extra_router.post("/greeting-templates/{template_id}/use", response_model=GreetingTemplateOut)
def use_greeting_template(
    template_id: str,
    payload: GreetingTemplateUseIn | None = None,
    db: Session = Depends(get_db),
):
    """套用一次（或批量套用 N 次）：**增量**累加 ``uses``，返回更新后的那一条。

    ``count`` 省略 = 1；批量套用一次请求带 N，不打 N 次库。模板不存在返回 404——
    静默新建一条空模板会让"用过几次"变成一笔无处对账的账。
    """
    try:
        return greeting_templates.mark_used(
            db, template_id, payload.count if payload is not None else 1
        )
    except ApplyServiceError as exc:
        _raise(exc)


# ===== 14E 屏蔽清单 =====


@extra_router.get("/blocklist", response_model=ApplyBlocklistOut)
def get_blocklist(db: Session = Depends(get_db)):
    """当前屏蔽清单。返回的是**用户填的原话**（不做归一化、不丢停用词），所见即所存。

    ``inactive_keywords`` 是同一份规则判出的"存着但不会生效"的那些词（太短或太宽泛）。
    它由 ``clean_keywords`` 的判定函数算出，这里不复制停用词表。
    """
    stored = get_apply_blocklist(db)
    keywords = stored.get("keywords", [])
    return ApplyBlocklistOut(
        companies=stored.get("companies", []),
        keywords=keywords,
        inactive_keywords=inactive_keywords(keywords),
    )


@extra_router.put("/blocklist", response_model=ApplyBlocklistOut)
def save_blocklist(payload: ApplyBlocklistIn, db: Session = Depends(get_db)):
    """整表覆盖屏蔽清单。

    停用词（城市 / 用工性质 / 泛化词）**不在这里拦**：它们只是不参与匹配，仍然原样存下来，
    界面才能如实显示"这条你填了，但它太宽泛、不会生效"。静默丢弃会让用户以为保存失败。
    """
    saved = save_apply_blocklist(db, payload.companies, payload.keywords)
    keywords = saved["keywords"]
    return ApplyBlocklistOut(
        companies=saved["companies"],
        keywords=keywords,
        inactive_keywords=inactive_keywords(keywords),
    )


# ===== T8 招呼语配图 =====

# CR-18：配图只接受这四种（与 ``greeting_image._EXTENSION_BY_MIME`` 同一份白名单）。
# 判两道：先看扩展名在不在白名单里，再按内容验魔数——后缀对、内容是别的格式的图，
# 站点那边会静默失败，用户只会看到"投递成功但图片没送到"。
_GREETING_UPLOAD_EXTENSIONS = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".jpe": "image/jpeg",
    ".jfif": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
}


def _greeting_reference_labels(db: Session) -> dict[int, list[str]]:
    """一次扫完三处引用：全局默认、投递队列行、投递审计。

    返回 ``{file_id: [引用位置, ...]}``。GET 用它给每个选项算 ``deletable``，DELETE 用它
    解释 409 的原因——两处共用同一份判定，避免"界面说能删、接口 409"。
    """
    labels: dict[int, list[str]] = {}

    def add(value: object, place: str) -> None:
        try:
            file_id = int(value)  # type: ignore[arg-type]
        except (TypeError, ValueError):
            return  # 脏 JSON 不该让整块设置读不出来
        labels.setdefault(file_id, []).append(place)

    setting = get_greeting_image_setting(db)
    for value, place in collect_reference_candidates(db, setting.image_id):
        add(value, place)
    return {file_id: sorted(set(places)) for file_id, places in labels.items()}


def _store_greeting_upload(
    db: Session, raw: bytes, name: str, mime: str
) -> tuple[int | None, UserFile | None, dict[int, list[str]]]:
    """落盘 + 取行 + 算引用：**同步工作单元**，由 async 端点经 ``run_sync`` 调用。

    为什么整段打包：``save_from_bytes`` / ``db.get`` / ``_greeting_reference_labels``
    都是同步 IO，逐个 ``run_sync`` 只会把同一段逻辑切碎；打包成一次线程池调用既满足
    ``test_async_route_thread_boundary``，也避免"取完 id 再回事件循环"的中间态。
    """
    file_id = save_from_bytes(
        db,
        raw,
        original_name=name,
        mime=mime,
        source_type="apply_greeting_image",
        source_ref="upload",
    )
    if file_id is None:
        return None, None, {}
    return file_id, db.get(UserFile, file_id), _greeting_reference_labels(db)


@extra_router.post(
    "/greeting-image/upload",
    response_model=ApplyGreetingImageOption,
    status_code=201,
)
async def upload_greeting_image(
    file: UploadFile = File(...), db: Session = Depends(get_db)
) -> ApplyGreetingImageOption:
    """就地上传一张配图（队列行与设置页共用）。

    重复上传同一张图不会再建一条：``save_from_bytes`` 按 sha256 去重，回的是同一个 id。
    """
    # 多读 1 字节用来判"超限"：把整份超大文件读进内存再比，等于让上传变成内存攻击面。
    raw = await file.read(MAX_ATTACHMENT_BYTES + 1)
    if len(raw) > MAX_ATTACHMENT_BYTES:
        limit_mb = MAX_ATTACHMENT_BYTES // (1024 * 1024)
        raise HTTPException(status_code=400, detail=f"这张图片超过 {limit_mb} MB")
    name = safe_attachment_name(file.filename or "") or "greeting-image"
    expected = _GREETING_UPLOAD_EXTENSIONS.get(Path(name).suffix.lower())
    if expected is None:
        raise HTTPException(status_code=400, detail="只支持 png/jpg/webp/gif 图片")
    actual = image_mime_of_content(raw)
    if actual is None:
        raise HTTPException(
            status_code=400, detail="这个文件的内容不是图片（或格式不受支持）"
        )
    if actual != expected:
        raise HTTPException(
            status_code=400,
            detail=f"文件内容与扩展名不一致：「{name}」其实是 {actual}",
        )

    # 落盘 + 取行 + 算引用整段在 worker 线程里做，别在事件循环上等 SQLite。
    file_id, row, references = await run_sync(
        _store_greeting_upload, db, raw, name, actual
    )
    if file_id is None:
        raise HTTPException(status_code=400, detail="这个文件是空的")
    return ApplyGreetingImageOption(
        id=file_id,
        name=(row.original_name or row.disk_name) if row else name,
        size_bytes=int(row.size or len(raw)) if row else len(raw),
        # 重复上传一张正在用的图时它仍然不可删——deletable 必须按"当前引用"算。
        deletable=file_id not in references,
    )


@extra_router.delete("/greeting-image/{file_id}")
def delete_greeting_image(file_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    """删掉一张**未被引用**的配图（行 + 磁盘副本）。

    仍被引用时返回 409 并说清是哪一处：静默删掉会让投递时才发现图没了，而用户完全
    看不出是自己刚删的。
    """
    row = db.get(UserFile, file_id)
    if row is None:
        raise HTTPException(
            status_code=404, detail="这张图片已经不在了，刷新列表看看最新状态"
        )
    places = _greeting_reference_labels(db).get(int(file_id))
    if places:
        raise HTTPException(
            status_code=409,
            detail=f"这张图仍被{'、'.join(places)}引用",
        )
    delete_user_file(db, row)
    return {"ok": True}


def _greeting_image_out(db: Session) -> ApplyGreetingImageOut:
    """设置 + 可选项 + 上限一起下发（前端打开这一块只发一次请求）。

    上限来自 ``services.attachments`` 的权威常量，不在前端另写一份：两处各写一份迟早
    漂移，而漂移的表现是"界面说可以、后端拒了"。
    """
    setting = get_greeting_image_setting(db)
    references = _greeting_reference_labels(db)
    return ApplyGreetingImageOut(
        enabled=setting.enabled,
        image_id=setting.image_id,
        max_count=MAX_ATTACHMENT_COUNT,
        max_image_bytes=MAX_ATTACHMENT_BYTES,
        max_total_bytes=MAX_ATTACHMENTS_TOTAL_BYTES,
        options=[
            ApplyGreetingImageOption(**item, deletable=int(item["id"]) not in references)
            for item in image_options(db)
        ],
    )


@extra_router.get("/greeting-image", response_model=ApplyGreetingImageOut)
def get_greeting_image(db: Session = Depends(get_db)):
    """全局配图设置 + 可选图片清单（最新在前，只给元信息）。"""
    return _greeting_image_out(db)


@extra_router.put("/greeting-image", response_model=ApplyGreetingImageOut)
def save_greeting_image(payload: ApplyGreetingImageIn, db: Session = Depends(get_db)):
    """整对象覆盖全局配图设置。

    指定了不存在的图片返回 400 而不是静默存下：存下去之后失败会晚到投递那一刻，用户看到
    的是"投递成功但图片没送到"，而真正的原因（那张图已被清理）在设置页完全看不出来。
    """
    try:
        save_greeting_image_setting(db, enabled=payload.enabled, image_id=payload.image_id)
    except GreetingImageError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return _greeting_image_out(db)


def register_apply_extra_routes(router: APIRouter) -> None:
    """把本模块的端点挂到调用方的路由树（``/api/apply`` 前缀由调用方提供）。

    #15 的三个只读端点（15C/15D/15E）同批挂进来，实现与路由都在 ``apply_insights.py``：
    本文件只多一行调用，``api/apply.py`` 一行不动（它的行数预算只剩 4 行）。
    """
    router.include_router(extra_router)
    register_apply_insight_routes(router)


__all__ = ["extra_router", "register_apply_extra_routes"]
