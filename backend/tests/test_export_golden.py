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
from app.schemas.resume import ResumeContent
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

MANIFEST_PATH = Path(__file__).parent / "fixtures" / "export_golden" / "manifest.json"

# ===== 黄金样本（纯虚构；对抗性内容：长公司名 / 长链接 / 极长 bullet / 中文） =====

ZH_URL = "https://linzhiyuan-dev.example.com/works/system-design-portfolio"
EN_URL = "https://alex-johnson-dev.example.com/projects/open-source/contributions/2024"


def short_zh() -> ResumeContent:
    """1 页中文样本：长公司名、长链接、一条跨行折行的极长 bullet。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验，长期负责高并发交易系统的架构设计与稳定性治理。",
        experience=[
            {
                "company": "云梯智联科技有限公司",
                "role": "高级后端工程师",
                "start_date": "2018-01",
                "end_date": "2024-12",
                "description": [
                    "负责核心交易链路的设计与落地，覆盖网关鉴权、订单状态机与幂等补偿，"
                    "推动跨团队接口契约评审，上线后该链路全年可用性达到四个九，"
                    "兜底策略上线后资损为零，相关方案沉淀为团队标准接入文档。",
                ],
            }
        ],
        projects=[
            {
                "name": "统一网关平台",
                "role": "负责人",
                "tech_stack": ["Python", "FastAPI", "MySQL"],
                "description": ["面向全公司的统一接入网关与配额管理，设计文档见 " + ZH_URL + "。"],
                "highlights": ["灰度放量与回滚预案演练覆盖全部核心服务。"],
            }
        ],
        skills=[{"name": "Python", "level": "精通"}, {"name": "MySQL", "level": "精通"}],
        education=[{"school": "星辰理工大学", "major": "计算机科学与技术", "degree": "本科"}],
        personal_website=ZH_URL,
    )


def short_en() -> ResumeContent:
    """1 页英文样本：长公司名、长链接、长 bullet（ASCII 无中文字体路径）。

    **必须带 `github`**：页头的 `GitHub：…` 是 `_resume_sections.j2` 与 PDF `_draw_resume`
    都单独拼的一段，此前黄金矩阵里没有任何 case 填 github（只有 `personal_website`），于是
    `GitHub：` 这个前缀在 PDF 里断掉也不会有人发现。探针与指纹都锁住它。
    """
    return ResumeContent(
        name="Alex Johnson",
        phone="13900005678",
        email="alex.johnson@example.com",
        city="Hangzhou",
        github="https://github.com/alex-johnson-dev",
        job_intent="Senior Backend Engineer",
        summary="Ten years of backend engineering across high-throughput commerce systems.",
        experience=[
            {
                "company": "International Cloud Commerce Systems Division",
                "role": "Senior Backend Engineer",
                "start_date": "2018-01",
                "end_date": "2024-12",
                "description": [
                    "Owned the design and delivery of the order-state pipeline covering "
                    "gateway authentication, idempotency guarantees and compensation flows; "
                    "drove cross-team contract reviews and kept the ledger path at four nines "
                    "of availability for three consecutive years. Full portfolio: " + EN_URL,
                ],
            }
        ],
        skills=[{"name": "Python", "level": "Expert"}, {"name": "MySQL", "level": "Expert"}],
        education=[{"school": "Stellar Polytechnic University", "major": "Computer Science", "degree": "BSc"}],
        personal_website=EN_URL,
    )


def _long_experiences(lang: str) -> list[dict]:
    """8 段经历 × 3 条长 bullet：让内容在字号缩放后仍稳定超出 2 页。"""
    items = []
    for i in range(8):
        if lang == "zh":
            company = f"云梯智联科技有限公司第{i}事业部"
            bullets = [
                f"负责核心交易链路第{i}模块的设计与落地，覆盖网关鉴权、订单状态机与幂等补偿，"
                "推动跨团队接口契约评审，上线后该链路全年可用性达到四个九，兜底策略上线后资损为零，"
                "相关方案沉淀为团队标准接入文档并被三个兄弟部门复用。",
                f"主导第{i}代索引重构与慢查询治理，将 P99 延迟从 800ms 压到 60ms，"
                "期间完成双写切换、灰度放量与回滚预案演练，并输出压测报告与容量规划模型。",
                f"搭建第{i}套自动化回归与告警体系，接入全链路追踪，"
                "故障平均定位时间从半小时缩短到三分钟，次年该体系推广到全部核心服务。",
            ]
        else:
            company = f"International Cloud Commerce Systems Division {i}"
            bullets = [
                f"Owned the design and delivery of the order-state pipeline for business unit {i}, "
                "covering gateway authentication, idempotency guarantees and compensation flows; "
                "drove cross-team contract reviews and kept the ledger path at four nines of "
                "availability for three consecutive years.",
                f"Led the generation-{i} index overhaul and slow-query remediation programme, "
                "reducing P99 latency from 800ms to 60ms; executed dual-write migration, "
                "progressive rollout and rollback drills, and published the capacity planning model.",
                f"Built the automated regression and alerting platform for unit {i}, integrating "
                "distributed tracing end to end; cut mean time to diagnosis from thirty minutes to "
                "three minutes and later rolled the platform out to every core service.",
            ]
        items.append({"company": company, "role": f"Senior Backend Engineer {i}", "description": bullets})
    return items


def long_zh() -> ResumeContent:
    """3 页中文样本：内容量确保 page_limit=3 下真实渲染 3 页。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        summary="十年后端开发经验，长期负责高并发交易系统的架构设计与稳定性治理，"
        "作品集：" + ZH_URL,
        experience=_long_experiences("zh"),
        skills=[
            {"name": "Python", "level": "精通"},
            {"name": "MySQL", "level": "精通"},
            {"name": "Redis", "level": "熟练"},
            {"name": "Kafka", "level": "熟练"},
            {"name": "Kubernetes", "level": "掌握"},
        ],
        personal_website=ZH_URL,
    )


