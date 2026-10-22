# SPDX-License-Identifier: Apache-2.0
"""RF-16 黄金导出矩阵：以内容级校验钉住六种导出格式的质量下限。

**校验口径（红线）**：这里做的是**内容完整性**校验——PDF 可打开、页数与设定一致、
文字可提取且关键内容不丢、中文不乱码、脱敏不残留（正文与元数据）。它**不是** ATS
认证，不承诺"所有 ATS 通过"。视觉回归（字体/浏览器渲染像素）与跨 OS 字体差异不在
本批：没有固定视口与字体基线，等 CI 提供固定渲染环境后再补——不伪装已覆盖。

**确定性纪律**：PDF 带创建时间戳与字体子集名，字节级比对必然假红。本文件只比对
语义量：页数、元数据键值、**规范化提取文本**（去除全部空白）中的关键探针与指纹。
基线指纹是提取文本的 sha256（内容哈希），不是文件字节哈希。

**基线两阶段**：``fixtures/export_golden/manifest.json`` 缺失（或缺 case）时，测试
自动生成基线并 xfail 提示；基线在库后逐 case 比对指纹，意外漂移即失败——重导出
结果被模板/管线改动悄悄改变时，这里最先知道。
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import urllib.parse
import zipfile
from dataclasses import dataclass
from functools import cache
from pathlib import Path

import pypdf
import pytest
from app.services.export_pipeline import (
    ExportArtifact,
    ExportDelivery,
    ExportRequest,
    RenderContext,
    build_export,
    build_export_delivery,
    render_config_fingerprint,
)
from app.services.privacy import MASK, RedactionOptions
from tests.export_golden_samples import (
    EN_URL,
    SAMPLES,
    ZH_URL,
    short_zh,
)

MANIFEST_PATH = Path(__file__).parent / "fixtures" / "export_golden" / "manifest.json"




@dataclass(frozen=True)
class GoldenCase:
    """矩阵一个 case：格式 × 模板 × 样本 × 页数 × 水印 × 脱敏 × 纸面语言。"""

    case_id: str
    fmt: str
    template: str
    sample: str
    page_limit: int = 1
    watermark: str = ""
    redact: bool = False
    # 纸面固定文案（分区标题 / 字段前缀 / 分隔符）用哪种语言。缺省 zh-CN = 历史输出。
    language: str = "zh-CN"


CASES: list[GoldenCase] = [
    # PDF 8 例：2 模板 × 中/英 × 1/3 页 × 水印开/关 × 脱敏开/关（组合采样，每维 ≥2 次）
    GoldenCase("pdf-classic-zh-1p-baseline", "pdf", "classic", "short_zh"),
    GoldenCase("pdf-classic-zh-1p-watermark", "pdf", "classic", "short_zh", watermark="内部使用"),
    GoldenCase("pdf-classic-zh-1p-redact", "pdf", "classic", "short_zh", redact=True),
    GoldenCase(
        "pdf-modern-zh-1p-watermark-redact",
        "pdf",
        "modern",
        "short_zh",
        watermark="内部使用",
        redact=True,
    ),
    GoldenCase("pdf-classic-en-1p-baseline", "pdf", "classic", "short_en"),
    GoldenCase("pdf-classic-en-3p-baseline", "pdf", "classic", "long_en", page_limit=3),
    GoldenCase(
        "pdf-modern-en-3p-watermark", "pdf", "modern", "long_en", page_limit=3, watermark="内部使用"
    ),
    GoldenCase("pdf-classic-zh-3p-redact", "pdf", "classic", "long_zh", page_limit=3, redact=True),
    # HTML 2 例
    GoldenCase("html-modern-zh-baseline", "html", "modern", "short_zh"),
    GoldenCase(
        "html-classic-zh-watermark-redact",
        "html",
        "classic",
        "short_zh",
        watermark="内部使用",
        redact=True,
    ),
    # Word 2 例
    GoldenCase("docx-modern-zh-baseline", "docx", "modern", "short_zh"),
    GoldenCase("docx-classic-zh-redact", "docx", "classic", "short_zh", redact=True),
    # MD / TXT / JSON 3 例
    GoldenCase("md-classic-zh-baseline", "md", "classic", "short_zh"),
    GoldenCase("txt-modern-zh-redact", "txt", "modern", "short_zh", redact=True),
    GoldenCase("json-classic-en-redact", "json", "classic", "short_en", redact=True),
    # 纸面语言（A 包）：同内容、同模板，只把分区标题/字段前缀换成英文。
    # 这两条钉的是"语言真的贯穿到产物里"，而不是"渲染器接受了这个参数"。
    GoldenCase("pdf-classic-en-language", "pdf", "classic", "short_en", language="en-US"),
    GoldenCase("docx-classic-en-language", "docx", "classic", "short_en", language="en-US"),
]

CASE_IDS = [case.case_id for case in CASES]
CASE_MAP = {case.case_id: case for case in CASES}


# ===== 产物构建与语义量提取 =====


@cache
def _artifact(case_id: str) -> ExportArtifact:
    case = CASE_MAP[case_id]
    request = ExportRequest(
        format=case.fmt,
        watermark=case.watermark,
        redact=case.redact,
        redact_options=RedactionOptions() if case.redact else None,
        page_limit=case.page_limit if case.page_limit != 1 else None,
    )
    return build_export(
        request,
        SAMPLES[case.sample](),
        RenderContext(template=case.template, language=case.language),
    )


def _normalize(text: str) -> str:
    """去除全部空白：提取文本的换行/空格插入不影响探针与指纹。"""
    return re.sub(r"\s+", "", text)


def _semantic_text(fmt: str, content: bytes) -> str:
    """按格式提取「人类可读正文」：PDF 走 pypdf，docx 剥 XML 标签，html 剥标签，其余原样。"""
    if fmt == "pdf":
        reader = pypdf.PdfReader(io.BytesIO(content))
        return "".join(page.extract_text() or "" for page in reader.pages)
    if fmt == "docx":
        with zipfile.ZipFile(io.BytesIO(content)) as bundle:
            xml = bundle.read("word/document.xml").decode("utf-8")
        return re.sub(r"<[^>]+>", "", xml)
    text = content.decode("utf-8")
    if fmt == "html":
        # 版式与行为（`<style>` / `<script>`）不是"正文"。
        #
        # 指纹的用途是"人看得见的内容有没有变"，而此前只剥标签、把样式表与自适应脚本的
        # 源码也留在了文本里：改一行 CSS 或给脚本加一句守卫，指纹就红成"内容变了"
        # （2026-10-21 实际踩到——给 `--fit-scale` 补一行注释，text_chars 从 4179 跳到 4405）。
        # 先整块剔除这两类元素，再剥标签，指纹才真正只跟着正文走。
        text = re.sub(r"<(script|style)\b[^>]*>.*?</\1\s*>", "", text, flags=re.S | re.I)
        text = re.sub(r"<[^>]+>", "", text)
    return text


def _probes(case: GoldenCase) -> list[str]:
    """该 case 应在提取文本中出现的关键内容探针（脱敏 case 只探未被遮罩的内容）。"""
    url = ZH_URL if case.sample.endswith("zh") else EN_URL
    # 姓名（QA 验收补项）：非脱敏 case 姓名必须完整在场（探针在去空白文本上匹配）。
    name = "林致远" if case.sample.endswith("zh") else "AlexJohnson"
    skill = "Python"
    bullets = {
        "zh": ("负责核心交易链路", "资损为零"),
        "en": ("Ownedthedesignanddelivery", "threeconsecutiveyears"),
    }
    # 探针在"去空白"文本上匹配，英文 bullet 片段按去空白后的形态给出。
    head, tail = bullets["zh" if case.sample.endswith("zh") else "en"]
    head = re.sub(r"\s+", "", head)
    tail = re.sub(r"\s+", "", tail)
    if case.fmt == "pdf" and case.sample.startswith("short"):
        company = (
            "云梯智联科技有限公司"
            if case.sample.endswith("zh")
            else "InternationalCloudCommerceSystemsDivision"
        )
    else:
        company = ""
    probes = [name, skill, url, head, tail]
    if company:
        probes.append(company)
    return [p for p in probes if p]


def _pii(case: GoldenCase) -> list[str]:
    """脱敏 case 中必须消失的字段值。"""
    sample = SAMPLES[case.sample]()
    return [v for v in (sample.name, sample.phone, sample.email, sample.experience[0].company) if v]


# ===== 黄金矩阵用例 =====


@pytest.mark.parametrize("case_id", CASE_IDS)
def test_golden_export_case(case_id: str):
    """逐 case 校验：magic/可打开/页数/关键内容在场/脱敏不残留/无占位符。"""
    case = CASE_MAP[case_id]
    artifact = _artifact(case_id)
    fmt = case.fmt

    if fmt == "pdf":
        assert artifact.content[:5] == b"%PDF-", "PDF magic bytes 缺失"
        reader = pypdf.PdfReader(io.BytesIO(artifact.content))
        assert len(reader.pages) == case.page_limit, "PDF 页数与设定不一致"
        assert artifact.pages == case.page_limit
        meta = {str(k): str(v) for k, v in (reader.metadata or {}).items()}
    elif fmt == "docx":
        assert artifact.content[:2] == b"PK", "docx zip magic 缺失"
        meta = {}
    else:
        meta = {}

    if fmt in ("html", "md", "txt", "json"):
        artifact.content.decode("utf-8")  # 文本类格式先过一遍解码：解码失败即编码坏档
    compact = _normalize(_semantic_text(fmt, artifact.content))

    # 关键内容在场：姓名/技能/长链接/极长 bullet 首尾片段（脱敏 case 由 _probes 过滤）。
    if not case.redact:
        for probe in _probes(case):
            assert probe in compact, f"关键内容缺失：{probe!r}"
        if case.sample.endswith("zh"):
            assert "订单状态机" in compact or "交易链路" in compact, "中文提取疑似乱码/丢字"

    # 脱敏：PII 不在提取文本，也不在 PDF 元数据。占位符在场只对原样保留字符的格式
    # 断言（html/md/json/docx）；PDF 与 txt 的提取/剥标记会吞掉星号（提取出 `*`），
    # 在那里 PII 消失本身就是安全性质，不伪assert占位符字形。
    if case.redact:
        for pii in _pii(case):
            assert pii not in compact, f"脱敏后 PII 仍在正文：{pii!r}"
        if fmt in ("html", "md", "json", "docx"):
            assert MASK in compact, "脱敏占位符未出现"
        for key, value in meta.items():
            for pii in _pii(case):
                assert pii not in value, f"脱敏后 PII 泄漏进 PDF 元数据 {key}"
    if case.fmt == "pdf":
        for key, value in meta.items():
            assert "13800001234" not in value and "example.com" not in value, (
                f"元数据 {key} 含敏感值"
            )

    # 水印：PDF/HTML 的水印文案必须真实出现在产物里。
    if case.watermark:
        if fmt == "pdf":
            assert case.watermark in compact, "PDF 水印文案未出现在页面文本中"
        elif fmt == "html":
            raw = artifact.content.decode("utf-8")
            assert "background-repeat:repeat" in raw
            assert case.watermark in urllib.parse.unquote(raw), "HTML 水印文案未注入"

    # HTML 专项：charset 声明 + 无占位符/模板残留。
    if fmt == "html":
        raw = artifact.content.decode("utf-8")
        assert "charset" in raw.lower(), "HTML 缺 charset 声明"
        for residue in ("{name}", "{company}", "{{", "}}", "TODO"):
            assert residue not in raw, f"HTML 存在占位符残留：{residue}"

    # JSON 专项：可解析且结构完整。
    if fmt == "json":
        payload = json.loads(artifact.content.decode("utf-8"))
        assert "skills" in payload and payload["skills"], "JSON 缺 skills 结构"
        assert payload["name"] == MASK

    # 文件名扩展名与格式一致（下载链路口径）。
    assert artifact.filename.endswith(f".{fmt}")


# ===== 内容指纹基线（两阶段） =====


def _fingerprints() -> dict[str, dict]:
    """每 case 的语义指纹：页数 + 规范化提取文本的 sha256 与长度。"""
    result: dict[str, dict] = {}
    for case in CASES:
        artifact = _artifact(case.case_id)
        text = _normalize(_semantic_text(case.fmt, artifact.content))
        result[case.case_id] = {
            "pages": artifact.pages,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(),
            "text_chars": len(text),
        }
    return result


def _write_manifest(fingerprints: dict[str, dict]) -> None:
    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "version": 1,
        "description": "RF-16 黄金导出矩阵内容指纹基线：页数 + 规范化提取文本 sha256（非文件字节哈希）。"
        "预期内的内容变更应显式重新生成本文件并连同改动一起评审。",
        "cases": fingerprints,
    }
    MANIFEST_PATH.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


def test_content_fingerprint_manifest():
    """基线在库则逐 case 比对；缺失/缺 case 则自动生成并 xfail（两阶段落地）。"""
    fingerprints = _fingerprints()
    stored_payload: dict = {}
    if MANIFEST_PATH.exists():
        stored_payload = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    stored: dict[str, dict] = stored_payload.get("cases", {})

    missing = sorted(set(fingerprints) - set(stored))
    if missing:
        _write_manifest(fingerprints)
        pytest.xfail(f"黄金基线缺失 {len(missing)} 个 case，已自动生成 manifest；重跑即纳入比对")

    mismatches = {
        cid: {"expected": stored[cid], "actual": fingerprints[cid]}
        for cid in fingerprints
        if stored[cid] != fingerprints[cid]
    }
    assert not mismatches, (
        "导出产物的语义指纹与基线不一致（提取文本或页数变了）。若是预期内的内容/版式改动，"
        "请重新生成 manifest 并在交付说明中写明原因："
        f"{json.dumps(mismatches, ensure_ascii=False, indent=2)}"
    )


# ===== 交付记录哈希（build_export 的并列出口，零破坏守卫） =====


def test_delivery_hashes_match_content():
    """content_sha256 与产物字节一致，来源 ID 原样透传。"""
    from hashlib import sha256 as _sha256

    delivery = build_export_delivery(
        ExportRequest(format="pdf"),
        short_zh(),
        RenderContext(template="classic"),
        source_resume_id=42,
    )
    assert isinstance(delivery, ExportDelivery)
    assert delivery.content_sha256 == _sha256(delivery.artifact.content).hexdigest()
    assert delivery.source_resume_id == 42
    assert delivery.artifact.filename.endswith(".pdf")


def test_delivery_config_fingerprint_is_stable_and_sensitive():
    """同一配置出同一指纹；版式/水印任一变化指纹随之变化。"""
    request = ExportRequest(format="pdf")
    context = RenderContext(template="classic")
    baseline = render_config_fingerprint(request, context)
    assert baseline == render_config_fingerprint(ExportRequest(format="pdf"), context)

    assert baseline != render_config_fingerprint(ExportRequest(format="pdf", page_limit=3), context)
    assert baseline != render_config_fingerprint(
        ExportRequest(format="pdf", watermark="内部使用"), context
    )
    assert baseline != render_config_fingerprint(
        ExportRequest(format="pdf", redact=True, redact_options=RedactionOptions()), context
    )
    assert baseline != render_config_fingerprint(request, RenderContext(template="modern"))


def test_build_export_signature_unchanged():
    """零破坏守卫：build_export 仍返回不带交付字段的 ExportArtifact。"""
    artifact = build_export(ExportRequest(format="txt"), short_zh(), RenderContext())
    assert isinstance(artifact, ExportArtifact)
    assert not hasattr(artifact, "content_sha256")
    assert "林致远" in artifact.content.decode("utf-8")


# ===== 默认参数下 HTML 不许多出任何新样式（2026-10-22 四向页边距 + 照片大小）=====
#
# 黄金基线只比"规范化提取文本的 sha256"，而 `_semantic_text` 会把 `<style>` 整块剔除——
# 所以"给 page_padding 补一条规则""照片系数写进 :root"这类**样式层**漂移，基线一条都抓不到。
# 这里补一条样式层的守卫：默认配置下不许有任何新东西，非默认配置时必须真的出现。


def test_default_html_has_no_new_css():
    """默认参数下的 HTML 不许出现新的 padding 覆盖、也不许出现照片系数变量。

    不比对整份 HTML 的字节：`csp_nonce` 每次都不同，逐字节比必然假红。这里比的是
    "这批新键有没有在产物里留下痕迹"——它们一个字符都不该留。
    """
    from app.services.exporter import render_html
    from app.services.resume.resume_template_format import format_css

    assert format_css({}) == ""
    html = render_html(short_zh(), template="classic", format_config={})
    # 模板本身写的是 `padding: 14mm;`（无 !important），凡是带 !important 的 padding 覆盖
    # 只可能来自 `format_css`。
    assert "padding: 14mm !important" not in html
    # `var(--photo-scale, 1)` 是模板里的回退写法（允许），`--photo-scale: ` 才是声明。
    assert "--photo-scale: " not in html
    assert "page_padding" not in html


def test_asymmetric_margins_and_photo_scale_do_reach_the_html():
    """上面那条的**正对照**：非默认配置必须真的落进产物，否则"没多出东西"就毫无意义。"""
    from app.services.exporter import render_html

    asymmetric = render_html(
        short_zh(),
        template="classic",
        format_config={"page_padding": 14, "page_padding_top": 8},
    )
    assert "body { padding: 8mm 14mm 14mm 14mm !important; }" in asymmetric

    scaled = render_html(short_zh(), template="classic", format_config={"photo_scale": 1.5})
    assert "--photo-scale: 1.5;" in scaled
    # 模板侧读的就是这个变量（缺键时回退 1，与今天等价）。
    assert "var(--photo-scale, 1)" in scaled


def test_html_lang_attribute_follows_the_language():
    """`<html lang>` 跟着简历语言走；缺省仍是 `zh-CN`，所以默认产物逐字不变。

    `lang` 不属于提取文本，黄金基线的指纹不受影响；仓库里也没有任何断言写过
    `lang="zh-CN"` 这个字面量——这是一条纯新增能力，不是行为变更。
    """
    from app.services.exporter import render_html

    assert '<html lang="zh-CN">' in render_html(short_zh(), template="classic")
    assert '<html lang="en-US">' in render_html(short_zh(), template="classic", language="en-US")
    # 认不出的值收口到 zh-CN（与纸面文案共用同一个 `normalize_language`）。
    assert '<html lang="zh-CN">' in render_html(short_zh(), template="classic", language="en")


