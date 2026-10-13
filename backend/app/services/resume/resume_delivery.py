"""投递快照服务（RF-17 / PR-09 可信交付账本）：把"哪一版简历投给了谁"冻结成不可变证据。

职责只有一件事：:func:`freeze_delivery` 把一份简历在投递/显式关联/导出那一刻的
内容与渲染配置复制进 ``resume_delivery_record``。简历记录本身保持**原地更新**
语义（PUT/revise 直接改 ``content``），所以投递之后的润色改的是正经历程里的
"当前版"，而证据是这份快照——哈希不变，血缘可查。

三条触发路径（source 取值见 ``models.resume_delivery``）：

- ``apply``：投递台成功回写（``task_apply`` → ``tracker.record_applied``）；
- ``track``：进度表单/接口显式把一条进度关联到一份简历；
- ``export``：导出时显式要求落交付快照（``?record_delivery=true``——GET 旧语义，
  新调用方走 ``POST /export``，见 ADR-0002）。

目的地快照（PR-09）：``company`` / ``job_title`` 来自**实际投递目标**（track 记录或
``record_applied`` 的实参），不再从原简历反推——通用简历（无公司）投给 A 公司时，
快照目的地就是 A 公司。

双指纹（PR-09 拆分）：

- ``source_content_sha256``：导出前（脱敏后）源内容的规范化哈希——存档里是哪份内容；
- ``artifact_sha256``：导出产物字节的 sha256——产出的文件是哪份。
  旧列 ``content_sha256`` 语义不变（apply/track = 内容哈希；export = 产物哈希），
  与响应头 ``X-Content-Sha256`` 逐字一致的契约由既有测试钉住。

幂等（PR-09）：``idempotency_key`` 代表"哪一次真实投递动作"——apply 用任务条目 ID，
export 用产物哈希。同键重放**不重复记账**：:func:`freeze_delivery` 查到已有行时
原样返回，不插新行。

渲染上下文与导出路由走**同一条解析路径**（``record_format_config`` +
``resolve_style_template`` / ``resolve_style_config``），不复制逻辑；指纹优先复用
``export_pipeline.render_config_fingerprint``，保证与 ``ExportDelivery`` 同口径。
"""

from __future__ import annotations

import hashlib
import json

from sqlalchemy.orm import Session

from ...models.resume import ResumeRecord
from ...models.resume_delivery import ResumeDeliveryRecord
from ..export_pipeline import (
    ExportArtifact,
    ExportRequest,
    RenderContext,
    build_export,
    render_config_fingerprint,
)
from .resume_record import record_format_config
from .resume_template_store import resolve_style_config, resolve_style_template


def _canonical_json(payload) -> str:
    """稳定序列化：排序键 + 紧凑分隔符，同一份内容永远得到同一个哈希。"""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def canonical_content_sha256(content: dict) -> str:
    """简历内容快照的规范化 sha256（apply/track 路径的内容指纹；export 路径的源内容指纹）。"""
    return hashlib.sha256(_canonical_json(content or {}).encode("utf-8")).hexdigest()


def default_render_context(db: Session, record: ResumeRecord) -> dict:
    """从简历记录解析出的渲染上下文（apply/track 路径的存档口径，与旧行为一致）。"""
    export_template, export_html = resolve_style_template(db, record.template)
    return {
        "template": export_template,
        "template_html": export_html,
        "style_config": resolve_style_config(db, record.template) or {},
        "format_config": record_format_config(db, record) or {},
        "page_limit": record.page_limit or 1,
        "font_scale": record.font_scale or "standard",
    }


