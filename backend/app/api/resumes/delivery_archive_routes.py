# SPDX-License-Identifier: Apache-2.0
"""交付证据只读端点：历史交付档案列表 + 单份简历的交付摘要 + 快照详情/下载。

从 crud_routes.py 等价搬入（F4-BE 拆分，2026-10-25）：列表/详情/下载都不写库、只读
交付快照，与"简历 CRUD"不是同一职责；搬出后 crud_routes 保住 400 行预算。**行为逐字
节不变**（路径、404 口径、响应头哈希规则、内容存档 JSON 都原样照搬）。

**路由顺序不变量**：本 router 在 __init__.py 里先于 crud router include，因此
/api/resumes/deliveries 与 /api/resumes/{resume_id}/deliveries 都在
GET /api/resumes/{resume_id} 之前注册；字面量 /deliveries 不会被当成 resume_id。
"""

import hashlib
import json
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from sqlalchemy import or_
from sqlalchemy.orm import Session, load_only

from ...database import get_db
from ...models.resume import ResumeRecord
from ...models.resume_delivery import ResumeDeliveryRecord
from ...schemas.common import Page
from ...schemas.resume import DeliveryDetail, DeliverySummary
from ...services import trash
from ...services.resume.resume_delivery import (
    get_delivery,
    list_deliveries,
    replay_delivery_export,
)
from ...services.search_matching import LIKE_ESCAPE, like_pattern

router = APIRouter()


