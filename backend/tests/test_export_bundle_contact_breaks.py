# SPDX-License-Identifier: Apache-2.0
"""#3 用户反馈回归：联系方式换行必须**真的**进 Word（成套导出 = 用户实际下载路径）。

用户原话：「制作台『排版参数 → 联系方式换行』设置后，导出的 Word 里联系方式没有按设置
换行」。Word 只有一条产线（`export_bundle` → `build_export` → `docx_exporter`），
所以这里从**真实 HTTP 接口**下载 zip、解包 docx、再解包 `word/document.xml` 读
OOXML：断言的不是"我传了参数"，而是"docx 里真的有 `w:br`，且落在目标字段前面"。

三条路径都钉住：
1. 制作台**未保存**的草稿版式（请求体 `format_config`）；
2. **已保存**到记录的版式（请求不带 `format_config`，读库）；
3. 旧简历（没有 `contact_breaks`）**不产生组间强制换行**：字段不丢不重不劈，但同一组
   内部按可用宽度装行（2026-11 #9 的产品变更，见下）。

## 为什么第 3 条不再是"一个 `w:br` 都不多"（兼容性说明，写进 CHANGELOG）

旧行为：没有 `contact_breaks` 时，Word 把整组联系方式拼成**一个**字符串交给 Word 自己
断行，因此产物里恒为零个 `w:br`。问题 9（2026-11 #9）有意改掉了这一点——Word 与 PDF 现在
共用 `resume_contact.pack_contact_lines`，**同一联系方式组内按可用宽度装行**（28 号 7 字段
一组 → 3 行）。原因是"交给 Word 自由断行"与预览/PDF 的行分布必然对不上（字段间隔、字符
宽度、字体替换三处都不同），用户看到"预览里 GitHub 起第二行、Word 里个人主页才落第二行"。
所以旧用例的前提（"产物只有一个 `w:p` 且零 `w:br`"）已被产品变更推翻；它真正守护的东西
改成：**字段不丢不重、顺序不变、组间不合并、装行只发生在字段边界**，并且 `w:br` 的数量
必须等于可用宽度贪心复算出来的行数 − 1（而不是随便几个）。
"""

from __future__ import annotations

import io
import re
import zipfile

from app.schemas.resume import ResumeContent
from app.services.docx_text_measure import make_text_measure
from app.services.pdf_exporter import PAGE_WIDTH_MM
from app.services.pdf_exporter.layout import resolve_layout
from app.services.resume.resume_contact import (
    WORD_SEPARATOR,
    contact_groups,
    contact_items,
    pack_contact_lines,
)
from app.services.resume.resume_labels import field_labels
from app.services.resume.resume_template_format import FONT_KEY
from app.services.resume.resume_templates import FONT_SCALES, validated_format_config
from docx import Document

CONTACT_CONTENT = {
    "name": "张示例",
    "phone": "13800000000",
    "email": "demo@example.com",
    "city": "上海",
    "birth_year": "2001",
    "github": "https://github.example.com/demo",
    "personal_website": "https://demo.example.com/very/long/path",
    "summary": "一段总结",
}


def _create_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"title": "联系方式换行回归（虚构）", "content": CONTACT_CONTENT},
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _bundle_docx(client, resume_id: int, **body) -> bytes:
    """走真实成套导出接口，取 zip 里的 docx 字节。"""
    response = client.post(
        f"/api/resumes/{resume_id}/export-bundle", json={"formats": ["docx"], **body}
    )
    assert response.status_code == 200, response.text
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        docx_name = next(name for name in archive.namelist() if name.endswith(".docx"))
        return archive.read(docx_name)


def _document_xml(docx_bytes: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(docx_bytes)) as docx:
        return docx.read("word/document.xml").decode("utf-8")


def _force_break_positions(xml: str) -> list[int]:
    """所有 `w:br` 的位置（不把图片/分页等其他 br 算进来：本测试的简历只有页头文字）。"""
    return [match.start() for match in re.finditer(r"<w:br\s*/?>", xml)]


