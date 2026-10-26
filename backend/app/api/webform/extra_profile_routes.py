# SPDX-License-Identifier: Apache-2.0
"""字段目录、「网申资料」与记忆目标路由（职责①）。

从 ``api/webform.py`` 拆出。服务层符号一律经 ``webform_service`` 属性访问，
保证包属性 patch（``app.api.webform.webform_service.*``）继续生效。"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from starlette.concurrency import run_in_threadpool

from ...database import get_db
from ...schemas.webform import (
    WebFormExtraProfileIn,
    WebFormExtraProfileOut,
    WebFormExtraProfileParsedItem,
    WebFormExtraProfileParseIn,
    WebFormExtraProfileParseOut,
    WebFormFieldsOut,
    WebFormMemoryTargetsOut,
)
from ...services import webform as webform_service
from ...services.attachments import (
    assert_attachment_budget,
    image_data_urls,
    normalize_extraction_images,
    total_attachment_bytes,
)
from ...services.document_text import extract_documents_text
from ...services.llm import create_provider
from ...services.llm.base import LLMError
from ...services.settings_service import get_llm_config
from ...services.text_extraction import ai_failed_warning, llm_is_configured, no_model_warning
from ...services.webform.field_types import normalize_group_id, normalize_grouped_payload

router = APIRouter(prefix="/api/webform", tags=["webform"])

logger = logging.getLogger(__name__)


# ===== 字段目录 =====


@router.get("/fields", response_model=WebFormFieldsOut)
def list_fields():
    """网申字段目录。界面由它驱动渲染——加字段只改后端常量表，不用动前端。"""
    return normalize_grouped_payload(webform_service.list_fields())


# ===== 「网申资料」=====
#
# 用户专门为网申表单录的补充资料（四六级分数、档案所在地、紧急联系人、身高视力…），
# **简历里没有**，所以单独存在 ``web_form_profile_entry`` 里。
#
# **只给网申填表用**：简历生成读的是 ``UserProfile``，完全不经过这两个接口，所以
# "生成简历不读这里"是结构保证的。助手也读不到（理由见 ``test_assistant_coverage.py``）。


@router.get("/extra-profile", response_model=WebFormExtraProfileOut)
def read_extra_profile(db: Session = Depends(get_db)):
    """字段清单 + 已填的值 + 每条的来源与档位（清单由后端下发，前端不写死字段名）。"""
    return normalize_grouped_payload({
        **webform_service.list_extra_fields(db),
        "values": webform_service.extra_profile.list_entries(db),
        "details": webform_service.extra_profile.list_details(db),
        "repeated_groups": webform_service.repeated_profile.list_groups(db),
    })


@router.put("/extra-profile", response_model=WebFormExtraProfileOut)
def write_extra_profile(payload: WebFormExtraProfileIn, db: Session = Depends(get_db)):
    """整份覆盖写入。没提到的 key 会被删除——这一屏就是「网申资料」的全部。

    ``details`` 只用于给**学到的**那几条指定来源与档位（``source`` / ``reuse``）。
    """
    try:
        webform_service.extra_profile.save_entries(
            db,
            payload.values,
            details={key: entry.model_dump() for key, entry in payload.details.items()},
            commit=False,
        )
        if payload.repeated is not None:
            webform_service.repeated_profile.save_groups(
                db,
                {
                    key: [record.model_dump() for record in records]
                    for key, records in payload.repeated.items()
                },
                commit=False,
            )
        db.commit()
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception:
        db.rollback()
        raise
    return normalize_grouped_payload({
        **webform_service.list_extra_fields(db),
        "values": webform_service.extra_profile.list_entries(db),
        "details": webform_service.extra_profile.list_details(db),
        "repeated_groups": webform_service.repeated_profile.list_groups(db),
    })


@router.get("/memory-targets", response_model=WebFormMemoryTargetsOut)
def list_memory_targets(db: Session = Depends(get_db)):
    """返回「记住这条」可以写入的目标。**只有「网申资料」**（理由见 profile_targets）。"""
    return {
        "targets": [
            {**target, "group": normalize_group_id(str(target.get("group") or ""))}
            for target in webform_service.profile_targets.build_memory_targets(db)
        ]
    }


# ===== 「网申资料」粘贴识别（项 12 / D20 / D21 / D22 / D32）=====


@router.post("/extra-profile/parse-text", response_model=WebFormExtraProfileParseOut)
async def parse_extra_profile_text_draft(
    payload: WebFormExtraProfileParseIn, db: Session = Depends(get_db)
):
    """把粘贴的网申资料拆成草稿：目录内进 ``values``，目录外进 ``custom``（待用户勾选）。

    **不写库**（D20）：与简历资料侧的 ``POST /profile/parse-text`` 同语义——"点了识别"不该
    变成"改了数据"，用户此刻还没校对。写入仍然只走 ``PUT /extra-profile``（整份覆盖），
    那时用户已经在核对卡片里逐条确认过了。
    """
    try:
        images = normalize_extraction_images(payload.images)
        # PDF/DOCX 解析是同步 CPU/IO 重活（pypdf 最多 30 页），下沉线程池。
        documents = await run_in_threadpool(extract_documents_text, payload.documents)
        assert_attachment_budget(
            count=len(payload.images) + len(payload.documents),
            total_bytes=total_attachment_bytes(images) + documents.size_bytes,
        )
    except ValueError as exc:
        # 在路由层抛：只有 HTTPException 的 detail 会被前端原样展示。
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    image_urls = image_data_urls(images) + list(documents.images)
    has_images = bool(image_urls)
    has_documents = bool(payload.documents)
    # 文档文字与粘贴文本合并成同一份 source_text：本地规则与模型看到的材料一致。
    source_text = "\n\n".join(part for part in (payload.text, documents.text) if part.strip())
    local_values, _local_custom = webform_service.extra_profile_text.parse_extra_profile_text(
        source_text
    )

    def local_result(warnings: list[str]) -> WebFormExtraProfileParseOut:
        """本地规则的结果（``custom`` 恒空，理由见 D22）。"""
        return WebFormExtraProfileParseOut(
            values=local_values,
            custom=[],
            warnings=list(dict.fromkeys([*warnings, *documents.warnings])),
            parse_engine="local",
            recognized_text=source_text,
        )

    config = get_llm_config(db)
    if not llm_is_configured(config):
        return local_result([no_model_warning(has_images, has_documents)])

    provider = create_provider(config)
    # 拿到配置就把连接还给池子：模型调用可能几十秒，不该一直占着一个会话。
    db.close()
    try:
        values, custom, warnings, recognized = (
            await webform_service.extra_profile_text.extract_extra_profile(
                provider, source_text, local_values, image_urls
            )
        )
    except LLMError as exc:
        logger.warning("网申资料 AI 识别失败，已回退本地解析：%s", exc)
        return local_result([ai_failed_warning(has_images, str(exc), has_documents)])
    except Exception:  # noqa: BLE001 - 外部模型异常不能阻断草稿解析
        logger.exception("网申资料 AI 识别发生内部错误，已回退本地解析")
        return local_result([ai_failed_warning(has_images, has_documents=has_documents)])
    return WebFormExtraProfileParseOut(
        values=values,
        # 服务层返回的是 dict 草稿（模型与本地路径同形）；pydantic 运行时会强转，
        # 但 pyright 的 list 不变性要求这里显式收窄成 schema 项。
        custom=[
            WebFormExtraProfileParsedItem.model_validate(item) for item in custom
        ],
        warnings=list(dict.fromkeys([*warnings, *documents.warnings])),
        parse_engine="ai",
        recognized_text=recognized,
    )