@router.get("/deliveries", response_model=Page[DeliverySummary])
def list_delivery_archive(
    keyword: str = Query(default="", max_length=200),
    source: Literal["", "apply", "track", "export"] = "",
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=100),
    db: Session = Depends(get_db),
):
    query = db.query(ResumeDeliveryRecord)
    if source:
        query = query.filter(ResumeDeliveryRecord.source == source)
    if keyword:
        pattern = like_pattern(keyword)
        query = query.filter(
            or_(
                *(
                    column.like(pattern, escape=LIKE_ESCAPE)
                    for column in (
                        ResumeDeliveryRecord.resume_title,
                        ResumeDeliveryRecord.company,
                        ResumeDeliveryRecord.job_title,
                    )
                )
            )
        )
    total = query.count()
    fields = [getattr(ResumeDeliveryRecord, name) for name in DeliverySummary.model_fields]
    rows = (
        query.options(load_only(*fields))
        .order_by(ResumeDeliveryRecord.created_at.desc(), ResumeDeliveryRecord.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    return Page(items=[DeliverySummary.model_validate(row) for row in rows], total=total)

@router.get("/{resume_id}/deliveries", response_model=list[DeliverySummary])
def list_resume_deliveries(resume_id: int, db: Session = Depends(get_db)):
    """一份简历的交付记录摘要（RF-17）：这一版投给了谁、什么时候、指纹是什么。

    只返回摘要（不含 ``content`` 全文，见 ``DeliverySummary``）；简历不存在/已删
    时 404，与详情接口同一口径。证据不可删，列表不过滤任何行。
    """
    record = db.get(ResumeRecord, resume_id)
    if record is None or trash.is_deleted(record):
        raise HTTPException(status_code=404, detail="简历记录不存在或已被删除")
    return [DeliverySummary.model_validate(item) for item in list_deliveries(db, resume_id)]


def _delivery_detail(item) -> DeliveryDetail:
    """ORM 快照 → 详情响应：replayable 与 destination_recorded 是派生结论，不落库。"""
    detail = DeliveryDetail.model_validate(item)
    detail.replayable = bool(item.export_format) and bool(item.request_params)
    detail.destination_recorded = bool(item.company) or bool(item.job_title)
    return detail


@router.get("/deliveries/{delivery_id}", response_model=DeliveryDetail)
def get_delivery_detail(delivery_id: int, db: Session = Depends(get_db)):
    """一条交付记录的详情（PR-09）：**不依赖原简历存活**的独立访问入口。

    旧入口 ``/resumes/{id}/deliveries`` 要求原简历记录存活；而快照外键 SET NULL 后
    数据库证据还在——删了简历却查不到证据是业务上的不可达。本端点按快照 id 直接
    取，原简历/岗位/进度是否被删都不影响读取。旧快照缺新列时如实返回
    ``request_params=None`` / ``destination_recorded=False``，前端标注「不可还原」。
    """
    item = get_delivery(db, delivery_id)
    if item is None:
        raise HTTPException(status_code=404, detail="交付记录不存在")
    return _delivery_detail(item)


@router.get("/deliveries/{delivery_id}/download")
def download_delivery(delivery_id: int, db: Session = Depends(get_db)):
    """从交付快照下载（PR-09）：原简历删除后产物仍可取，证据可达才有意义。

    - ``export`` 快照：凭存档内容 + render_context + 实际生效的请求参数**重放导出**
      （同内容同参数的确定性渲染；脱敏存档不再二次脱敏）。旧快照没有请求参数时
      409「不可还原」——不假装能重放出同一份文件。
    - ``apply``/``track`` 快照：没有导出产物，返回冻结的内容 JSON（当时那份简历正文）。

    **哈希口径（RR-04）**：``X-Content-Sha256`` 永远是**本次响应真实字节**的 sha256
    （用户拿到文件后自己算一遍就能对上）。历史指纹另开响应头：

    - ``X-Artifact-Sha256``：当初导出时产物的 sha256（``artifact_sha256`` 列）；
    - ``X-Source-Content-Sha256``：apply/track 存档里冻结**内容**的规范化 sha256；
    - ``X-Delivery-Replay: true``：这份字节是**重新生成**的，不保证与当初下载的
      源文件逐字节相同——HTML 每次渲染都换 CSP nonce，PDF 还可能带时间戳。要判断
      "是否与原件一致"，把 ``X-Content-Sha256`` 与 ``X-Artifact-Sha256`` 比一下即可。
    """
    item = get_delivery(db, delivery_id)
    if item is None:
        raise HTTPException(status_code=404, detail="交付记录不存在")
    if item.export_format:
        try:
            artifact = replay_delivery_export(item)
        except ValueError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc
        except Exception as exc:  # noqa: BLE001 - 重放失败要给可解释的响应而不是 500 堆栈
            raise HTTPException(status_code=409, detail=f"从存档重放导出失败：{exc}") from exc
        headers = {
            "Content-Disposition": (
                f"attachment; filename*=UTF-8''{quote(artifact.filename, safe='')}"
            ),
            # 实际本次字节的哈希：以前这里放的是**存档里**的旧产物哈希，HTML 重放
            # 每次 nonce 不同，用户永远核对不上。
            "X-Content-Sha256": hashlib.sha256(artifact.content).hexdigest(),
            "X-Delivery-Replay": "true",
        }
        original = item.artifact_sha256 or item.content_sha256
        if original:
            headers["X-Artifact-Sha256"] = original
        return Response(artifact.content, media_type=artifact.media_type, headers=headers)
    content = json.dumps(
        {
            "说明": "投递快照的内容存档（apply/track 路径没有导出产物，这是冻结的简历正文）",
            "resume_title": item.resume_title,
            "company": item.company,
            "job_title": item.job_title,
            "content": item.content,
        },
        ensure_ascii=False,
        indent=2,
    ).encode("utf-8")
    filename = f"{item.resume_title or 'delivery'}-{item.id}.json"
    headers = {
        "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename, safe='')}",
        # 返回的是**封装后的 JSON 字节**，哈希就按这些字节算。
        "X-Content-Sha256": hashlib.sha256(content).hexdigest(),
    }
    source_hash = item.source_content_sha256 or item.content_sha256
    if source_hash:
        headers["X-Source-Content-Sha256"] = source_hash
    return Response(content, media_type="application/json; charset=utf-8", headers=headers)