def _contact_paragraph_lines(docx_bytes: bytes) -> list[str]:
    """导出 docx 里**联系方式那一段**的行文本（python-docx 把 `w:br` 读成 `\\n`）。"""
    document = Document(io.BytesIO(docx_bytes))
    paragraphs = [item for item in document.paragraphs if "GitHub：" in item.text]
    assert len(paragraphs) == 1, f"联系方式应当只占一个段落，实际 {len(paragraphs)} 个"
    return paragraphs[0].text.split("\n")


def _expected_contact_lines(detail: dict) -> tuple[list[str], bool]:
    """按导出的同一套口径**复算**页头联系方式的行文本（`可用宽度 + 贪心装行`）。

    这里刻意复用生产的纯函数（`resolve_layout` / `make_text_measure` /
    `pack_contact_lines`），只把 `docx_document_parts.draw_header` 里那三行宽度算式
    （版心宽 − 页头左右内边距 − 照片栏，本用例没有照片）复述一遍——这样"`w:br` 数 ==
    贪心复算值"就是一个可独立验证的等式，而不是"实现写几行测试就认几行"。

    返回 `(行文本, 是否量到了宽度)`：字体文件探测不到时（无字体环境）`measure is None`，
    实现与复算都退化成"一组一行"，此时等式依然成立但没有"必须多行"这层含义。
    """
    overrides = validated_format_config(detail.get("format_config"))
    base_px = float(FONT_SCALES[detail["font_scale"]]["base_px"])
    adjust = overrides.get("font_scale_adjust")
    if isinstance(adjust, (int, float)):
        base_px = round(base_px * float(adjust), 2)
    layout = resolve_layout(
        template=detail["template"], base_px=base_px, format_config=overrides, margin_mm=None
    )
    labels = field_labels(detail.get("language") or "zh-CN")
    resume = ResumeContent.model_validate(CONTACT_CONTENT)
    groups = contact_groups(contact_items(resume, labels, overrides.get("contact_breaks")))
    width_mm = (
        PAGE_WIDTH_MM
        - float(layout.margin_left)
        - float(layout.margin_right)
        - 2 * layout.gap_mm(layout.header_pad_x)
    )
    measure = make_text_measure(base_px * layout.contact_ratio, overrides.get(FONT_KEY))
    packed = pack_contact_lines(groups, width_mm, measure, WORD_SEPARATOR)
    return [WORD_SEPARATOR.join(line) for line in packed], measure is not None


def test_bundle_docx_draft_contact_breaks_land_before_the_target_field(client):
    """草稿版式（未保存）里的 contact_breaks 必须进 Word，且 `w:br` 在个人主页之前。"""
    resume_id = _create_resume(client)
    xml = _document_xml(
        _bundle_docx(client, resume_id, format_config={"contact_breaks": ["personal_website"]})
    )

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1, f"个人主页前应有且只有一个强制换行，实际 {len(breaks)} 个"
    github_at = xml.find("GitHub：https://github.example.com/demo")
    website_at = xml.find("个人主页：https://demo.example.com/very/long/path")
    assert github_at != -1 and website_at != -1, "页头联系方式字段没有进 Word"
    assert github_at < breaks[0] < website_at, "w:br 没有落在 GitHub 与个人主页之间"


def test_bundle_docx_reads_contact_breaks_saved_on_the_record(client):
    """已保存到记录的版式：请求不带 format_config 时也要从库里读到 contact_breaks。"""
    resume_id = _create_resume(client)
    detail = client.get(f"/api/resumes/{resume_id}").json()
    patch = {
        "template": detail["template"],
        "format_name": detail.get("format_name") or "",
        "page_limit": detail["page_limit"],
        "font_scale": detail["font_scale"],
        "format_config": {"contact_breaks": ["personal_website"]},
        "language": detail.get("language") or "zh-CN",
    }
    saved = client.patch(f"/api/resumes/{resume_id}/layout", json=patch)
    assert saved.status_code == 200, saved.text
    assert saved.json()["format_config"]["contact_breaks"] == ["personal_website"]

    xml = _document_xml(_bundle_docx(client, resume_id))  # 不带 format_config

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1, "记录的 contact_breaks 没有进入 Word"
    assert xml.find("GitHub：") < breaks[0] < xml.find("个人主页：")


