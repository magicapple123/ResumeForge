# SPDX-License-Identifier: Apache-2.0
"""跨引擎对拍：同一份文档，草稿（Chromium 排版）与服务端 PDF 引擎量出的内容高度。

**这条守卫在防什么**：预览和 PDF 是两套独立排版引擎（浏览器 vs fpdf2）。"两边高度差不多"
是靠人眼看不出来的——差 3mm 可能只是最后一行，也可能是页头被漏画了一行；等用户发现
"下载的 PDF 比预览多一页"时，模板、字号比例、行距、页边距可能都已经各自漂了一轮。
所以这里把两侧的**内容高度**（正文最后一行到内容区顶边的距离）当数字对拍，并给出阈值。

**测量口径**：草稿侧执行 ``tests/assets/measure_layout.js``——它是
``frontend/src/utils/resumeLayoutMeasure.ts`` 的逐行镜像（空容器不算正文、排除
display:none / visibility:hidden / position:fixed、取 `bottom + margin-bottom` 的最大值）。
PDF 侧用 ``pdf_exporter.measure_content_height()``（mm）。两者都量"连续内容高度"，
与"排几页"无关，所以可以直接比。

**阈值**（改动必须单独 PR 说明——放宽阈值等于把这条守卫关掉）：

* hard fail：``|草稿 - PDF| > max(2.5mm, 1.5% × PDF)``
* warn：超过 ``max(1.5mm, 0.8% × PDF)`` 时 ``warnings.warn``（不失败，但留在报告里）
* 方向：``草稿 >= PDF - 1mm``——草稿不该反而更矮。这一条抓的是"PDF 多画了"的反向漂移
  （比如某个区块在 PDF 里重复绘制），只加绝对值上限是发现不了的。

**split 是已知差**：草稿两栏由 CSS grid 排，PDF 两栏由 ``columns.py`` 行级切分；窄栏的
折行更紧，两侧高度必然不同。用 ``xfail(strict=False)`` 记录，不假装对齐，也不让它在
修好之后变成红灯。

**失败信息必须能定位**：只报总高度的话，"页头漏画 2mm"和"最后一个分区多折了一行 2mm"
在数字上完全一样。所以失败时会按分区累计高度打一张对照表（PDF 侧用"只画到第 N 个分区"
的裁剪简历量出来，见 ``_pdf_prefix_profile``）。
"""

from __future__ import annotations

import math
import warnings

import pytest
from app.schemas.resume import ResumeContent
from app.services.exporter import render_html
from app.services.pdf_exporter import (
    measure_content_height,
    resolve_accent,
    resolve_layout,
)
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER, SECTION_LABELS
from app.services.resume.resume_templates import FONT_SCALES, template_spec
from browser_parity_support import (
    MM_PER_PX,
    load_document,
    measure_layout_stable,
    parity_resume,
)
from test_pdf_exporter import needs_font

pytestmark = [pytest.mark.cross_engine, needs_font]

# 单列模板：两侧的分区顺序一致，可以逐分区对照。
#
# 2026-10-22 从 classic / modern 扩到 7 个（除 split 外的全部内置模板）。原来看守只覆盖
# 2/8 个模板，另外 6 个里已有 4 个落进 warn 带却没人记录——这等于把"漂移"交给用户发现。
# 本机实测（Windows，两侧都用 msyh；草稿 / PDF / 差 / 距离 hard 线的余量）：
#   classic   +1.63mm +0.69% 余 1.94mm   modern   +1.49mm +0.58% 余 2.37mm
#   minimal   +0.63mm +0.26% 余 2.97mm   technical +1.84mm +0.87% 余 1.34mm
#   elegant   +2.59mm +1.04% 余 1.15mm   editorial +2.90mm +1.18% 余 0.80mm
#   compact   +2.21mm +1.12% 余 0.75mm（绝对余量最紧；editorial 是相对 1.5% 线最紧）
#   split     +4.71mm +2.14% —— 已 xfail，见文件末尾。
# 阈值仍是 hard = ``max(2.5mm, 1.5%)``，**不放宽**：240mm 简历的 hard 是 3.6mm，小于一个
# 正文行高（5.93mm）；再松就抓不住"PDF 少画了一行"这种最该抓的回归。editorial / compact
# 各只剩 0.8mm / 0.75mm 的余量——真到 1.5% 说明排版确实漂了，该查而不是该放宽。
# fixture 确定性（固定内容、固定视口、固定字号、连量两次稳定才认），不会引入抖动。
SINGLE_COLUMN_TEMPLATES = (
    "classic",
    "modern",
    "minimal",
    "technical",
    "compact",
    "elegant",
    "editorial",
)
# 双栏模板：已知差，单独用 xfail 记录（见模块 docstring）。
SPLIT_TEMPLATE = "split"

