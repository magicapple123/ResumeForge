# SPDX-License-Identifier: Apache-2.0
"""ATS 产物解析检查（需求 1 P0）：真的渲染 PDF，再用 pypdf 读回来。

四个用例对应四项检查：文本可提取性、关键字段可提取、阅读顺序、渲染不可用时的降级。
图片型 PDF 用 fpdf2 画一块矩形造出来（页面上没有文字层），走的是真实 pypdf 抽取路径。
"""

from __future__ import annotations

from app.schemas.resume import (
    ResumeContent,
    ResumeEducation,
    ResumeExperience,
    ResumeSkill,
)
from app.services import ats_parse_check
from app.services.ats_check import check_ats
from app.services.pdf_exporter import ResumePDF
from fpdf import FPDF


def _resume(**overrides) -> ResumeContent:
    payload = {
        "name": "林晓样",
        "phone": "13800001234",
        "email": "linxiaoyang@example.com",
        "job_intent": "后端开发工程师",
        "summary": "3 年后端开发经验，熟悉 Python 与 MySQL",
        "education": [
            ResumeEducation(
                school="示例大学",
                major="计算机",
                degree="本科",
                start_date="2018-09",
                end_date="2022-06",
            )
        ],
        "experience": [
            ResumeExperience(
                company="示例公司",
                role="后端工程师",
                start_date="2022-07",
                end_date="至今",
                description=["接口延迟降低 40%"],
            )
        ],
        "skills": [ResumeSkill(name="Python", level="熟练")],
    }
    payload.update(overrides)
    return ResumeContent(**payload)


def _image_only_pdf() -> bytes:
    """一页只有图形、没有文字层的 PDF——真实 ATS 读它等于读空简历。"""
    pdf = FPDF()
    pdf.add_page()
    pdf.set_fill_color(180, 180, 180)
    pdf.rect(10, 10, 120, 160, style="F")
    return bytes(pdf.output())


def test_normal_pdf_has_no_parse_issue():
    resume = _resume()
    # 先证明渲染与抽取真的跑通了：否则"没有问题"和"根本没检查"分不出来。
    assert ats_parse_check._render_text(resume) is not None
    assert ats_parse_check.parse_check_issues(resume) == []


def test_image_only_pdf_reports_unextractable_text(monkeypatch):
    monkeypatch.setattr(
        ats_parse_check,
        "build_resume_pdf",
        lambda *_args, **_kwargs: ResumePDF(content=_image_only_pdf(), pages=1),
    )
    issues = ats_parse_check.parse_check_issues(_resume())
    assert [issue.title for issue in issues] == ["PDF 文本层为空"]
    assert issues[0].severity == "high"
    assert issues[0].suggestion.strip()


def test_render_unavailable_is_skipped_instead_of_failing(monkeypatch):
    def boom(*_args, **_kwargs):
        raise RuntimeError("no font")

    monkeypatch.setattr(ats_parse_check, "build_resume_pdf", boom)
    assert ats_parse_check.parse_check_issues(_resume()) == []


def test_lost_email_is_reported_as_high(monkeypatch):
    resume = _resume()
    lines = ats_parse_check._paper_lines(resume)
    without_email = [line for line in lines if "example.com" not in line]
    monkeypatch.setattr(
        ats_parse_check,
        "extract_pdf_text",
        lambda _content: [(1, "\n".join(without_email))],
    )
    issues = ats_parse_check.parse_check_issues(resume)
    assert [issue.title for issue in issues] == ["PDF 联系方式不可提取"]
    assert issues[0].severity == "high"
    assert "邮箱" in issues[0].detail


def test_scrambled_order_is_reported(monkeypatch):
    resume = _resume()
    lines = ats_parse_check._paper_lines(resume)
    monkeypatch.setattr(
        ats_parse_check,
        "extract_pdf_text",
        lambda _content: [(1, "\n".join(reversed(lines)))],
    )
    issues = ats_parse_check.parse_check_issues(resume)
    titles = [issue.title for issue in issues]
    assert "PDF 阅读顺序可能错乱" in titles


def test_parse_check_only_runs_when_enabled(monkeypatch):
    monkeypatch.setattr(
        ats_parse_check,
        "build_resume_pdf",
        lambda *_args, **_kwargs: ResumePDF(content=_image_only_pdf(), pages=1),
    )
    resume = _resume()
    default_titles = {issue.title for issue in check_ats(resume).issues}
    enabled_titles = {issue.title for issue in check_ats(resume, parse_check=True).issues}
    assert "PDF 文本层为空" not in default_titles
    assert "PDF 文本层为空" in enabled_titles


def test_parse_issue_lands_in_format_subscore(monkeypatch):
    monkeypatch.setattr(
        ats_parse_check,
        "build_resume_pdf",
        lambda *_args, **_kwargs: ResumePDF(content=_image_only_pdf(), pages=1),
    )
    resume = _resume()
    # 带 JD 才有三个分项（没有 JD 时关键词分项不参与计分）。
    clean = check_ats(resume, jd_text="要求熟悉 Python")
    parsed = check_ats(resume, jd_text="要求熟悉 Python", parse_check=True)
    assert set(parsed.subscores) == {"format", "keyword", "position"}
    # 分数仍然确定性：同样输入两次结果一致；解析问题落在 format 分项。
    assert parsed.score == check_ats(resume, jd_text="要求熟悉 Python", parse_check=True).score
    assert parsed.subscores["format"] < clean.subscores["format"]
    assert parsed.summary["format"] == clean.summary["format"] + 1
