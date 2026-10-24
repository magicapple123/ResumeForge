# SPDX-License-Identifier: Apache-2.0
"""边界样例类别构造器（二）：特殊符号 / 局部强调 / 模板矩阵 / 极端边距 / 分页边界 /
旧记录 / 学术长 CV。

每个构造器返回固定顺序的 8 份（模板矩阵 9 份、学术长 CV 3 份）样例；内容来自
sample_content_variants，渲染参数与期望在构造器里显式声明。类别归属见
sample_corpus_boundaries.CATEGORY_BUILDERS。
"""

from __future__ import annotations

from typing import Any

from . import sample_content_variants as variants
from .sample_boundary_common import (
    ALL_TEMPLATES,
    FONT_SCALES,
    VISIBLE_TEMPLATES,
    make_sample,
)
from .sample_specs import Expect, Sample, base_content, with_photo


def build_special_chars() -> list[Sample]:
    """HTML 元字符/引号/模板语法字样/全角标点：转义与原文保留分别断言。"""
    samples = []
    for idx in range(8):
        content = variants.special_chars(idx)
        # 正文里有 & < > 与模板语法字样：HTML 会转义，token 只在文本产物里原样查。
        expect = Expect(
            text_tokens=("示例丙", "示例要点：A & B"),
            html_text_tokens=False,
        )
        if idx == 0:
            # HTML 必须转义正文里的标签字样；md/txt 保留原文（文本产物不做转义）。
            expect = Expect(
                text_tokens=("示例丙", "<script>alert(1)</script>"),
                html_text_tokens=False,
                html_contains=("&lt;script&gt;alert(1)&lt;/script&gt;",),
                html_excludes=("<script>alert(1)</script>",),
            )
        if idx == 5:
            # 正文里的 {{jinja}} 不在模板里求值，原样出现在 DOM 文本中（转义只处理
            # 非 ASCII 引号等）；不能断言"HTML 不含 $ 花括号"——模板自带的适配脚本
            # 里就有 JS 模板字符串。
            expect = Expect(
                html_text_tokens=False,
                html_contains=("{{jinja}}",),
            )
        samples.append(
            make_sample(
                "special-chars",
                idx + 1,
                f"特殊符号 #{idx + 1}",
                (
                    "HTML 元字符 / 引号 / 模板语法字样 / 全角标点",
                    "HTML 转义与文本产物原文保留分别断言",
                ),
                content,
                template=ALL_TEMPLATES[idx % len(ALL_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=2,
                expect=expect,
            )
        )
    return samples


def build_emphasis() -> list[Sample]:
    """局部强调：成对 ** 加粗且文本去标记；1 份落单 ** 必须原样保留。"""
    samples = []
    for idx in range(8):
        content, paired = variants.emphasis(idx)
        expect = Expect(
            max_pages=3,
            text_tokens=("示例甲",),
            bold_html=True,
            literal_markers=False,
        )
        if not paired:
            expect = Expect(
                max_pages=3,
                text_tokens=("示例甲",),
                bold_html=False,
                literal_markers=True,
            )
        samples.append(
            make_sample(
                "emphasis",
                idx + 1,
                f"局部强调 #{idx + 1}（{'成对' if paired else '落单'}）",
                (
                    "成对 ** 标记转成加粗、文本产物去标记"
                    if paired
                    else "落单 ** 按普通文字保留，不吞字符",
                    "HTML <strong> / Markdown 标记 / TXT 去标记三处语义分开断言",
                ),
                content,
                template=VISIBLE_TEMPLATES[idx % len(VISIBLE_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=2,
                expect=expect,
            )
        )
    return samples


def build_template_matrix() -> list[Sample]:
    """九套内置模板各一份：small 档一页、standard 档两页（实测的真实差异）。"""
    samples = []
    for idx, template in enumerate(ALL_TEMPLATES):
        font_scale = ("small", "standard")[idx % 2]
        matrix_page_limit = 1 if font_scale == "small" else 2
        content = base_content()
        content["summary"] = f"{template} 模板矩阵：{content['summary']}"
        samples.append(
            make_sample(
                "template-matrix",
                idx + 1,
                f"模板矩阵 · {template}",
                (
                    "九套内置模板逐个端到端渲染",
                    "已下线模板仍可解析老记录的 template 字段",
                    f"实测：{font_scale} 档自然 {matrix_page_limit} 页以内",
                ),
                content,
                template=template,
                font_scale=font_scale,
                page_limit=matrix_page_limit,
                expect=Expect(
                    max_pages=matrix_page_limit,
                    overflow=False,
                    text_tokens=("示例甲",),
                ),
            )
        )
    return samples


def sparse_or_base(idx: int) -> dict[str, Any]:
    """边距样例的内容量：宽边距用少内容、窄边距用常规内容，避免与"内容太长"混在一起。"""
    if idx in (1, 5, 6):
        return variants.sparse(idx % 8)
    return base_content()


def build_extreme_margins() -> list[Sample]:
    """页边距 0 / 26mm / 四边不等；行高与区块间距取边界值。"""
    configs: list[dict[str, Any]] = [
        {"page_padding": 0},
        {"page_padding": 26},
        {
            "page_padding_top": 0,
            "page_padding_right": 26,
            "page_padding_bottom": 5,
            "page_padding_left": 18,
        },
        {"page_padding": 2.5},
        {"page_padding": 0, "line_height": 1.2, "section_gap": 0.6},
        {"page_padding": 26, "line_height": 2.2, "section_gap": 2.2},
        {"page_padding": 26, "photo_scale": 1.6},
        {"page_padding": 0, "photo_scale": 0.6},
    ]
    samples = []
    for idx, config in enumerate(configs):
        content = with_photo(sparse_or_base(idx))
        # 内容量在宽边距样例里换成了 sparse（姓名可能是"示例乙"），token 跟着内容走。
        name_token = str(content.get("name") or "示例")
        samples.append(
            make_sample(
                "extreme-margins",
                idx + 1,
                f"极端边距 #{idx + 1}",
                (
                    "页边距 0 / 26mm 与四边不等",
                    "行高/区块间距取边界值；不缩字号、不产生空白页",
                ),
                content,
                template=VISIBLE_TEMPLATES[idx % len(VISIBLE_TEMPLATES)],
                font_scale=("small", "standard")[idx % 2],
                page_limit=2,
                format_config=config,
                # 26mm 边距 + 标准字号下内容量差异很大，不钉自然页数：守上限、照片与 token。
                expect=Expect(photo=True, text_tokens=(name_token,)),
            )
        )
    return samples


def build_page_boundary() -> list[Sample]:
    """分页边界：内容量贴着 1–2 页的档位逐级变化。"""
    cases: list[tuple[str, int, int]] = [
        ("standard", 1, 1),
        ("small", 1, 2),
        ("small", 1, 3),
        ("small", 1, 4),
        ("standard", 2, 2),
        ("standard", 2, 3),
        ("large", 2, 4),
        ("large", 2, 4),
    ]
    samples = []
    for idx, (font_scale, page_limit, experience_count) in enumerate(cases):
        content = variants.page_boundary(idx)
        content["experience"] = content["experience"][:experience_count]
        samples.append(
            make_sample(
                "page-boundary",
                idx + 1,
                f"分页边界 #{idx + 1}（{font_scale} / {page_limit} 页）",
                (
                    f"{experience_count} 段经历、字号 {font_scale}",
                    "页数与溢出标记自洽；末页不留空白页",
                ),
                content,
                template=("classic", "modern", "compact", "scholar")[idx % 4],
                font_scale=font_scale,
                page_limit=page_limit,
                include_photo=idx % 2 == 0,
                # 分页边界不钉精确自然页数（字体度量会造成跨平台漂移），只守上限、
                # 溢出标记自洽与内容不丢。
                expect=Expect(text_tokens=("示例甲",)),
            )
        )
    return samples


def build_legacy_record() -> list[Sample]:
    """旧记录：无 id/point_ids、字段残缺、含未知键。"""
    samples = []
    for idx in range(8):
        content = variants.legacy_raw(idx)
        samples.append(
            make_sample(
                "legacy-record",
                idx + 1,
                f"旧记录 #{idx + 1}",
                (
                    "无 id / point_ids、字段残缺、含未知键",
                    "读入忽略未知键、序列化不凭空生成身份字段、导出正常",
                ),
                content,
                template=VISIBLE_TEMPLATES[idx % len(VISIBLE_TEMPLATES)],
                font_scale=FONT_SCALES[idx % 3],
                page_limit=1,
                include_photo=False,
                expect=Expect(
                    max_pages=1,
                    overflow=False,
                    photo=False,
                    legacy_raw=True,
                ),
            )
        )
    return samples


def build_scholar_long_cv() -> list[Sample]:
    """学术长 CV：博士在读 + 多段研究经历 + 论文列表，scholar 2 页。"""
    samples = []
    for idx in range(3):
        content = variants.scholar_long_cv(idx, long_cv=True)
        samples.append(
            make_sample(
                "scholar-long-cv",
                idx + 1,
                f"学术长 CV #{idx + 1}",
                (
                    "博士在读 + 多段研究经历 + 论文列表",
                    "scholar 模板 2–3 页，技能列表与分区标题不串行",
                ),
                content,
                template="scholar",
                font_scale=("small", "standard")[idx % 2],
                page_limit=3,
                include_photo=idx == 2,
                expect=Expect(
                    max_pages=3,
                    text_tokens=("示例丁", "ExampleConf"),
                ),
            )
        )
    return samples
