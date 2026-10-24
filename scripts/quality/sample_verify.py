# SPDX-License-Identifier: Apache-2.0
"""样例期望的**判定层**：把渲染产物与 Sample.expect 对照，输出结构化失败清单。

判定分两层：

1. 每份样例自己的期望（页数上限、溢出标记、文本 token、照片、加粗、转义……）；
2. 对**所有**样例都成立的全局不变量（页数与溢出自洽、JSON 往返、纯虚构数据、
   md/txt 的加粗标记语义……）。

失败不是"测试挂了"了事：每条失败带 sample_id + 检查名 + 实际值，check 命令把它们
打印成一张表，任何人都能照着复现。**不许**为了让报告变绿去改这里的判定口径。

渲染格式按"这份样例要验什么"裁剪（见 _formats_for）：HTML/Word 渲染很贵，边界样例
只在真的需要时才跑，否则 120 份全量检查会慢到没人愿意跑。
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any

from .sample_render import (
    DEFAULT_FORMATS,
    SUPPORTED_FORMATS,
    capture_missing_glyphs,
    docx_has_image,
    docx_text,
    extract_pdf_text,
    normalize_text,
    pdf_structure,
    render_artifacts,
)

# 纯虚构数据守卫：真实简历里常见的强标识符一律不允许出现在样例里。
_PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
_ID_CARD_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
_ALLOWED_EMAIL_DOMAINS = {"example.com", "example.org", "example.net"}
_ALLOWED_PHONE = "138-0000-0000"


@dataclass
class Failure:
    sample_id: str
    check: str
    detail: str

    def as_line(self) -> str:
        return f"[{self.sample_id}] {self.check}: {self.detail}"


@dataclass
class SampleReport:
    sample_id: str
    failures: list[Failure] = field(default_factory=list)
    observations: dict[str, Any] = field(default_factory=dict)


@dataclass
class VerifyReport:
    total: int = 0
    rendered: int = 0
    failures: list[Failure] = field(default_factory=list)
    observations: dict[str, Any] = field(default_factory=dict)
    pdf_extractors: dict[str, int] = field(default_factory=dict)
    # 每份样例的关键观测（页数/模板/缺失字形/提取器）：模板档案与 D12 报告引用它。
    per_sample: dict[str, dict[str, Any]] = field(default_factory=dict)

    @property
    def passed(self) -> bool:
        return not self.failures

    def summary(self) -> dict[str, Any]:
        return {
            "total": self.total,
            "rendered": self.rendered,
            "failures": len(self.failures),
            "passed": self.passed,
            "pdf_extractors": dict(sorted(self.pdf_extractors.items())),
            "observations": self.observations,
            "samples": self.per_sample,
        }


def _formats_for(sample) -> tuple[str, ...]:  # noqa: ANN001
    """按"这份样例要验什么"决定渲染哪些格式。

    - 迭代样例：六种格式全跑（含 json 往返），它们就是端到端最小集；
    - 边界样例：PDF（页数/溢出/照片/结构）+ md/txt（确定性文本 + 标记语义）；
      只有声明了 HTML 期望、或需要 HTML 参与 token 检查时补 HTML；
      照片/旧记录类补 Word（照片对象与 Word 文本）。
    """
    if sample.kind == "iteration":
        return (*DEFAULT_FORMATS, "json")
    formats: list[str] = ["pdf", "md", "txt"]
    expect = sample.expect
    needs_html = (
        bool(expect.html_contains)
        or bool(expect.html_excludes)
        or expect.bold_html is not None
        or expect.html_text_tokens is False
    )
    if needs_html:
        formats.append("html")
    if expect.photo is not None or expect.legacy_raw:
        formats.append("docx")
    return tuple(formats)


def _check_fictitious(sample, resume, report: SampleReport) -> None:  # noqa: ANN001
    dump = json.dumps(resume.model_dump(exclude={"photo"}), ensure_ascii=False)
    if _ID_CARD_RE.search(dump):
        report.failures.append(Failure(sample.sample_id, "pii", "出现疑似身份证号"))
    for phone in _PHONE_RE.findall(dump.replace(_ALLOWED_PHONE, "")):
        report.failures.append(Failure(sample.sample_id, "pii", f"出现疑似真实手机号：{phone}"))
    for domain in _EMAIL_RE.findall(dump):
        if domain.lower() not in _ALLOWED_EMAIL_DOMAINS:
            report.failures.append(
                Failure(sample.sample_id, "pii", f"出现非示例邮箱域名：{domain}")
            )


def _check_markdown_markers(sample, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    """加粗标记在两个文本产物里的**不同**契约。

    - Markdown 是标记语言：成对 ** 就是它的加粗语法，必须保留（导到渲染器里会变粗）；
    - TXT 是投递用最终产物：必须剥掉标记；而**落单**的 ** 属于用户真想印出来的
      字符，必须原样保留（resume_rich_text 的既定契约）。
    """
    expected_literal = sample.expect.literal_markers
    if expected_literal is None:
        return
    markdown = artifacts["md"].decode("utf-8", errors="replace")
    plain = artifacts["txt"].decode("utf-8", errors="replace")
    if expected_literal:
        if "**" not in plain:
            report.failures.append(
                Failure(sample.sample_id, "txt-literal-markers", "落单的 ** 应原样保留，实际被吞掉")
            )
        if "**" not in markdown:
            report.failures.append(
                Failure(sample.sample_id, "md-literal-markers", "落单的 ** 应原样保留，实际被吞掉")
            )
        return
    if "**" in plain:
        report.failures.append(
            Failure(sample.sample_id, "txt-literal-markers", "成对的 ** 应去标记，TXT 仍出现 **")
        )
    if "**" not in markdown:
        report.failures.append(
            Failure(sample.sample_id, "md-literal-markers", "成对的 ** 应保留为 Markdown 加粗语法")
        )


def _check_text_tokens(sample, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    tokens = sample.expect.text_tokens
    if not tokens:
        return
    sources = {
        "md": artifacts["md"].decode("utf-8", errors="replace"),
        "txt": artifacts["txt"].decode("utf-8", errors="replace"),
    }
    if "docx" in artifacts:
        sources["docx"] = docx_text(artifacts["docx"])
    if "html" in artifacts and sample.expect.html_text_tokens:
        sources["html"] = artifacts["html"].decode("utf-8", errors="replace")
    if "pdf" in artifacts:
        pdf_text, tool = extract_pdf_text(artifacts["pdf"])
        report.observations.setdefault("pdf_extractor", tool)
        sources["pdf"] = pdf_text
    for fmt, raw in sources.items():
        haystack = normalize_text(raw)
        for token in tokens:
            if normalize_text(token) not in haystack:
                report.failures.append(
                    Failure(sample.sample_id, f"{fmt}-text", f"缺少 token：{token!r}")
                )


def _check_html_expectations(sample, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    if "html" not in artifacts:
        if (
            sample.expect.html_contains
            or sample.expect.html_excludes
            or sample.expect.bold_html is not None
        ):
            report.failures.append(
                Failure(sample.sample_id, "html", "声明了 HTML 期望但本次没有渲染 HTML")
            )
        return
    html = artifacts["html"].decode("utf-8", errors="replace")
    for token in sample.expect.html_contains:
        if token not in html:
            report.failures.append(
                Failure(sample.sample_id, "html-escape", f"缺少转义后 token：{token!r}")
            )
    for token in sample.expect.html_excludes:
        if token in html:
            report.failures.append(
                Failure(sample.sample_id, "html-leak", f"HTML 出现应被转义/排除的原文：{token!r}")
            )
    if sample.expect.bold_html is not None:
        has_strong = "<strong>" in html
        if has_strong != sample.expect.bold_html:
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "html-bold",
                    f"<strong> 期望 {sample.expect.bold_html} 实际 {has_strong}",
                )
            )


def _check_pdf(
    sample,
    artifacts: dict[str, bytes],
    report: SampleReport,
    pdf_meta: dict[str, Any] | None = None,
) -> None:  # noqa: ANN001
    if "pdf" not in artifacts:
        return
    structure = pdf_structure(artifacts["pdf"])
    pages = structure["pages"]
    meta = pdf_meta or {}
    pages_needed = meta.get("pages_needed")
    limit = sample.page_limit
    report.observations["pdf_pages"] = pages
    report.observations["pdf_pages_needed"] = pages_needed
    report.observations["pdf_overflow"] = meta.get("overflow")
    if pages > limit:
        report.failures.append(
            Failure(
                sample.sample_id, "pdf-pages", f"页数 {pages} 超过 page_limit={limit}（截断失效）"
            )
        )
    if pages < 1:
        report.failures.append(Failure(sample.sample_id, "pdf-pages", "PDF 没有页"))
    if isinstance(pages_needed, int):
        # 全局不变量 1：交付产物 = 截断到上限后的结果。
        if pages != min(pages_needed, limit):
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "pdf-pages",
                    f"pages={pages} 应为 min(needed={pages_needed}, limit={limit})",
                )
            )
        # 全局不变量 2：overflow 必须与 pages_needed > limit 同义。
        if meta.get("overflow") != (pages_needed > limit):
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "pdf-overflow",
                    f"overflow={meta.get('overflow')} 与 needed={pages_needed}/limit={limit} 自相矛盾",
                )
            )
        # 样例声明的"故意超页"只在自然页数上判。
        if sample.expect.overflow is not None and meta.get("overflow") != sample.expect.overflow:
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "pdf-overflow",
                    f"overflow 期望 {sample.expect.overflow} 实际 {meta.get('overflow')}",
                )
            )
    if (
        sample.expect.max_pages is not None
        and pages_needed is not None
        and pages_needed > sample.expect.max_pages
    ):
        report.failures.append(
            Failure(
                sample.sample_id,
                "pdf-max-pages",
                f"自然排到 {pages_needed} 页，超过期望上限 {sample.expect.max_pages}",
            )
        )
    if sample.expect.photo is not None:
        has_image = structure["image_count"] > 0
        if has_image != sample.expect.photo:
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "pdf-photo",
                    f"图片对象期望 {sample.expect.photo} 实际 {has_image}",
                )
            )
    report.observations["pdf_structure"] = {
        "pages": pages,
        "images": structure["image_count"],
        "tagged": structure["tagged"],
        "lang": structure["lang"],
        "fonts": structure["fonts"],
    }


def _check_photo_other_formats(sample, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    if sample.expect.photo is None:
        return
    if "html" in artifacts:
        has_html_photo = 'class="profile-photo"' in artifacts["html"].decode(
            "utf-8", errors="replace"
        )
        if has_html_photo != sample.expect.photo:
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "html-photo",
                    f"HTML 照片期望 {sample.expect.photo} 实际 {has_html_photo}",
                )
            )
    if "docx" in artifacts:
        has_docx_image = docx_has_image(artifacts["docx"])
        if has_docx_image != sample.expect.photo:
            report.failures.append(
                Failure(
                    sample.sample_id,
                    "docx-photo",
                    f"Word 图片期望 {sample.expect.photo} 实际 {has_docx_image}",
                )
            )


def _check_legacy(sample, resume, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    """旧记录：未知键被忽略，且任何层级都不许凭空生成身份字段。"""
    if not sample.expect.legacy_raw:
        return
    dumped = resume.model_dump()
    if "legacy_extra" in dumped:
        report.failures.append(
            Failure(sample.sample_id, "legacy-unknown-key", "未知键被写回了内容")
        )
    for key in ("id", "point_ids"):
        if key in dumped:
            report.failures.append(
                Failure(sample.sample_id, "legacy-identity", f"顶层凭空出现 {key}")
            )
    for section in ("education", "experience", "campus_experience", "projects", "skills", "awards"):
        for index, item in enumerate(dumped.get(section) or []):
            for key in ("id", "point_ids"):
                if key in item:
                    report.failures.append(
                        Failure(
                            sample.sample_id,
                            "legacy-identity",
                            f"{section}[{index}] 凭空出现 {key}",
                        )
                    )


def _check_json_roundtrip(sample, artifacts: dict[str, bytes], report: SampleReport) -> None:  # noqa: ANN001
    if "json" not in artifacts:
        return
    payload = json.loads(artifacts["json"].decode("utf-8"))
    if payload.get("name") != sample.content_dict().get("name"):
        report.failures.append(
            Failure(sample.sample_id, "json-roundtrip", "导出 JSON 的 name 与内容不一致")
        )
    if "photo" in payload:
        report.failures.append(
            Failure(sample.sample_id, "json-roundtrip", "导出 JSON 不应包含照片 data URL")
        )


def _global_invariants(sample, report: SampleReport):  # noqa: ANN001
    """与渲染无关的全局性质：内容可校验、哈希稳定、纯虚构。"""
    from app.schemas.resume import ResumeContent
    from app.services.resume.resume_delivery import canonical_content_sha256

    content = sample.content_dict()
    try:
        resume = ResumeContent.model_validate(content)
    except Exception as exc:  # noqa: BLE001 - 内容不合法就是样例缺陷
        report.failures.append(
            Failure(sample.sample_id, "content-valid", f"无法通过 ResumeContent 校验：{exc}")
        )
        return None
    first = canonical_content_sha256(resume.model_dump())
    second = canonical_content_sha256(
        json.loads(json.dumps(resume.model_dump(), ensure_ascii=False))
    )
    if first != second:
        report.failures.append(
            Failure(sample.sample_id, "content-hash", "同一内容两次规范化哈希不一致")
        )
    _check_fictitious(sample, resume, report)
    return resume


def verify_sample(sample, extractor: str = "auto") -> SampleReport:  # noqa: ANN001
    """校验一份样例；渲染失败也记成失败（不抛异常，报告要能继续跑完其他样例）。"""
    report = SampleReport(sample_id=sample.sample_id)
    resume = _global_invariants(sample, report)
    if resume is None:
        return report
    pdf_meta: dict[str, Any] | None = None
    try:
        with capture_missing_glyphs() as glyphs:
            rendered = render_artifacts(sample, _formats_for(sample))
        artifacts = {fmt: artifact.content for fmt, artifact in rendered.items()}
        if "pdf" in rendered:
            pdf_meta = {
                "pages": rendered["pdf"].pages,
                "pages_needed": rendered["pdf"].pages_needed,
                "overflow": rendered["pdf"].overflow,
            }
        if sample.expect.missing_glyph_probe:
            report.observations["missing_glyphs"] = list(glyphs["missing_glyphs"])
    except Exception as exc:  # noqa: BLE001 - 渲染失败要进报告，不是中断整批
        report.failures.append(Failure(sample.sample_id, "render", f"{type(exc).__name__}: {exc}"))
        return report
    _check_pdf(sample, artifacts, report, pdf_meta)
    _check_text_tokens(sample, artifacts, report)
    _check_markdown_markers(sample, artifacts, report)
    _check_html_expectations(sample, artifacts, report)
    _check_photo_other_formats(sample, artifacts, report)
    _check_legacy(sample, resume, artifacts, report)
    _check_json_roundtrip(sample, artifacts, report)
    if "pdf" in artifacts:
        _text, tool = extract_pdf_text(artifacts["pdf"], extractor)
        report.observations.setdefault("pdf_extractor", tool)
    return report


def verify_corpus(samples, *, limit: int | None = None, extractor: str = "auto") -> VerifyReport:  # noqa: ANN001
    """逐份校验；limit 只影响渲染条数（用于快速内循环），不影响语料/manifest 一致性。"""
    result = VerifyReport(total=len(samples))
    for index, sample in enumerate(samples):
        if limit is not None and index >= limit:
            break
        report = verify_sample(sample, extractor)
        result.rendered += 1
        result.per_sample[sample.sample_id] = {
            "kind": sample.kind,
            "category": sample.category,
            "template": sample.template,
            "font_scale": sample.font_scale,
            "page_limit": sample.page_limit,
            "language": sample.language,
            "pages": report.observations.get("pdf_pages"),
            "pages_needed": report.observations.get("pdf_pages_needed"),
            "overflow": report.observations.get("pdf_overflow"),
            "pdf_extractor": report.observations.get("pdf_extractor"),
            "missing_glyphs": report.observations.get("missing_glyphs", []),
            "failed": bool(report.failures),
        }
        result.failures.extend(report.failures)
        tool = report.observations.get("pdf_extractor")
        if tool:
            result.pdf_extractors[tool] = result.pdf_extractors.get(tool, 0) + 1
        if report.observations.get("missing_glyphs"):
            result.observations.setdefault("missing_glyphs", {})[sample.sample_id] = (
                report.observations["missing_glyphs"]
            )
    return result


__all__ = [
    "Failure",
    "SampleReport",
    "SUPPORTED_FORMATS",
    "VerifyReport",
    "verify_corpus",
    "verify_sample",
]
