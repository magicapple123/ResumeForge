# SPDX-License-Identifier: Apache-2.0
"""简历模板目录聚合端点（域①）。

从原 ``api/resumes.py`` 的 ``GET /templates`` 原样搬运：只读拼装模板、版式、
字号档位、分区清单、模板市场与 PDF 直出可用性。真正的模板 CRUD 在 ``api/resume_templates.py``，
不并入本域。
"""

import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from ...database import get_db
from ...schemas.resume_generation import LONG_CV_DEFAULT_PAGE_LIMIT, MODE_PAGE_LIMITS
from ...services.pdf_exporter import font_available
from ...services.resume.resume_sections import (
    DEFAULT_SECTION_ORDER,
    profile_section_order_keys,
    profile_to_resume_order,
    section_label,
    sortable_profile_section_keys,
)
from ...services.resume.resume_style_schema import (
    STYLE_PROPS,
    role_fields_catalog,
    template_role_defaults,
)
from ...services.resume.resume_template_layout import TEMPLATE_LAYOUT_DEFAULTS
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
    """可选的简历模板、版式与字号档位（生成、预览、工作台共用这一份清单）。

    必须定义在 ``/{resume_id}`` 之前：否则 ``templates`` 会被当成记录 id 匹配，
    请求会以 422 结束。
    """
    # 资料顺序只取一次：下面两个字段（翻译后的顺序 / 原样排过的键）读同一份全局顺序。
    profile_order = profile_section_order_keys(db)
    return {
        "templates": template_options_with_custom(custom_template_options(db)),
        # 每个内置模板的版式默认值（只放用户可调的三项）。行距/页边距控件在"用户没设过
        # 覆盖"时必须显示模板的真实默认值——否则滑块停在一个与实际渲染不同的数字上，
        # 用户一拖就会跳一下，且说不清自己改的是哪一个值。
        "template_layouts": {
            name: {
                "line_height": defaults["line_height"],
                "padding_mm": defaults["padding_mm"],
                "section_gap": defaults["section_gap"],
            }
            for name, defaults in TEMPLATE_LAYOUT_DEFAULTS.items()
        },
        "font_scales": font_scale_options(),
        "format_fields": format_field_options(),
        "style_fields": format_field_options() + style_field_options(),
        # 正文分区清单（给「调整板块顺序」用）。键名、标签与顺序定义都在
        # services/resume/resume_sections.py，四个渲染器读的是同一份。
        "section_options": [
            {"key": key, "label": section_label(key)} for key in DEFAULT_SECTION_ORDER
        ],
        "default_section_order": list(DEFAULT_SECTION_ORDER),
        # 生成界面用的默认顺序：跟随用户在「我的资料」里排好的顺序。
        # **不改**上面的 ``default_section_order``——它是"内置默认"，已保存简历在没有
        # 自己的 ``section_order`` 时读的是它；把两者混成一个字段，等于让资料页的一次
        # 拖动把用户已经导出过的简历悄悄换一个样子。
        "profile_section_order": profile_to_resume_order(profile_order),
        # 【新增】「我的资料」里**原样**排过的分区键（`educations` / `projects` …）：
        # 不补齐、不映射成简历键。它与上面那个字段回答的是两个问题——
        # 上面是"翻译后的完整排列"（新简历的默认值来源），这里是"资料里到底有没有可排序的
        # 分区"这个事实本身：空数组意味着「按我的资料顺序排列」这个动作无从谈起，前端据此
        # 禁用那颗按钮并说明原因，而不是给一个点了也没反应的入口。
        "profile_section_keys": sortable_profile_section_keys(profile_order),
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
        # W14 长 CV：页数控件按模式取值（普通 [1,3] / 长 CV [1,10]），默认 2 页。
        "mode_page_limits": {mode: list(bounds) for mode, bounds in MODE_PAGE_LIMITS.items()},
        "long_cv_default_page_limit": LONG_CV_DEFAULT_PAGE_LIMIT,
        "defaults": {
            "template": DEFAULT_TEMPLATE,
            "font_scale": DEFAULT_FONT_SCALE,
            "page_limit": DEFAULT_PAGE_LIMIT,
            "format_name": "",
        },
        # 模板市场（R-19）：映射既有模板 + 版式 + 建议字号，不新建样式文件。
        "market": market_options(),
        "pdf_direct_available": font_available(),
        # ===== W07 局部排版（角色/对象覆盖）的消费契约 =====
        # 角色 → 可用属性（label_key 是 i18n 词条键，不下发中文；前端按它 t() 出文案）。
        "role_fields": role_fields_catalog(),
        # 每个模板的角色基准值：从 TEMPLATE_LAYOUT_DEFAULTS 既有比例字段投影
        # （name_ratio → name.font_scale 等），与 PDF/Word 的解析同源，不新增第二份数字。
        "template_role_defaults": {
            name: template_role_defaults(name) for name in TEMPLATE_LAYOUT_DEFAULTS
        },
        # 属性元数据（类型/区间/步长/枚举），前端控件与后端 PROP_BOUNDS 逐键对拍。
        "style_props": [
            {
                "key": prop["key"],
                "type": prop["type"],
                **({"min": prop["min"], "max": prop["max"], "step": prop["step"]}
                   if prop["type"] == "number" else {}),
                **({"options": list(prop["options"])} if prop["type"] == "enum" else {}),
                **({"roles": list(prop["roles"])} if "roles" in prop else {}),
            }
            for prop in STYLE_PROPS
        ],
    }
