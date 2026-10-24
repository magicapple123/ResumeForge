# SPDX-License-Identifier: Apache-2.0
"""模板预览示例内容的守卫：**字段齐全、有照片、三档都填满一页**。

为什么值得一个文件：这份内容是每个新用户打开工作台时看到的唯一一份简历，也是"每个
模板长什么样"的唯一素材。它悄悄退化成半页空白（或其中一栏永远是空的），用户不会报错，
只会觉得"这工具做出来的简历本来就该这么空"。

两条断言：

1. **字段齐全**：``ResumeContent`` 的每个字段都有值，照片是能过
   ``validate_photo_data_url`` 的 JPEG data URL（且 < 15 KB，别把几 MB 塞进每次预览）。
2. **一页 + 填满**：每套可选模板 × 每档字号，服务端 PDF 都只排一页、不 overflow，
   且内容填充率落在 80%–100%。填充率 = ``measure_content_height`` / 可用高度
   （A4 297mm 减去这套模板的上下页边距）。这组数字就是 ``_DENSITY`` 的取值依据：

   ==========  =========  =========  =========  =========  =========  =========
   字号档        classic    modern    compact    elegant    minimal    scholar
   ==========  =========  =========  =========  =========  =========  =========
   small            90.3%      97.4%      91.7%      96.0%      94.1%      86.0%
   standard         89.8%      98.2%      93.8%      96.0%      92.4%      85.6%
   large            88.8%      97.5%      96.3%      94.5%      90.7%      89.5%
   ==========  =========  =========  =========  =========  =========  =========

   注意 ``large`` 只保留 5 个小节（教育 / 实习工作 / 项目 / 技能 / 总结）：18px 下
   页眉（含照片）+ 七个小节标题本身就超过一页，无论内容多短都排不进一页。
"""

from __future__ import annotations

import base64

import pytest
from app.schemas.profile import validate_photo_data_url
from app.schemas.resume import ResumeContent
from app.services.pdf_exporter import (
    build_resume_pdf,
    font_available,
    measure_content_height,
    resolve_layout,
)
from app.services.resume.resume_sample import (
    SAMPLE_FONT_SCALES,
    density_group,
    normalize_font_scale,
    sample_resume_content,
)
from app.services.resume.resume_sample_photo import SAMPLE_PHOTO_DATA_URL
from app.services.resume.resume_template_market import FONT_SCALES as FONT_SCALE_SPECS
from app.services.resume.resume_templates import template_options, validated_format_config

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

PAGE_HEIGHT_MM = 297.0
# 填充率的上下限：下限是"不显得空"，上限留 2% 余量给字体度量的极小抖动。
MIN_FILL = 0.80
MAX_FILL = 1.0

TEXT_FIELDS = (
    "name",
    "gender",
    "birth_year",
    "phone",
    "email",
    "city",
    "personal_website",
    "github",
    "job_intent",
    "summary",
)
LIST_FIELDS = (
    "education",
    "experience",
    "campus_experience",
    "projects",
    "skills",
    "awards",
)
# 大字号档刻意只保留这五个小节（理由见模块 docstring）。
LARGE_SECTIONS = ("education", "experience", "projects", "skills")


@pytest.mark.parametrize("font_scale", SAMPLE_FONT_SCALES)
def test_every_scalar_field_is_filled(font_scale: str):
    """每个标量字段都有值——少一个，那个模板位在缩略图里就永远是空的。"""
    content = sample_resume_content(font_scale)
    for field in TEXT_FIELDS:
        value = getattr(content, field)
        assert isinstance(value, str) and value.strip(), f"{font_scale}：{field} 是空的"


@pytest.mark.parametrize("font_scale", SAMPLE_FONT_SCALES)
def test_every_section_has_content(font_scale: str):
    """七个分区按档位裁剪，但**不能裁空**：没有内容的分区压根不会被渲染。"""
    content = sample_resume_content(font_scale)
    expected = LIST_FIELDS if font_scale != "large" else LARGE_SECTIONS
    for field in expected:
        assert getattr(content, field), f"{font_scale}：{field} 没有条目"