# ===== 阈值（改动必须单独 PR 说明理由）=====
# 绝对下限：2.5mm 小于一个正文行高（standard 字号约 5mm），但大于任何"取整误差"。
HARD_TOLERANCE_MM = 2.5
# 相对上限：长简历的累计折行差会随内容线性增长，只给绝对值会让长文档永远红。
HARD_TOLERANCE_RATIO = 0.015
# 告警线：比 hard fail 收紧一档，用来在"还没红但已经在漂"的时候留下记录。
WARN_TOLERANCE_MM = 1.5
WARN_TOLERANCE_RATIO = 0.008
# 方向守卫：草稿比 PDF 矮超过 1mm 说明 PDF 多画了（草稿漏掉整块内容几乎不可能
# 同时让两侧都"看起来正常"，所以这里给 1mm 的余量就够）。
DRAFT_MINUS_PDF_FLOOR_MM = -1.0
# 同一文档连续两次测量允许的抖动；超过就说明版面还没稳定，读数不可用。
STABILITY_TOLERANCE_MM = 0.2

_SECTION_ATTRS = {
    "summary": "summary",
    "education": "education",
    "experience": "experience",
    "campus_experience": "campus_experience",
    "projects": "projects",
    "skills": "skills",
    "awards": "awards",
}


def _pdf_layout(template: str):
    """与 ``build_resume_pdf`` 同一条解析路径（版式 + 强调色），只是不做分页。"""
    spec = template_spec(template)
    scale = FONT_SCALES["standard"]
    overrides: dict = {}
    layout = resolve_layout(
        template=spec["name"],
        base_px=float(scale["base_px"]),
        format_config=overrides,
    )
    return spec, layout, resolve_accent(spec["name"], overrides), overrides


def _pdf_content_height_mm(resume: ResumeContent, template: str) -> float:
    """PDF 引擎量出的连续内容高度（mm）。"""
    spec, layout, accent, overrides = _pdf_layout(template)
    return measure_content_height(
        resume,
        accent=accent,
        layout=layout,
        include_photo=False,
        format_config=overrides,
    )


def _document_html(resume: ResumeContent, template: str) -> str:
    """与预览同一入口的 HTML（同一个模板、同一档字号、同一份格式覆盖）。"""
    return render_html(
        resume,
        template=template,
        page_limit=1,
        font_scale="standard",
        format_config={},
    )


def _measure_draft(page, resume: ResumeContent, template: str) -> dict[str, float]:
    """加载 HTML、量正文高度；返回 mm 制的总高 / 一页可用高度。"""
    load_document(page, _document_html(resume, template))
    measured = measure_layout_stable(page, 1, tolerance_mm=STABILITY_TOLERANCE_MM)
    return {
        "used_mm": measured["used_height"] * MM_PER_PX,
        "used_px": measured["used_height"],
        "page_content_mm": measured["page_content_height"] * MM_PER_PX,
    }


def _present_sections(resume: ResumeContent) -> list[str]:
    """按默认分区顺序列出这份简历里真的有内容的分区。"""
    present: list[str] = []
    for key in DEFAULT_SECTION_ORDER:
        attr = _SECTION_ATTRS[key]
        value = getattr(resume, attr)
        has_content = bool(value.strip()) if isinstance(value, str) else bool(value)
        if has_content:
            present.append(key)
    return present


def _resume_with_sections(resume: ResumeContent, keys: set[str]) -> ResumeContent:
    """裁出一份"只含指定分区"的简历（页头永远保留），用于分项测量。"""
    update: dict = {}
    for key, attr in _SECTION_ATTRS.items():
        if attr == "summary":
            update[attr] = resume.summary if key in keys else ""
        else:
            update[attr] = list(getattr(resume, attr)) if key in keys else []
    return resume.model_copy(update=update)


def _pdf_prefix_profile(resume: ResumeContent, template: str) -> list[tuple[str, float]]:
    """PDF 侧的分项累计高度：页头、页头+第 1 个分区、页头+前 2 个分区……

    ``measure_content_height`` 没有"只画到第 N 个分区"的参数，但内容相同的裁剪简历
    等价于它——分区之间只有纵向间距，没有跨分区的连排；裁剪后量出来的高度就是
    "画到这里为止"的高度。这条只在失败信息里用，不进断言。
    """
    present = _present_sections(resume)
    profile: list[tuple[str, float]] = [
        ("页头", _pdf_content_height_mm(_resume_with_sections(resume, set()), template))
    ]
    for index, key in enumerate(present):
        prefix = set(present[: index + 1])
        profile.append(
            (
                SECTION_LABELS[key],
                _pdf_content_height_mm(_resume_with_sections(resume, prefix), template),
            )
        )
    return profile


