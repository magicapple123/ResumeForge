"""投递快照服务（RF-17）：把"哪一版简历投给了谁"冻结成不可变证据。

职责只有一件事：:func:`freeze_delivery` 把一份简历在投递/显式关联/导出那一刻的
内容与渲染配置复制进 ``resume_delivery_record``。简历记录本身保持**原地更新**
语义（PUT/revise 直接改 ``content``），所以投递之后的润色改的是正经历程里的
"当前版"，而证据是这份快照——哈希不变，血缘可查。

三条触发路径（source 取值见 ``models.resume_delivery``）：

- ``apply``：投递台成功回写（``task_apply`` → ``tracker.record_applied``）；
- ``track``：进度表单/接口显式把一条进度关联到一份简历；
- ``export``：导出时显式要求落交付快照（``?record_delivery=true``，默认不落——
  预览导出零膨胀）。

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
from ..export_pipeline import ExportRequest, RenderContext, render_config_fingerprint
from .resume_record import record_format_config
from .resume_template_store import resolve_style_config, resolve_style_template


def _canonical_json(payload) -> str:
    """稳定序列化：排序键 + 紧凑分隔符，同一份内容永远得到同一个哈希。"""
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


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
) -> ResumeDeliveryRecord:
    """冻结一份简历的投递快照并落库；**不提交**——由调用方决定事务边界。

    ``content_sha256`` / ``rendered_config_sha256`` 缺省时自行计算：

    - 内容指纹对规范化 JSON 的 sha256（apply/track 路径没有导出产物可指）；
    - 配置指纹用 :func:`render_config_fingerprint` 按"默认导出请求 + 解析出的
      渲染上下文"计算——与 ``ExportDelivery`` 同一个函数，同口径可比对。

    export 路径请把 ``build_export_delivery`` 产出的两个哈希原样传入，让
    ``X-Content-Sha256`` / ``X-Render-Config-Sha256`` 响应头与库里的证据逐字一致。
    """
    export_template, export_html = resolve_style_template(db, record.template)
    context = RenderContext(
        template=export_template,
        template_html=export_html,
        style_config=resolve_style_config(db, record.template),
        page_limit=record.page_limit or 1,
        font_scale=record.font_scale or "standard",
        format_config=record_format_config(db, record),
    )
    fingerprint_request = ExportRequest(format=export_format or "pdf")
    delivery = ResumeDeliveryRecord(
        resume_id=record.id,
        job_id=record.job_id,
        track_id=track_id,
        source=source,
        resume_title=record.title or "",
        job_title=record.job_title or "",
        company=record.company or "",
        content=dict(record.content or {}),
        render_context={
            "template": context.template,
            "template_html": context.template_html,
            "style_config": context.style_config or {},
            "format_config": context.format_config or {},
            "page_limit": context.page_limit,
            "font_scale": context.font_scale,
        },
        content_sha256=content_sha256
        or hashlib.sha256(_canonical_json(record.content or {}).encode("utf-8")).hexdigest(),
        rendered_config_sha256=rendered_config_sha256
        or render_config_fingerprint(fingerprint_request, context),
        export_format=export_format,
        filename=filename,
        pages=pages,
        model=record.model or "",
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


__all__ = ["freeze_delivery", "list_deliveries"]