def test_photo_is_a_small_valid_jpeg_data_url():
    """照片必须是能过 schema 校验的 JPEG data URL，且小到可以塞进每次预览。"""
    content = sample_resume_content()
    assert content.photo == SAMPLE_PHOTO_DATA_URL
    # 走一遍真正的校验器（前缀、base64、文件签名三项都在里面）。
    validate_photo_data_url(content.photo)

    header, separator, encoded = content.photo.partition(",")
    assert separator and header == "data:image/jpeg;base64"
    raw = base64.b64decode(encoded, validate=True)
    assert raw.startswith(b"\xff\xd8\xff"), "不是 JPEG（缺文件签名）"
    # 目标 < 15 KB：这是缩略图素材，不是用户照片。
    assert len(raw) < 15 * 1024, f"示例照片 {len(raw)} 字节，超过 15 KB 预算"


def test_the_photo_has_the_profile_frame_ratio():
    """尺寸与资料页证件照框一致（132×176，见 `.profile-photo-frame`）。"""
    pytest.importorskip("PIL")
    from io import BytesIO

    from PIL import Image

    encoded = sample_resume_content().photo.partition(",")[2]
    image = Image.open(BytesIO(base64.b64decode(encoded, validate=True)))
    assert image.size == (132, 176)
    assert image.format == "JPEG"


def test_font_scale_and_template_inputs_are_normalized():
    """认不出的字号 / 模板名一律回落到"内容更少"的那一档，不抛异常。"""
    for bogus in (None, "", "huge", 42, ["small"]):
        assert normalize_font_scale(bogus) == "standard"
    assert normalize_font_scale("large") == "large"

    # 行高低于阈值的两套模板分到 roomy 档；其余（含未知名字）走 regular。
    assert density_group("compact") == "roomy"
    assert density_group("scholar") == "roomy"
    for name in ("classic", "modern", "elegant", "minimal", "不存在的模板", None):
        assert density_group(name) == "regular"


@pytest.mark.parametrize("font_scale", SAMPLE_FONT_SCALES)
def test_sample_is_a_valid_resume_content(font_scale: str):
    """产物本身必须仍是合法的 ``ResumeContent``（照片校验、长度上限都在里面）。"""
    content = sample_resume_content(font_scale, "classic")
    assert isinstance(content, ResumeContent)
    assert ResumeContent.model_validate(content.model_dump()).name == content.name


@needs_font
@pytest.mark.parametrize("font_scale", SAMPLE_FONT_SCALES)
@pytest.mark.parametrize("template_name", [item["name"] for item in template_options()])
def test_each_template_fits_one_page_and_is_mostly_full(template_name: str, font_scale: str):
    """每套模板 × 每档字号：只排一页、不 overflow、填充率 80%–100%。

    这是 ``_DENSITY`` 的取值依据，也是"切字号以后模板不会突然变空 / 变成两页"的守卫。
    """
    content = sample_resume_content(font_scale, template_name)
    base_px = float(FONT_SCALE_SPECS[font_scale]["base_px"])

    document = build_resume_pdf(
        content, template=template_name, page_limit=1, font_scale=font_scale
    )
    assert document.overflow is False, f"{template_name}/{font_scale} 溢出了一页"
    assert document.pages == 1
    assert document.pages_needed == 1

    layout = resolve_layout(template=template_name, base_px=base_px, format_config={})
    available = PAGE_HEIGHT_MM - layout.margin_top - layout.margin_bottom
    height = measure_content_height(
        content,
        accent=(22, 54, 92),
        layout=layout,
        format_config=validated_format_config({}),
    )
    fill = height / available
    assert MIN_FILL <= fill <= MAX_FILL, f"{template_name}/{font_scale} 填充率 {fill:.1%}"