def _draft_prefix_height_mm(page, resume: ResumeContent, template: str, keys: set[str]) -> float:
    """草稿侧"只画到指定分区"的内容高度（mm）。"""
    load_document(page, _document_html(_resume_with_sections(resume, keys), template))
    measured = measure_layout_stable(page, 1, tolerance_mm=STABILITY_TOLERANCE_MM)
    return measured["used_height"] * MM_PER_PX


def _draft_prefix_profile(page, resume: ResumeContent, template: str) -> list[tuple[str, float]]:
    """草稿侧的分项累计高度——与 ``_pdf_prefix_profile`` 用**同一批裁剪简历**。

    为什么不直接用 DOM 里各区间的 ``getBoundingClientRect().bottom``：那会把分区自己的
    ``margin-bottom`` 算进来（TS 口径只认"有直接文本的元素"的下外边距），于是"页头"
    一行会凭空多出 5~6mm 的尾部外边距，看起来像页头画多了，其实只是两边对"尾部间距"
    的归属不同。裁剪 + 重量的口径与 PDF 侧完全对称，差值是干净的。
    """
    present = _present_sections(resume)
    profile: list[tuple[str, float]] = [
        ("页头", _draft_prefix_height_mm(page, resume, template, set()))
    ]
    for index, key in enumerate(present):
        prefix = set(present[: index + 1])
        profile.append(
            (SECTION_LABELS[key], _draft_prefix_height_mm(page, resume, template, prefix))
        )
    return profile


def _mismatch_report(
    page,
    resume: ResumeContent,
    template: str,
    draft: dict[str, float],
    pdf_mm: float,
) -> str:
    """失败信息：总高 + 页头/各分区的累计高度对照（草稿 vs PDF）。"""
    diff_mm = draft["used_mm"] - pdf_mm
    ratio = diff_mm / pdf_mm if pdf_mm else 0.0
    lines = [
        f"模板 {template}：草稿 {draft['used_mm']:.2f}mm vs PDF {pdf_mm:.2f}mm"
        f"（{diff_mm:+.2f}mm / {ratio:+.2%}）",
        f"浏览器实测一页可用高度 {draft['page_content_mm']:.2f}mm",
        "分项累计高度（每行都是「只画到该分区为止」；草稿 / PDF / 差 mm）：",
    ]
    draft_profile = _draft_prefix_profile(page, resume, template)
    pdf_profile = _pdf_prefix_profile(resume, template)
    lines.append(
        "  （首行偏负是口径差：页头容器自己的 padding-bottom / margin-bottom / 下边框"
        "不被草稿口径计入（它没有直接文本），PDF 侧却真的画了这段间距。"
        "从第二行起的**增量**才是各分区自身的差。）"
    )
    for index, (label, draft_cum_mm) in enumerate(draft_profile):
        if index < len(pdf_profile):
            pdf_cum_mm = pdf_profile[index][1]
            lines.append(
                f"  {label:<8} 草稿累计 {draft_cum_mm:7.2f} / PDF 累计 {pdf_cum_mm:7.2f} / "
                f"差 {draft_cum_mm - pdf_cum_mm:+.2f}"
            )
        else:
            lines.append(f"  {label:<8} 草稿累计 {draft_cum_mm:7.2f} / PDF 侧没有对应分区")
    if template == SPLIT_TEMPLATE:
        lines.append(
            "  注：split 是两栏版式，某个分区可能被排进另一栏，累计高度的增长不是线性的；"
            "逐行差仍能指出「第一处分歧出现在哪个分区之后」。"
        )
    return "\n".join(lines)


