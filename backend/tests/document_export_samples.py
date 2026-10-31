# SPDX-License-Identifier: Apache-2.0
"""v2 四出口测试的共用样本与文本提取（文件名不带 test_，pytest 不收集）。

为什么单独一份：HTML / PDF / Word / Markdown / TXT / JSON 的**文本对拍**必须来自同一份
document 与同一套提取口径，否则"四个出口一致"会被样本差异掩盖。这里的样本刻意覆盖：
title/meta/lead/trail/body/hidden 六种位置、list/authors/field/text 四种 item、
inline/text 两种板块、并列（equal）/顺排（flow）两种灰字段布局，以及隐藏条目与隐藏字段。
"""

from __future__ import annotations

import io
import re
import zipfile

# 隐藏内容：任何出口的**纸面文本**里都不该出现。
HIDDEN_VALUES = ("隐藏大学", "秘密字段", "隐藏要点", "秘密值")
# 纸面必须出现的关键字段值（按阅读顺序；四个出口都要有且顺序一致）。
ORDERED_VALUES = (
    "陈可",
    "产品经理",
    "13800000000",
    "chen@example.com",
    "示例大学",
    "市场营销",
    "本科",
    "2019",
    "2023",
    "3.7/4.0",
    "市场调研",
    "国家奖学金",
    "校园招聘会",
    "Python",
    "熟练",
    "三年产品经验",
)


def _field(item_id: str, key: str, value: str, placement: str, **extra) -> dict:
    return {
        "kind": "field",
        "id": item_id,
        "key": key,
        "value": value,
        "placement": placement,
        **extra,
    }


def make_document() -> dict:
    """一份覆盖 v2 主要结构的 document（dict；可直接交给 export_* / planner）。"""
    return {
        "version": 2,
        "language": "zh-CN",
        "header": {
            "items": [
                _field("hd_00000001", "name", "陈可", "name"),
                _field("hd_00000002", "gender", "女", "name_meta"),
                _field("hd_00000003", "intent", "产品经理", "subtitle"),
                _field("hd_00000004", "phone", "13800000000", "contact"),
                _field("hd_00000005", "email", "chen@example.com", "contact"),
                _field("hd_00000006", "github", "https://github.com/example", "contact"),
                _field("hd_00000007", "personal_website", "https://example.com", "contact"),
            ],
            "contact_breaks": ["github"],
        },
        "sections": [
            {
                "key": "education",
                "kind": "entries",
                "layout": {"columns": 2, "align": "equal", "gap": 1.6},
                "entries": [
                    {
                        "id": "ob_edu000001",
                        "layout": {"head": "split"},
                        "items": [
                            _field("it_edu000001", "school", "示例大学", "title", show_label=False),
                            _field("it_edu000002", "major", "市场营销", "title", show_label=False),
                            _field("it_edu000003", "degree", "本科", "meta", show_label=False),
                            _field(
                                "it_edu000004",
                                "period",
                                "2019-09|2023-06",
                                "meta",
                                show_label=False,
                                format="date_range",
                            ),
                            _field("it_edu000005", "gpa", "3.7/4.0", "lead"),
                            {
                                "kind": "list",
                                "id": "it_edu000006",
                                "key": "courses",
                                "values": ["市场调研", "消费者行为"],
                                "placement": "lead",
                                "join": "comma",
                            },
                            _field("it_edu000007", "study_form", "全日制", "trail"),
                            _field("it_edu000008", "advisor", "张老师", "trail"),
                            {
                                "kind": "text",
                                "id": "pt_edu000001",
                                "text": "国家奖学金（2020）",
                                "style": "bullet",
                            },
                        ],
                    },
                    {
                        "id": "ob_edu000002",
                        "hidden": True,
                        "items": [
                            _field("it_edu000009", "school", "隐藏大学", "title", show_label=False)
                        ],
                    },
                ],
            },
            {
                "key": "projects",
                "kind": "entries",
                "layout": {"columns": 2, "align": "flow"},
                "entries": [
                    {
                        "id": "ob_prj000001",
                        "layout": {"head": "stacked"},
                        "items": [
                            _field(
                                "it_prj000001", "name", "校园招聘会策划", "title", show_label=False
                            ),
                            _field("it_prj000002", "role", "项目负责人", "meta", show_label=False),
                            _field(
                                "it_prj000003",
                                "period",
                                "2024-03|2024-06",
                                "meta",
                                show_label=False,
                                format="date_range",
                            ),
                            {
                                "kind": "list",
                                "id": "it_prj000004",
                                "key": "tech_stack",
                                "values": ["Python", "SQL"],
                                "hidden_values": ["秘密值"],
                                "placement": "trail",
                                "join": "comma",
                            },
                            _field(
                                "it_prj000005",
                                "public_url",
                                "https://example.com/project",
                                "trail",
                                format="url",
                                solo=True,
                            ),
                            _field(
                                "it_prj000006",
                                "secret_note",
                                "秘密字段",
                                "hidden",
                                label="备注",
                            ),
                            {
                                "kind": "field",
                                "id": "it_prj000007",
                                "key": "description",
                                "value": "从 0 到 1 策划校园招聘会。",
                                "placement": "body",
                                "body_style": "paragraph",
                                "show_label": False,
                            },
                        ],
                    }
                ],
            },
            {
                "key": "skills",
                "kind": "inline",
                "entries": [
                    {
                        "id": "ob_skl000001",
                        "items": [
                            _field("it_skl000001", "name", "Python", "body", show_label=False),
                            _field(
                                "it_skl000002",
                                "level",
                                "熟练",
                                "body",
                                show_label=False,
                                wrap="paren",
                            ),
                            _field("it_skl000003", "category", "后端", "trail", show_label=False),
                        ],
                    },
                    {
                        "id": "ob_skl000002",
                        "items": [
                            _field("it_skl000004", "name", "SQL", "body", show_label=False),
                            _field(
                                "it_skl000005",
                                "level",
                                "掌握",
                                "body",
                                show_label=False,
                                wrap="paren",
                            ),
                        ],
                    },
                ],
            },
            {
                "key": "summary",
                "kind": "text",
                "entries": [
                    {
                        "id": "ob_sum000001",
                        "items": [
                            {
                                "kind": "text",
                                "id": "pt_sum000001",
                                "text": "三年产品经验。",
                                "style": "paragraph",
                            },
                            {
                                "kind": "text",
                                "id": "pt_sum000002",
                                "text": "隐藏要点",
                                "style": "bullet",
                                "hidden": True,
                            },
                        ],
                    }
                ],
            },
        ],
    }


