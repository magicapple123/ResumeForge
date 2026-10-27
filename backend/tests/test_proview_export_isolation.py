# SPDX-License-Identifier: Apache-2.0
"""W15-INT 产物级隔离：专业视图的辅助层不得进入正式导出产物。

背景：W15 的辅助线 / 灰度校样 / 裁剪预览都只写 iframe.contentDocument（编辑器里那次
预览的临时文档），纸面 HTML 由后端模板渲染、导出走同一条后端管线。前端侧证据
（ResumePreview.proview.test.tsx 断言 srcdoc 前后逐字一致 + 零导出通道）只能证明
"前端没把它塞进 HTML"，不能证明"后端产物里真的没有"。

本文件用真实导出管线（build_export，HTML/PDF/Word 三种格式）做交叉验证：

1. 辅助层标记（resume-proview / data-proview / object-view-box 等）在原始产物与
   提取文本里都不出现；
2. 对照组：同一份内容的正常正文关键探针必须完整在场（防止"导出成了空文件所以没有
   标记"这种假绿）。

只新增测试文件，不改任何既有后端源码/测试。辅助层是纯前端展示态，后端管线里本来就
没有这些键——本测试把"结构性不可能"钉成回归：将来谁把辅助层样式/标记写进模板，这里
会先红。
"""

from __future__ import annotations

import base64
import hashlib
import io
import re
import zipfile

import pypdf
from app.services.export_pipeline import ExportRequest, RenderContext, build_export
from PIL import Image
from tests.export_golden_samples import SAMPLES

# 只在专业视图（编辑器覆盖层）里出现的标记；任何一个出现在产物里都说明辅助层泄漏。
PROVIEW_MARKERS: tuple[str, ...] = (
    "resume-proview",
    "data-proview",
    "proview-guide",
    "is-proview-current",
    "object-view-box",
)

# 正文对照探针：来自 short_zh 样本（导出必须完整带上，否则"无标记"是假绿）。
CONTENT_PROBES: tuple[str, ...] = ("林致远", "Python")


def _build(fmt: str):
    return build_export(
        ExportRequest(format=fmt),
        SAMPLES["short_zh"](),
        RenderContext(template="classic", language="zh-CN"),
    )


def _extract_text(fmt: str, content: bytes) -> str:
    """按格式提取人类可读文本（与 test_export_golden 同一口径，不另写渲染器）。"""
    if fmt == "pdf":
        reader = pypdf.PdfReader(io.BytesIO(content))
        return "".join(page.extract_text() or "" for page in reader.pages)
    if fmt == "docx":
        with zipfile.ZipFile(io.BytesIO(content)) as bundle:
            xml = bundle.read("word/document.xml").decode("utf-8")
        return re.sub(r"<[^>]+>", "", xml)
    text = content.decode("utf-8")
    if fmt == "html":
        text = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", text, flags=re.S | re.I)
        return re.sub(r"<[^>]+>", "", text)
    return text


def _strip_nonce(html: str) -> str:
    """HTML 的 CSP nonce 每次随机：比较"是否退回原图"前先归一化，否则永远不相等。"""
    stripped = re.sub(r'nonce="[0-9a-f]+"', 'nonce="<random>"', html)
    return re.sub(r"nonce-[0-9a-f]+", "nonce-<random>", stripped)


def _assert_no_markers(label: str, haystack: bytes | str) -> None:
    if isinstance(haystack, bytes):
        for marker in PROVIEW_MARKERS:
            assert marker.encode("utf-8") not in haystack, f"{label} 产物含辅助层标记：{marker}"
        return
    for marker in PROVIEW_MARKERS:
        assert marker not in haystack, f"{label} 产物含辅助层标记：{marker}"


def _assert_content_present(label: str, text: str) -> None:
    compact = re.sub(r"\s+", "", text)
    for probe in CONTENT_PROBES:
        assert probe in compact, f"{label} 对照组正文缺失：{probe!r}"


def test_html_export_has_no_proview_overlay() -> None:
    artifact = _build("html")
    raw = artifact.content.decode("utf-8")
    _assert_no_markers("HTML", raw)
    text = _extract_text("html", artifact.content)
    _assert_no_markers("HTML 提取文本", text)
    _assert_content_present("HTML", text)


def test_pdf_export_has_no_proview_overlay() -> None:
    artifact = _build("pdf")
    assert artifact.content[:5] == b"%PDF-"
    # 原始字节：PDF 的文本/元数据流都在里面，泄漏的样式字符串同样会命中。
    _assert_no_markers("PDF 原始字节", artifact.content)
    text = _extract_text("pdf", artifact.content)
    _assert_no_markers("PDF 提取文本", text)
    _assert_content_present("PDF", text)


def test_docx_export_has_no_proview_overlay() -> None:
    artifact = _build("docx")
    assert artifact.content[:2] == b"PK"
    _assert_no_markers("Word 原始字节", artifact.content)
    text = _extract_text("docx", artifact.content)
    _assert_no_markers("Word 提取文本", text)
    _assert_content_present("Word", text)


