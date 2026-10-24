# SPDX-License-Identifier: Apache-2.0
"""W00/W20 合成样例库与 D12 研究工具的守卫测试。

这些用例只守护"样例资产本身可复现、可校验"，不重跑 120 份全量渲染（那是手动/CI 可选
命令：scripts/quality/generate_resume_samples.py check）。覆盖四件事：

1. 语料装配自洽：20 迭代 + 100 边界、id 唯一、13 类条数与声明一致、九套模板全覆盖；
2. 生成器可重复：两次生成的 manifest 逐字节相同、content 文件与 manifest 指纹一致；
3. 纯虚构：手机号/邮箱/证件号/链接域名都在示例白名单内；
4. 抽查渲染：迭代样例在页数上限内、Markdown 文本齐全；旧记录读入不生成身份字段；
   特殊符号在 HTML 里被转义；D12 结构结论（当前 PDF 未标记）有可复现事实。

PDF 相关用例带 needs_font 环境门（与仓库既有 test_export_labels 等一致：本机没有
中文字体时跳过的是"环境能力"，不是掩盖失败）。
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPTS_DIR = REPO_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from quality.generate_resume_samples import (  # noqa: E402
    build_manifest,
    compare_with_disk,
    manifest_json,
    write_corpus,
)
from quality.inspect_pdf_structure import inspect_pdf  # noqa: E402
from quality.sample_corpus import (  # noqa: E402
    CATEGORY_META,
    TOTAL_SAMPLE_COUNT,
    build_corpus,
    corpus_template_names,
)
from quality.sample_render import (  # noqa: E402
    extract_pdf_text,
    pdf_structure,
    render_artifacts,
    render_sample,
)

PHONE_RE = re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)")
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})")
ID_CARD_RE = re.compile(r"(?<!\d)\d{17}[\dXx](?!\d)")
ALLOWED_PHONE = "138-0000-0000"
ALLOWED_DOMAINS = {
    "example.com",
    "example.org",
    "example.net",
    "portfolio.example.com",
    "github.example.com",
    "resumeforge.local",
}


@pytest.fixture(scope="module")
def samples():
    return build_corpus()


@pytest.fixture(scope="module")
def manifest(samples):
    return build_manifest()


def _needs_font() -> bool:
    from app.services.pdf_exporter import font_available

    return font_available()


needs_font = pytest.mark.skipif(not _needs_font(), reason="本机没有可用的中文字体")


# ===== 1. 语料装配 =====


def test_corpus_has_20_iteration_and_100_boundary_samples(samples):
    counts = {"iteration": 0, "boundary": 0}
    for sample in samples:
        counts[sample.kind] += 1
    assert counts == {"iteration": 20, "boundary": 100}
    assert len(samples) == TOTAL_SAMPLE_COUNT == 120


def test_sample_ids_are_unique_and_ordered(samples):
    ids = [sample.sample_id for sample in samples]
    assert len(ids) == len(set(ids))
    assert ids[0] == "iter-01"
    assert ids[19] == "iter-20"
    assert ids[20] == "bound-001"
    assert ids[-1] == "bound-100"
    # 顺序稳定：同一进程内两次构建 id 序列一致
    assert [sample.sample_id for sample in build_corpus()] == ids


def test_category_counts_match_the_declared_metadata(samples):
    actual: dict[str, int] = {}
    for sample in samples:
        actual[sample.category] = actual.get(sample.category, 0) + 1
    declared = {key: meta["count"] for key, meta in CATEGORY_META.items()}
    assert actual == declared
    assert len(CATEGORY_META) == 14  # 1 个迭代类 + 13 个边界类
    assert sum(declared.values()) == TOTAL_SAMPLE_COUNT
    for key, meta in CATEGORY_META.items():
        assert meta["title"].strip()
        assert meta["coverage"], f"类别 {key} 没有覆盖点说明"


def test_corpus_covers_all_nine_templates_and_three_font_scales(samples):
    templates = set(corpus_template_names())
    assert templates == {
        "classic",
        "modern",
        "compact",
        "elegant",
        "minimal",
        "scholar",
        "technical",
        "editorial",
        "split",
    }
    assert {sample.font_scale for sample in samples} == {"small", "standard", "large"}
    assert {sample.language for sample in samples} >= {"zh-CN", "en-US"}
    assert any(sample.include_photo for sample in samples)
    assert any(not sample.include_photo for sample in samples)


# ===== 2. 生成器可重复 =====


def test_manifest_is_byte_identical_across_two_generations():
    first = manifest_json(build_manifest())
    second = manifest_json(build_manifest())
    assert first == second
    assert "\\r\\n" not in first
    # manifest 里不许出现时间戳 / 本机路径（否则不可复现）
    assert str(REPO_ROOT) not in first


def test_written_corpus_round_trips_through_compare_with_disk(tmp_path):
    write_corpus(tmp_path)
    assert (tmp_path / "manifest.json").is_file()
    assert (tmp_path / "manifest.md").is_file()
    content_files = sorted((tmp_path / "content").glob("*.json"))
    assert len(content_files) == TOTAL_SAMPLE_COUNT
    assert compare_with_disk(tmp_path) == []


def test_sample_content_files_match_manifest_fingerprints(tmp_path):
    from app.services.resume.resume_delivery import canonical_content_sha256

    manifest = write_corpus(tmp_path)
    for entry in manifest["samples"]:
        path = tmp_path / entry["content_file"]
        assert path.is_file(), entry["content_file"]
        content = json.loads(path.read_text(encoding="utf-8"))
        from app.schemas.resume import ResumeContent

        normalized = ResumeContent.model_validate(content).model_dump()
        assert canonical_content_sha256(normalized) == entry["content_sha256"]
        assert entry["expect"] and entry["coverage"], entry["id"]


# ===== 3. 纯虚构 =====


def test_samples_contain_no_real_person_data(samples):
    for sample in samples:
        dump = json.dumps(sample.content_dict(), ensure_ascii=False)
        assert not ID_CARD_RE.search(dump), f"{sample.sample_id} 出现疑似身份证号"
        for phone in PHONE_RE.findall(dump.replace(ALLOWED_PHONE, "")):
            pytest.fail(f"{sample.sample_id} 出现疑似真实手机号：{phone}")
        for domain in EMAIL_RE.findall(dump):
            assert domain.lower() in ALLOWED_DOMAINS, (
                f"{sample.sample_id} 使用了非示例邮箱域名：{domain}"
            )
        name = sample.content_dict().get("name", "")
        if name:
            assert ("示例" in name) or ("Sample" in name), (
                f"{sample.sample_id} 姓名不是虚构示例：{name}"
            )
        photo = sample.content_dict().get("photo", "")
        if photo:
            assert photo.startswith("data:image/"), "照片必须是受限的 data URL"


# ===== 4. 抽查渲染 =====

SMOKE_SAMPLE_IDS = ("iter-01", "iter-06", "iter-18", "iter-02", "bound-070")


def _by_id(samples):
    return {sample.sample_id: sample for sample in samples}


@needs_font
def test_smoke_samples_render_within_page_limit(samples):
    selected = _by_id(samples)
    for sample_id in SMOKE_SAMPLE_IDS:
        sample = selected[sample_id]
        artifacts = render_artifacts(sample, ("pdf", "md", "txt"))
        pdf = artifacts["pdf"]
        assert pdf.pages is not None and 1 <= pdf.pages <= sample.page_limit
        assert pdf.pages == min(pdf.pages_needed, sample.page_limit)
        assert pdf.overflow == (pdf.pages_needed > sample.page_limit)
        assert pdf.content.startswith(b"%PDF")
        markdown = artifacts["md"].content.decode("utf-8")
        token = sample.expect.text_tokens[0]
        assert token in markdown
        txt = artifacts["txt"].content.decode("utf-8")
        assert sample.content_dict()["name"] in txt


@needs_font
def test_missing_glyph_samples_do_not_crash_and_keep_source_text(samples):
    missing = [sample for sample in samples if sample.category == "missing-glyph"]
    assert len(missing) == 8
    sample = missing[0]
    artifacts = render_sample(sample, ("pdf", "md", "txt"))
    structure = pdf_structure(artifacts["pdf"])
    assert structure["pages"] >= 1
    # 源字符在文本产物里必须原样保留（PDF 字体覆盖不到时只影响 PDF 字形）
    assert "缺字探测 #1" in artifacts["md"].decode("utf-8")
    assert "缺字探测 #1" in artifacts["txt"].decode("utf-8")


def test_legacy_record_reads_without_materializing_identity(samples):
    from app.schemas.resume import ResumeContent

    legacy = [sample for sample in samples if sample.category == "legacy-record"]
    assert len(legacy) == 8
    for sample in legacy:
        raw = sample.content_dict()
        assert "legacy_extra" in raw  # 原始 JSON 里保留了未知键
        resume = ResumeContent.model_validate(raw)
        dumped = resume.model_dump()
        assert "legacy_extra" not in dumped
        for key in ("id", "point_ids"):
            assert key not in dumped
            for section in ("education", "experience", "projects", "skills"):
                for item in dumped.get(section) or []:
                    assert key not in item


def test_special_characters_are_escaped_in_html(samples):
    sample = _by_id(samples)["bound-049"]
    html = render_sample(sample, ("html",))["html"].decode("utf-8")
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in html
    assert "<script>alert(1)</script>" not in html
    # Markdown/TXT 是文本产物：保留原文，不转义
    markdown = render_sample(sample, ("md",))["md"].decode("utf-8")
    assert "<script>alert(1)</script>" in markdown


def test_emphasis_samples_declare_consistent_marker_expectations(samples):
    for sample in [s for s in samples if s.category == "emphasis"]:
        content = sample.content_dict()
        markers = json.dumps(content, ensure_ascii=False).count("**")
        paired = sample.expect.literal_markers is False
        if paired:
            assert markers % 2 == 0, f"{sample.sample_id} 期望成对但标记数为奇"
        else:
            assert markers % 2 == 1, f"{sample.sample_id} 期望落单但标记数为偶"
        assert sample.expect.bold_html is paired


# ===== 5. D12：当前 PDF 的结构事实 =====


@needs_font
def test_current_pdf_is_untagged_and_has_no_structure_tree(samples):
    """钉住 D12 的现状：当前 PDF 没有标签结构。

    若将来的产品工作真的引入 Tagged PDF，**必须**更新本用例（改成断言结构树存在）
    并同步 docs/quality/tagged-pdf-research-d12.md——不允许用 skip 让它安静消失。
    """
    sample = _by_id(samples)["iter-01"]
    pdf = render_sample(sample, ("pdf",))["pdf"]
    facts = inspect_pdf(pdf)
    assert facts["tagged_pdf"] is False
    assert facts["struct_tree_root"] is False
    assert facts["mark_info"]["present"] is False
    assert facts["lang"] is None
    assert facts["xmp_metadata"]["pdfuaid_part"] is False
    assert facts["images_total"] >= 1
    assert facts["images_with_alt"] == 0
    for page in facts["pages_facts"]:
        assert page["tabs"] is None
        assert page["struct_parents"] is False
    for font in facts["embedded_fonts"].values():
        assert font["embedded"] is True
        assert font["to_unicode"] is True


@needs_font
def test_pdf_text_is_extractable_with_the_available_tool(samples):
    sample = _by_id(samples)["iter-01"]
    pdf = render_sample(sample, ("pdf",))["pdf"]
    text, tool = extract_pdf_text(pdf)
    assert tool in {"pdftotext", "pypdf"}
    assert "示例甲" in text or "示例甲" in re.sub(r"\s+", "", text.replace("\x00", ""))


def test_overpage_sample_is_truncated_and_flagged(samples):
    overflow_samples = [sample for sample in samples if sample.expect.overflow is True]
    assert overflow_samples, "语料里必须有故意超页的样例（W20 要求覆盖溢出行为）"
    for sample in overflow_samples:
        assert sample.page_limit >= 1
        # 自然页数上限可以高于 page_limit（截断后的上限），但不能小于它。
        assert sample.expect.max_pages is None or sample.expect.max_pages >= sample.page_limit