def long_en() -> ResumeContent:
    """3 页英文样本。"""
    return ResumeContent(
        name="Alex Johnson",
        phone="13900005678",
        email="alex.johnson@example.com",
        city="Hangzhou",
        job_intent="Senior Backend Engineer",
        summary="Ten years of backend engineering across high-throughput commerce systems. "
        "Portfolio: " + EN_URL,
        experience=_long_experiences("en"),
        skills=[
            {"name": "Python", "level": "Expert"},
            {"name": "MySQL", "level": "Expert"},
            {"name": "Redis", "level": "Advanced"},
            {"name": "Kafka", "level": "Advanced"},
            {"name": "Kubernetes", "level": "Competent"},
        ],
        personal_website=EN_URL,
    )


SAMPLES = {"short_zh": short_zh, "short_en": short_en, "long_zh": long_zh, "long_en": long_en}


@dataclass(frozen=True)
class GoldenCase:
    """矩阵一个 case：格式 × 模板 × 样本 × 页数 × 水印 × 脱敏。"""

    case_id: str
    fmt: str
    template: str
    sample: str
    page_limit: int = 1
    watermark: str = ""
    redact: bool = False


CASES: list[GoldenCase] = [
    # PDF 8 例：2 模板 × 中/英 × 1/3 页 × 水印开/关 × 脱敏开/关（组合采样，每维 ≥2 次）
    GoldenCase("pdf-classic-zh-1p-baseline", "pdf", "classic", "short_zh"),
    GoldenCase("pdf-classic-zh-1p-watermark", "pdf", "classic", "short_zh", watermark="内部使用"),
    GoldenCase("pdf-classic-zh-1p-redact", "pdf", "classic", "short_zh", redact=True),
    GoldenCase("pdf-modern-zh-1p-watermark-redact", "pdf", "modern", "short_zh", watermark="内部使用", redact=True),
    GoldenCase("pdf-classic-en-1p-baseline", "pdf", "classic", "short_en"),
    GoldenCase("pdf-classic-en-3p-baseline", "pdf", "classic", "long_en", page_limit=3),
    GoldenCase("pdf-modern-en-3p-watermark", "pdf", "modern", "long_en", page_limit=3, watermark="内部使用"),
    GoldenCase("pdf-classic-zh-3p-redact", "pdf", "classic", "long_zh", page_limit=3, redact=True),
    # HTML 2 例
    GoldenCase("html-modern-zh-baseline", "html", "modern", "short_zh"),
    GoldenCase("html-classic-zh-watermark-redact", "html", "classic", "short_zh", watermark="内部使用", redact=True),
    # Word 2 例
    GoldenCase("docx-modern-zh-baseline", "docx", "modern", "short_zh"),
    GoldenCase("docx-classic-zh-redact", "docx", "classic", "short_zh", redact=True),
    # MD / TXT / JSON 3 例
    GoldenCase("md-classic-zh-baseline", "md", "classic", "short_zh"),
    GoldenCase("txt-modern-zh-redact", "txt", "modern", "short_zh", redact=True),
    GoldenCase("json-classic-en-redact", "json", "classic", "short_en", redact=True),
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
    return build_export(request, SAMPLES[case.sample](), RenderContext(template=case.template))


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
    assert baseline != render_config_fingerprint(ExportRequest(format="pdf", watermark="内部使用"), context)
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