def freeze_delivery(
    db: Session,
    *,
    record: ResumeRecord,
    source: str,
    track_id: int | None = None,
    export_format: str = "",
    filename: str = "",
    pages: int | None = None,
    content_sha256: str | None = None,
    rendered_config_sha256: str | None = None,
    company: str | None = None,
    job_title: str | None = None,
    content: dict | None = None,
    render_context: dict | None = None,
    request_params: dict | None = None,
    source_content_sha256: str | None = None,
    artifact_sha256: str | None = None,
    idempotency_key: str | None = None,
) -> ResumeDeliveryRecord | None:
    """冻结一份简历的投递快照并落库；**不提交**——由调用方决定事务边界。

    覆盖参数（PR-09，None 表示沿用旧行为）：

    - ``company`` / ``job_title``：实际投递目标（track 记录 / record_applied 实参）。
      不传时回退简历记录上的冗余字段（旧行为，仅为兼容）；
    - ``content``：要冻结的内容（脱敏导出传脱敏后内容，保证存档与下载产物同源）；
    - ``render_context``：实际生效的渲染上下文（导出路径传生效后的版式，修复
      "请求 page_limit=2 存档却是 1"的错位）；
    - ``request_params`` / ``source_content_sha256`` / ``artifact_sha256``：可信
      交付账本的新列，见模块 docstring；
    - ``idempotency_key``：同键重放不重复记账——查到已有行时**原样返回**（调用方
      不该把返回值当"新行"再断言数量）。

    ``content_sha256`` / ``rendered_config_sha256`` 缺省时自行计算：

    - 内容指纹对规范化 JSON 的 sha256（apply/track 路径没有导出产物可指）；
    - 配置指纹用 :func:`render_config_fingerprint` 按"默认导出请求 + 解析出的
      渲染上下文"计算——与 ``ExportDelivery`` 同一个函数，同口径可比对。

    export 路径请把 ``build_export_delivery`` 产出的哈希原样传入，让
    ``X-Content-Sha256`` / ``X-Render-Config-Sha256`` 响应头与库里的证据逐字一致。
    """
    if idempotency_key is not None:
        existing = (
            db.query(ResumeDeliveryRecord)
            .filter(ResumeDeliveryRecord.idempotency_key == idempotency_key)
            .first()
        )
        if existing is not None:
            # 同一次真实动作的重放：证据已经在了，不重复记账。
            return existing
    frozen_content = dict(content) if content is not None else dict(record.content or {})
    effective_render_context = (
        dict(render_context) if render_context is not None else default_render_context(db, record)
    )
    fingerprint_request = ExportRequest(format=export_format or "pdf")
    context = RenderContext(
        template=effective_render_context.get("template", "classic"),
        template_html=effective_render_context.get("template_html", ""),
        style_config=effective_render_context.get("style_config") or {},
        page_limit=effective_render_context.get("page_limit") or 1,
        font_scale=effective_render_context.get("font_scale") or "standard",
        format_config=effective_render_context.get("format_config") or {},
    )
    delivery = ResumeDeliveryRecord(
        resume_id=record.id,
        job_id=record.job_id,
        track_id=track_id,
        source=source,
        resume_title=record.title or "",
        # 目的地快照：显式传入的实际投递目标优先，不从原简历反推。
        job_title=record.job_title if job_title is None else job_title,
        company=record.company if company is None else company,
        content=frozen_content,
        render_context=effective_render_context,
        content_sha256=content_sha256
        or hashlib.sha256(_canonical_json(frozen_content).encode("utf-8")).hexdigest(),
        rendered_config_sha256=rendered_config_sha256
        or render_config_fingerprint(fingerprint_request, context),
        export_format=export_format,
        filename=filename,
        pages=pages,
        model=record.model or "",
        source_content_sha256=source_content_sha256
        if source_content_sha256 is not None
        else canonical_content_sha256(frozen_content),
        artifact_sha256=artifact_sha256,
        request_params=request_params,
        idempotency_key=idempotency_key,
    )
    db.add(delivery)
    db.flush()
    return delivery


def list_deliveries(db: Session, resume_id: int) -> list[ResumeDeliveryRecord]:
    """一份简历的全部交付记录（新→旧）。证据不可删，不过滤任何行。"""
    return (
        db.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.resume_id == resume_id)
        .order_by(ResumeDeliveryRecord.created_at.desc(), ResumeDeliveryRecord.id.desc())
        .all()
    )


def get_delivery(db: Session, delivery_id: int) -> ResumeDeliveryRecord | None:
    """按 id 取一条交付快照：**不要求原简历存活**（外键早已 SET NULL，证据仍可读）。"""
    return db.get(ResumeDeliveryRecord, delivery_id)


def list_track_deliveries(db: Session, track_id: int) -> list[ResumeDeliveryRecord]:
    """一条进度记录的全部交付快照（新→旧）：从岗位/进度进入对应 delivery 的入口。"""
    return (
        db.query(ResumeDeliveryRecord)
        .filter(ResumeDeliveryRecord.track_id == track_id)
        .order_by(ResumeDeliveryRecord.created_at.desc(), ResumeDeliveryRecord.id.desc())
        .all()
    )


def replay_delivery_export(delivery: ResumeDeliveryRecord) -> ExportArtifact:
    """从快照重放导出：存档内容 + render_context + 实际生效的请求参数 → 导出产物。

    只对 ``export_format`` 非空的快照有意义（apply/track 快照没有导出请求，调用方
    应走内容下载）。旧快照缺 ``request_params`` 时抛 ``ValueError``——那是"不可还原"，
    不该假装能重放出同一份文件。水印由 :func:`build_export` 内部按存档参数补涂，
    产物字节与当时一致（同内容 + 同参数的确定性渲染）。
    """
    params = delivery.request_params or {}
    if not delivery.export_format or not params:
        raise ValueError("该快照没有可重放的导出请求参数（旧存档不可还原）")
    context_data = delivery.render_context or {}
    context = RenderContext(
        template=context_data.get("template", "classic"),
        template_html=context_data.get("template_html", ""),
        style_config=context_data.get("style_config") or {},
        page_limit=context_data.get("page_limit") or 1,
        font_scale=context_data.get("font_scale") or "standard",
        format_config=context_data.get("format_config") or {},
        margin_mm=params.get("margin_mm"),
        include_photo=bool(params.get("include_photo", True)),
    )
    from ...schemas.resume import ResumeContent

    resume = ResumeContent.model_validate(delivery.content)
    # 重放不做脱敏：存档 content 已经是"实际导出用的那一份"（脱敏导出存脱敏内容），
    # 再脱敏一次会双重遮罩。请求参数里的 redact 仅作存档备查。
    return build_export(
        ExportRequest(
            format=params.get("format") or delivery.export_format,
            watermark=params.get("watermark", ""),
            redact=False,
            margin_mm=params.get("margin_mm"),
            font_scale=params.get("font_scale"),
            page_limit=params.get("page_limit"),
            include_photo=bool(params.get("include_photo", True)),
        ),
        resume,
        context,
    )


__all__ = [
    "canonical_content_sha256",
    "default_render_context",
    "freeze_delivery",
    "get_delivery",
    "list_deliveries",
    "list_track_deliveries",
    "replay_delivery_export",
]
