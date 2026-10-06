"""简历模板目录聚合端点（域①）。

从原 ``api/resumes.py`` 的 ``GET /templates`` 原样搬运：只读拼装样式模板、格式预设、
字号档位、分区清单、模板市场与 PDF 直出可用性。真正的模板 CRUD 在 ``api/resume_templates.py``，
不并入本域。
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...services.pdf_exporter import font_available
from ...services.resume.resume_sections import DEFAULT_SECTION_ORDER, section_label
from ...services.resume.resume_template_store import (
    custom_format_options,
    custom_template_options,
)
from ...services.resume.resume_template_style import style_field_options
from ...services.resume.resume_templates import (
    DEFAULT_FONT_SCALE,
    DEFAULT_PAGE_LIMIT,
    DEFAULT_TEMPLATE,
    FORMAT_PRESETS,
    font_scale_options,
    format_field_options,
    market_options,
    template_options_with_custom,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/templates")
def read_resume_templates(db: Session = Depends(get_db)):
    """可选的简历模板、格式模板与字号档位（生成、预览、工作台共用这一份清单）。

    必须定义在 ``/{resume_id}`` 之前：否则 ``templates`` 会被当成记录 id 匹配，
    请求会以 422 结束。
    """
    return {
        "templates": template_options_with_custom(custom_template_options(db)),
        "font_scales": font_scale_options(),
        "format_fields": format_field_options(),
        "style_fields": format_field_options() + style_field_options(),
        # 正文分区清单（给「调整板块顺序」用）。键名、标签与顺序定义都在
        # services/resume/resume_sections.py，四个渲染器读的是同一份。
        "section_options": [
            {"key": key, "label": section_label(key)} for key in DEFAULT_SECTION_ORDER
        ],
        "default_section_order": list(DEFAULT_SECTION_ORDER),
        "format_presets": [
            {
                "name": item["name"],
                "label": item["label"],
                "description": item["description"],
                "config": item["config"],
                "custom": False,
                "id": None,
            }
            for item in FORMAT_PRESETS
        ]
        + [
            {
                "name": item["name"],
                "label": item["label"],
                "description": item["description"],
                "config": item["config"],
                "custom": True,
                "id": item["id"],
            }
            for item in custom_format_options(db)
        ],
        "defaults": {
            "template": DEFAULT_TEMPLATE,
            "font_scale": DEFAULT_FONT_SCALE,
            "page_limit": DEFAULT_PAGE_LIMIT,
            "format_name": "",
        },
        # 模板市场（R-19）：映射既有样式模板 + 格式预设 + 建议字号，不新建样式文件。
        "market": market_options(),
        "pdf_direct_available": font_available(),
    }