def test_bundle_docx_without_contact_breaks_keeps_the_old_single_line(client):
    """旧简历（没有这个键）：仍然**一组**、字段一个不丢，但组内按可用宽度装行。

    2026-11 #9 有意变更：Word 与 PDF 共用 `pack_contact_lines`，"同一联系方式组内按可用
    宽度装行"取代了"整组一段交给 Word 自由断行"（本文件头有完整理由）。所以断言从
    "零个 `w:br`、文本连续"改成新契约：

    1. 联系方式仍只占**一个**段落（没有 `contact_breaks` = 一组，组间不合并也不新增）；
    2. `w:br` 的数量 == 可用宽度贪心复算出的行数 − 1，且逐行文本与复算结果一致；
    3. 六个字段不丢不重、顺序不变、且**整体落在某一行里**（装行只发生在字段边界）；
    4. 内容比一行宽时确实分成多行（不缩字号、不把内容压进一行）。
    """
    resume_id = _create_resume(client)
    detail = client.get(f"/api/resumes/{resume_id}").json()
    assert detail.get("format_config", {}).get("contact_breaks") in (None, []), (
        "本用例的前提是记录里没有 contact_breaks"
    )
    docx_bytes = _bundle_docx(client, resume_id)  # 不带 format_config
    xml = _document_xml(docx_bytes)

    # 1) 仍然只有一个联系方式段落。
    lines = _contact_paragraph_lines(docx_bytes)

    # 2) `w:br` 数 == 贪心复算值（行数 − 1），且逐行一致。
    expected_lines, measured = _expected_contact_lines(detail)
    assert lines == expected_lines, f"行分布与按宽度复算的结果不一致：{lines} != {expected_lines}"
    assert len(_force_break_positions(xml)) == len(expected_lines) - 1

    # 3) 字段不丢不重、顺序不变、不被劈开（整字段落在一行内）。
    fields_in_order = [
        "13800000000",
        "demo@example.com",
        "上海",
        "2001",
        "GitHub：https://github.example.com/demo",
        "个人主页：https://demo.example.com/very/long/path",
    ]
    line_indexes: list[int] = []
    for value in fields_in_order:
        occurrences = sum(line.count(value) for line in lines)
        assert occurrences == 1, f"字段 {value!r} 出现了 {occurrences} 次（应恰好一次）"
        line_indexes.append(next(index for index, line in enumerate(lines) if value in line))
    assert line_indexes == sorted(line_indexes), "字段顺序被打乱了"
    # 组间不合并：这里只有一组，所以行数不会超过"字段个数"。
    assert len(lines) <= len(fields_in_order)
    # 没有多余的空白行（避免"空 `w:br`"这种假换行）。
    assert all(line.strip() for line in lines)

    # 4) 量得到宽度时必须真的分多行：字段不缩、内容不被压进一行。
    if measured:
        assert len(lines) > 1, f"内容明显比一行宽，却只排了 {len(lines)} 行：{lines}"
    # 每个字段的原文都完整进 Word（长度不变，不是被截断/缩写）。
    for value in fields_in_order:
        assert value in xml


def test_single_format_export_endpoint_also_honours_contact_breaks(client):
    """旧的「单格式下载」POST /export 也走同一份 Word 渲染；两条下载入口口径必须一致。"""
    resume_id = _create_resume(client)
    response = client.post(
        f"/api/resumes/{resume_id}/export",
        json={"format": "docx", "format_config": {"contact_breaks": ["personal_website"]}},
    )
    assert response.status_code == 200, response.text
    xml = _document_xml(response.content)

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1
    assert xml.find("GitHub：") < breaks[0] < xml.find("个人主页：")


def test_bundle_docx_forced_break_can_target_a_middle_field(client):
    """换行目标不是最后一个字段时同样生效（README：在任意字段前强制换行）。"""
    resume_id = _create_resume(client)
    xml = _document_xml(_bundle_docx(client, resume_id, format_config={"contact_breaks": ["city"]}))

    breaks = _force_break_positions(xml)
    assert len(breaks) == 1
    email_at = xml.find("demo@example.com")
    city_at = xml.find("上海")
    assert email_at != -1 and city_at != -1
    assert email_at < breaks[0] < city_at, "w:br 没有落在邮箱与城市之间"