def normalize_text(text: str) -> str:
    """把提取文本压成单空格（HTML 标签替换、PDF/Word 换行都会被规范化）。"""
    return re.sub(r"\s+", " ", str(text)).strip()


def html_text(html: str) -> str:
    """HTML -> 纸面文本（去掉 style/script 与标签，保留顺序）。"""
    body = html.split("<body>", 1)[-1]
    body = re.sub(r"<script.*?</script>", " ", body, flags=re.S)
    body = re.sub(r"<style.*?</style>", " ", body, flags=re.S)
    body = re.sub(r"<[^>]+>", " ", body)
    return normalize_text(body)


def pdf_text(data: bytes) -> str:
    """PDF 字节 -> 提取文本（pypdf；逐页拼接）。"""
    import pypdf

    reader = pypdf.PdfReader(io.BytesIO(data))
    return normalize_text(" ".join(page.extract_text() or "" for page in reader.pages))


def docx_text(data: bytes) -> str:
    """Word 字节 -> 提取文本（段落 + 表格单元格，保持文档顺序）。"""
    from docx import Document

    document = Document(io.BytesIO(data))
    parts: list[str] = []
    body = document.element.body
    for child in body.iterchildren():
        tag = child.tag.rsplit("}", 1)[-1]
        if tag == "p":
            text = "".join(node.text or "" for node in child.iter() if node.tag.endswith("}t"))
            if text.strip():
                parts.append(text)
        elif tag == "tbl":
            for row in child.iterchildren():
                for cell in row.iterchildren():
                    text = "".join(
                        node.text or "" for node in cell.iter() if node.tag.endswith("}t")
                    )
                    if text.strip():
                        parts.append(text)
    return normalize_text(" ".join(parts))


def docx_paragraphs(data: bytes) -> list:
    """Word 段落对象列表（断言制表位 / 对齐用）。"""
    from docx import Document

    return Document(io.BytesIO(data)).paragraphs


def docx_page_break_count(data: bytes) -> int:
    """Word 文档里的分页符数量（w:br type="page" 与 w:pageBreakBefore）。"""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    return len(re.findall(r'w:type="page"', xml)) + len(re.findall(r"<w:pageBreakBefore", xml))