# ===== photo_crop（D09）产物消费：HTML / PDF / Word 按裁剪渲染 =====


def _photo_with_crop() -> tuple[str, dict]:
    """确定性 40×20 PNG + 与后端同口径的 photo_crop 域（sha256 是 data URL 字符串的哈希）。"""
    # 必须用**图案**而不是纯色：纯色图裁前裁后像素完全相同，会让"裁剪是否生效"
    # 出现假阴性；派生图还会重新编码，图案是唯一能从产物像素上验证裁剪位置的办法。
    image = Image.new("RGB", (40, 20))
    image.putdata(
        [
            ((x * 6) % 256, (y * 12) % 256, (x * 3 + y * 7) % 256)
            for y in range(20)
            for x in range(40)
        ]
    )
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    photo = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
    crop = {
        "version": 1,
        "source": {
            "sha256": hashlib.sha256(photo.encode("utf-8")).hexdigest(),
            "width": 40,
            "height": 20,
        },
        # 刻意用**非居中**裁剪：左半块与"居中裁剪"得到的是不同像素，
        # 能证明 rect 真的被消费，而不是被某层默认取景盖掉。
        "rect": {"x": 0.0, "y": 0.0, "w": 0.5, "h": 1.0},
        "aspect": "free",
    }
    return photo, {"photo_crop": crop}


def _build_photo_export(fmt: str, format_config: dict):
    photo, _crop = _photo_with_crop()
    content = SAMPLES["short_zh"]().model_copy(update={"photo": photo})
    artifact = build_export(
        ExportRequest(format=fmt, format_config=format_config),
        content,
        RenderContext(template="classic", language="zh-CN"),
    )
    return photo, artifact


def _plain_photo_export(fmt: str):
    return _build_photo_export(fmt, {})


def _cropped_photo_export(fmt: str):
    _photo, crop_config = _photo_with_crop()
    return _build_photo_export(fmt, crop_config)


def test_html_export_consumes_photo_crop() -> None:
    photo, plain = _plain_photo_export("html")
    plain_html = plain.content.decode("utf-8")
    _, cropped = _cropped_photo_export("html")
    cropped_html = cropped.content.decode("utf-8")

    # 无裁剪时原图 data URL 原样进 HTML；有裁剪时被派生图替换（原图不再出现）。
    assert photo in plain_html, "对照组：不裁剪时原图应进入 HTML"
    assert photo not in cropped_html, "裁剪后 HTML 仍在使用原图（裁剪未生效）"
    assert cropped_html != plain_html
    assert "data:image/png;base64," in cropped_html
    _assert_no_markers("裁剪后 HTML", cropped_html)


def test_pdf_export_consumes_photo_crop() -> None:
    plain_photo, plain = _plain_photo_export("pdf")
    _cropped_photo, cropped = _cropped_photo_export("pdf")
    assert plain.content[:5] == b"%PDF-"
    assert cropped.content[:5] == b"%PDF-"
    # 同一份内容，只有 photo_crop 不同 → 嵌入的图片对象不同，产物字节必然不同。
    assert plain.content != cropped.content, "裁剪参数没有进入 PDF 产物"
    # 正文不受裁剪影响（对照：中文关键内容仍在）。
    text = _extract_text("pdf", cropped.content)
    _assert_content_present("裁剪后 PDF", text)
    _assert_no_markers("裁剪后 PDF 原始字节", cropped.content)
    assert plain_photo


def test_docx_export_consumes_photo_crop() -> None:
    _plain_photo, plain = _plain_photo_export("docx")
    _cropped_photo, cropped = _cropped_photo_export("docx")
    assert plain.content[:2] == b"PK"
    assert cropped.content != plain.content, "裁剪参数没有进入 Word 产物"
    with zipfile.ZipFile(io.BytesIO(cropped.content)) as bundle:
        media = [name for name in bundle.namelist() if name.startswith("word/media/")]
        assert media, "Word 产物缺少照片媒体"
        image_bytes = bundle.read(media[0])
        # 派生图统一转 PNG；与原始图片内容不同。
        assert image_bytes[:8] == b"\x89PNG\r\n\x1a\n"
    text = _extract_text("docx", cropped.content)
    _assert_content_present("裁剪后 Word", text)
    _assert_no_markers("裁剪后 Word 原始字节", cropped.content)


def test_invalid_photo_crop_is_dropped_not_applied() -> None:
    """哈希与当前照片不一致（换图/旧参数）→ 白名单丢弃整个域，产物退回原图。"""
    _photo, plain = _plain_photo_export("html")
    _photo2, crop_config = _photo_with_crop()
    stale = {
        "photo_crop": {
            **crop_config["photo_crop"],
            "source": {**crop_config["photo_crop"]["source"], "sha256": "0" * 64},
        }
    }
    _photo3, with_stale = _build_photo_export("html", stale)
    plain_html = _strip_nonce(plain.content.decode("utf-8"))
    stale_html = _strip_nonce(with_stale.content.decode("utf-8"))
    assert plain_html == stale_html, "失效的裁剪域不应改变产物（应被丢弃、退回原图）"
    assert _photo in stale_html