@pytest.mark.parametrize("template", SINGLE_COLUMN_TEMPLATES)
def test_draft_and_pdf_agree_on_content_height(chromium_page, template):
    """单列模板：草稿与 PDF 量出的正文高度必须落在阈值内，且草稿不能更矮。"""
    resume = parity_resume()
    draft = _measure_draft(chromium_page, resume, template)
    pdf_mm = _pdf_content_height_mm(resume, template)

    diff_mm = draft["used_mm"] - pdf_mm
    ratio = diff_mm / pdf_mm if pdf_mm else 0.0
    report = (
        f"模板 {template}：草稿 {draft['used_mm']:.2f}mm vs PDF {pdf_mm:.2f}mm"
        f"（{diff_mm:+.2f}mm / {ratio:+.2%}）"
    )

    warn_limit = max(WARN_TOLERANCE_MM, WARN_TOLERANCE_RATIO * pdf_mm)
    if abs(diff_mm) > warn_limit:
        warnings.warn(
            f"跨引擎内容高度正在漂移：{report}；告警线 {warn_limit:.2f}mm。"
            "还没到 hard fail，但值得看一眼模板/版式最近改了什么。",
            stacklevel=1,
        )

    assert diff_mm >= DRAFT_MINUS_PDF_FLOOR_MM, (
        "草稿比 PDF 矮——PDF 侧多画了内容（重复区块 / 多算间距）：\n"
        + _mismatch_report(chromium_page, resume, template, draft, pdf_mm)
    )

    hard_limit = max(HARD_TOLERANCE_MM, HARD_TOLERANCE_RATIO * pdf_mm)
    assert abs(diff_mm) <= hard_limit, (
        f"跨引擎内容高度超限（阈值 {hard_limit:.2f}mm）：\n"
        + _mismatch_report(chromium_page, resume, template, draft, pdf_mm)
    )


# 已知差：split 的两栏在草稿侧由 CSS grid 排、PDF 侧由 columns.py 行级切分，窄栏折行更紧。
# 2026-10-21 本机实测（Chromium 153.0.8010.12，PDF 字体 msyh.ttc）：
#   草稿 224.99mm vs PDF 220.28mm（+4.71mm / +2.14%）——超过 hard 阈值 max(2.5mm, 3.30mm)。
# 历史记录（另一份样本）：草稿 227.52mm vs PDF 218.33mm（−9.2mm / −4%），方向相反，
# 说明差异的**大小与方向**都取决于内容折行，不是固定偏移。strict=False：真修好两侧对齐
# 之后，这条会自然变成 XPASS，不会拦路。
@pytest.mark.xfail(
    strict=False,
    reason=(
        "split 双栏已知差：草稿 224.99mm vs PDF 220.28mm（+4.71mm / +2.14%）；"
        "CSS grid 与 columns.py 的窄栏折行不同，两侧高度不要求相等。"
    ),
)
def test_split_two_column_height_is_a_known_difference(chromium_page):
    """split：记录已知差，同时守住"不能差到离谱"（超过 hard 阈值就是回归）。"""
    resume = parity_resume()
    draft = _measure_draft(chromium_page, resume, SPLIT_TEMPLATE)
    pdf_mm = _pdf_content_height_mm(resume, SPLIT_TEMPLATE)

    diff_mm = draft["used_mm"] - pdf_mm
    hard_limit = max(HARD_TOLERANCE_MM, HARD_TOLERANCE_RATIO * pdf_mm)
    assert abs(diff_mm) <= hard_limit, (
        f"split 的高度差超出已知范围（阈值 {hard_limit:.2f}mm）：\n"
        + _mismatch_report(chromium_page, resume, SPLIT_TEMPLATE, draft, pdf_mm)
    )


def test_measure_script_matches_the_ts_algorithm_on_empty_containers(chromium_page):
    """守卫镜像本身：空容器不算正文——这条口径一旦丢了，两侧都会"凭空变高"。

    直接钉"有文本的段落被计入、只有下边距的空 div 不被计入"，比拿两份输出对拍更容易
    定位：真出问题时，失败点直接指向 ``measure_layout.js`` 而不是某个模板。
    """
    html = """<!DOCTYPE html>
<html><head><meta charset="utf-8"><style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { width: 210mm; height: 297mm; padding: 14mm; font-size: 14px; line-height: 1.7; }
  .empty { margin-bottom: 40px; }
</style></head>
<body>
  <p>一行正文</p>
  <div class="empty"></div>
</body></html>"""
    load_document(chromium_page, html)
    measured = measure_layout_stable(chromium_page, 1, tolerance_mm=STABILITY_TOLERANCE_MM)

    content_height_px = (297 - 28) / MM_PER_PX
    assert measured["page_content_height"] == pytest.approx(content_height_px, abs=0.5), (
        "一页可用高度应当等于 (297mm - 上下各 14mm) 换算成 px"
    )
    # 只有一行正文：高度应当落在一行（约 1.7 × 14px ≈ 24px）附近；
    # 若空 div 的 40px 下边距被算进去，读数会直接高出 40px。
    line_px = 14 * 1.7
    assert measured["used_height"] < line_px + 20, (
        f"空容器被当成了正文：量到 {measured['used_height']:.2f}px，而一行正文约 {line_px:.2f}px"
    )
    assert measured["used_height"] >= line_px - 2, (
        f"正文行没有被计入：量到 {measured['used_height']:.2f}px"
    )
    assert not math.isnan(measured["used_height"])
