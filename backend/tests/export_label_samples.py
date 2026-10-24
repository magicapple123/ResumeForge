# SPDX-License-Identifier: Apache-2.0
"""A 包验收测试的**共用取材层**：七分区样本 + 五种真实产物的文本提取。

为什么单独一个模块：A1（七个分区标题）与 A2（字段前缀 / 分隔符 / 括号）两组断言
必须从**同一份样本、同一套提取口径**里取文本——两份样本各取各的，"标题对了前缀错了"
这种分叉就会被样本差异掩盖。文件名不带 ``test_`` 前缀，pytest 不会收集它。

约定（与 ``test_export_labels.py`` 模块 docstring 同源）：

- 正文刻意不含任何标题词（否则"英文产物里不该出现中文标题"会被正文自己证伪）；
- PDF / Word / HTML 比**提取文本**而不是字节：创建时间、字体子集名、CSP nonce 每次都变。
"""

from __future__ import annotations

import html
import io
import re
import zipfile

import pypdf
import pytest
from app.schemas.resume import ResumeContent
from app.services.docx_exporter import build_resume_docx
from app.services.exporter import export_markdown, render_html
from app.services.pdf_exporter import build_resume_pdf, font_available
from app.services.resume.resume_labels import SECTION_TITLES
from app.services.txt_exporter import export_txt

needs_font = pytest.mark.skipif(not font_available(), reason="本机没有可用的中文字体")

# 分区键顺序 = `resume_sections.DEFAULT_SECTION_ORDER`，与 `SECTION_TITLES` 的排列一致。
SECTION_KEYS: tuple[str, ...] = (
    "education",
    "experience",
    "projects",
    "skills",
    "campus_experience",
    "awards",
    "summary",
)
ZH_TITLES: tuple[str, ...] = tuple(SECTION_TITLES["zh-CN"][key] for key in SECTION_KEYS)
EN_TITLES: tuple[str, ...] = tuple(SECTION_TITLES["en-US"][key] for key in SECTION_KEYS)


# ===== 样本与各格式的真实产物 =====


def _resume() -> ResumeContent:
    """七个分区**全部非空**的样本（正文刻意不含任何标题词，见模块 docstring）。"""
    return ResumeContent(
        name="林致远",
        phone="13800001234",
        email="lin.zhiyuan@example.com",
        city="杭州",
        job_intent="高级后端开发工程师",
        github="https://github.example.com/linzhiyuan",
        personal_website="https://linzhiyuan.example.com",
        summary="十年后端开发经验，长期负责高并发交易系统的稳定性治理。",
        education=[
            {
                "school": "星辰理工大学",
                "major": "计算机科学与技术",
                "degree": "本科",
                "start_date": "2010-09",
                "end_date": "2014-06",
                "gpa": "3.8/4.0",
                "courses": ["数据结构", "操作系统"],
                "achievements": ["校级一等奖学金"],
            }
        ],
        experience=[
            {
                "company": "云梯智联科技有限公司",
                "role": "高级后端工程师",
                "start_date": "2018-01",
                "end_date": "2024-12",
                "description": ["负责核心交易链路的设计与落地，全年可用性达到四个九。"],
            }
        ],
        campus_experience=[
            {
                "organization": "校学生科协",
                "role": "技术负责人",
                "start_date": "2011-09",
                "end_date": "2013-06",
                "description": ["组织校内技术分享十余场。"],
            }
        ],
        projects=[
            {
                "name": "统一网关平台",
                "role": "负责人",
                "start_date": "2021-03",
                "end_date": "2022-06",
                "tech_stack": ["Python", "MySQL"],
                "description": ["面向全公司的统一接入与配额管理。"],
                "highlights": ["灰度放量与回滚预案覆盖全部核心服务。"],
            }
        ],
        skills=[{"name": "Python", "level": "精通"}, {"name": "MySQL", "level": "熟练"}],
        awards=[{"name": "年度优秀员工", "date": "2023-12", "description": "交易链路稳定性治理"}],
    )


def _resume_without_projects() -> ResumeContent:
    """少一个分区（`projects` 为空）的样本：用来验"标题数量 = 非空分区数"。"""
    data = _resume().model_dump()
    data["projects"] = []
    return ResumeContent.model_validate(data)


def _pdf_text(content: bytes) -> str:
    reader = pypdf.PdfReader(io.BytesIO(content))
    return "".join(page.extract_text() or "" for page in reader.pages)


def _docx_text(content: bytes) -> str:
    """Word 正文的纯文本：读 `word/document.xml` 再剥标签（与黄金矩阵同口径）。"""
    with zipfile.ZipFile(io.BytesIO(content)) as bundle:
        xml = bundle.read("word/document.xml").decode("utf-8")
    return re.sub(r"<[^>]+>", " ", xml)


def _html_text(source: str) -> str:
    """HTML 的"正文"：先把 `<style>` / `<script>` 整块剔除，再剥标签。

    不剔样式与脚本的话，CSS 里的类名与适配脚本里的英文单词会混进"正文"，让
    "英文产物里不该出现中文标题"这类反向断言变成随机通过。
    """
    without_behaviour = re.sub(
        r"<(script|style)\b[^>]*>.*?</\1\s*>", " ", source, flags=re.S | re.I
    )
    return re.sub(r"<[^>]+>", " ", without_behaviour)


def _plain(text: str) -> str:
    """统一成"可比较"的形态：还原 HTML/XML 实体 + 去掉全部空白。

    PDF 抽文本会在字间插空格与换行、HTML/XML 会把 `&` 转义成 `&amp;`，两者都不是
    "纸面上印了什么"的差异。
    """
    return re.sub(r"\s+", "", html.unescape(text))


def _products(language: str, resume: ResumeContent | None = None) -> dict[str, str]:
    """同一份内容、同一个 language 的五份产物文本（pdf/docx/html/md/txt）。

    ``resume`` 缺省用那份"七分区全非空"的主样本；验分隔符/括号的用例会传一个更小的样本。
    """
    resume = _resume() if resume is None else resume
    return {
        "pdf": _pdf_text(build_resume_pdf(resume, language=language).content),
        "docx": _docx_text(build_resume_docx(resume, language=language).content),
        "html": _html_text(render_html(resume, language=language)),
        "md": export_markdown(resume, language=language),
        "txt": export_txt(resume, language=language),
    }
