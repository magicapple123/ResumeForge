# SPDX-License-Identifier: Apache-2.0
"""产物文本抽取与顺序对照（W11 / D11、R03 的产物层）。

**为什么必须做成唯一实现**：黄金矩阵（`tests/test_export_golden.py`）已经用 pypdf 抽过一次
PDF 文本、用 zip+XML 抽过 Word 文本；检查面板如果自己再写一套抽取规则，"同一份产物
在黄金测试里完整、在检查面板里缺字"这类分歧就永远说不清。这里把抽取与规范化收成一份，
测试与 `preflight_rules_product` 共用它。

**口径**：比较前先去掉全部空白（PDF 换行会把一句话切成多行，不归一化会全是假差异），
再切成"拉丁词 + 连续 CJK 串"的 token 序列。双栏模板的阅读顺序与草稿预览结构性不同
（左段完→右段 vs 上→下），调用方据此把顺序差异标 `verify` 而不是 `blocker`——
这是已知近似，不是缺陷。
"""

from __future__ import annotations

import io
import re
import zipfile
from xml.etree import ElementTree

from ...schemas.resume import ResumeContent
from .resume_labels import normalize_language
from .resume_sections import DEFAULT_SECTION_ORDER
from .resume_visibility import hidden_point_ids, is_hidden_entry

_TOKEN_RE = re.compile(r"[A-Za-z0-9]+|[\u4e00-\u9fff]+")
_MAX_DIFFS = 50
# 可见性/身份元数据不是"纸面上该出现的正文"：既不该当文本比较，也不该参与缺字判定。
_VISIBILITY_KEYS = frozenset({"id", "point_ids", "hidden", "hidden_points", "lock_content", "lock_layout"})


def normalize_text(text: str) -> str:
    """去空白（含全角空格与换行），用于跨行比较。"""
    return re.sub(r"\s+", "", text)


def tokens_of(text: str) -> list[str]:
    """把一段文本切成可比较的 token（拉丁词整体、CJK 连续串整体）。"""
    return _TOKEN_RE.findall(normalize_text(text))


def extract_pdf_text(content: bytes) -> list[tuple[int, str]]:
    """抽取 PDF 每页文本：`[(页码, 文本)]`。解析失败返回空列表（调用方按"无文本"处理）。"""
    try:
        from pypdf import PdfReader
    except Exception:  # noqa: BLE001 - 运行环境缺 pypdf：产物层跳过而不是 500
        return []
    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception:  # noqa: BLE001 - 产物坏到读不了：交给调用方报 blocker
        return []
    pages: list[tuple[int, str]] = []
    for index, page in enumerate(reader.pages, start=1):
        try:
            text = page.extract_text() or ""
        except Exception:  # noqa: BLE001 - 单页抽取失败不拖垮整体
            text = ""
        pages.append((index, text))
    return pages


def extract_docx_text(content: bytes) -> str:
    """抽取 docx 正文文本（zip + word/document.xml，按 XML 顺序拼 `w:t`）。"""
    try:
        with zipfile.ZipFile(io.BytesIO(content)) as archive:
            raw = archive.read("word/document.xml")
    except (KeyError, zipfile.BadZipFile, OSError):
        return ""
    try:
        root = ElementTree.fromstring(raw)
    except ElementTree.ParseError:
        return ""
    ns = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
    chunks: list[str] = []
    for node in root.iter():
        if node.tag == f"{ns}t" and node.text:
            chunks.append(node.text)
        elif node.tag == f"{ns}p":
            chunks.append("\n")
    return "".join(chunks)


def expected_lines(content: ResumeContent, *, language: str | None = None) -> list[str]:
    """按纸面顺序列出"应该出现在产物里"的文本行。

    只收结构化正文里用户真正看得见的字段：照片（base64）不参与、隐藏条目（W06）不参与。
    """
    lang = normalize_language(language)
    del lang  # 语言只影响小节标题；正文比较用不到标题，保留参数便于将来对齐
    lines: list[str] = []

    def add(value: object) -> None:
        if isinstance(value, str) and value.strip():
            lines.append(value)

    for field in (
        "name",
        "gender",
        "birth_year",
        "phone",
        "email",
        "city",
        "personal_website",
        "github",
        "job_intent",
        "summary",
    ):
        add(getattr(content, field, ""))

    sections: dict[str, list] = {
        "education": list(content.education),
        "experience": list(content.experience),
        "campus_experience": list(content.campus_experience),
        "projects": list(content.projects),
        "skills": list(content.skills),
        "awards": list(content.awards),
    }
    for key in DEFAULT_SECTION_ORDER:
        items = sections.get(key, [])
        for item in items:
            if is_hidden_entry(item):
                continue
            data = item.model_dump(exclude_none=True) if hasattr(item, "model_dump") else {}
            hidden = hidden_point_ids(item)
            point_ids = data.get("point_ids")
            mapping = point_ids if isinstance(point_ids, dict) else {}
            for key, value in data.items():
                if key in _VISIBILITY_KEYS:
                    continue
                if isinstance(value, list):
                    ids = mapping.get(key)
                    ids = ids if isinstance(ids, list) else []
                    for index, entry in enumerate(value):
                        # 隐藏要点不参与产物比较；id 与数组不等长时按"未隐藏"保守处理。
                        if index < len(ids) and ids[index] in hidden:
                            continue
                        add(entry)
                else:
                    add(value)
    return lines


_LATIN_SEGMENT = re.compile(r"[A-Za-z0-9]+")


def _sequence(text: str) -> list[str]:
    """比较用的 token 序列：拉丁词整体、CJK **逐字**。

    为什么 CJK 不能整段当一个 token：PDF 会在任意字之间换行，归一化后的"连续 CJK 串"
    边界取决于排版，同一句话在两种版式下会得到不同的串（假差异）。逐字比较才与换行无关；
    缺失/乱序再按连续片段聚合，读起来仍是词。
    """
    normalized = normalize_text(text)
    tokens: list[str] = []
    index = 0
    while index < len(normalized):
        char = normalized[index]
        if "\u4e00" <= char <= "\u9fff":
            tokens.append(char)
            index += 1
            continue
        match = _LATIN_SEGMENT.match(normalized, index)
        if match:
            tokens.append(match.group())
            index = match.end()
            continue
        index += 1
    return tokens


def compare_text_order(expected_lines: list[str], extracted: list[tuple[int, str]]) -> list[dict]:
    """比较结构化正文与产物文本。

    返回 `[{kind, token, page, expected_index}]`，`kind ∈ missing / out_of_order / garbled`：

    * `missing`：产物里找不到这个 token（真丢内容，blocker）；
    * `out_of_order`：token 存在但出现在已确认位置的更前面（顺序差异，verify）；
    * `garbled`：页面抽取为空但期望文本非空（产物可能损坏，verify 起步）。
    """
    expected_tokens = _sequence("\n".join(expected_lines))
    if not expected_tokens:
        return []
    expected_index: dict[str, int] = {}
    for position, token in enumerate(expected_tokens):
        expected_index.setdefault(token, position)

    page_of_token: dict[str, int] = {}
    extracted_tokens: list[str] = []
    for page, text in extracted:
        for token in _sequence(text):
            extracted_tokens.append(token)
            page_of_token.setdefault(token, page)

    if not extracted_tokens and any(text for _page, text in extracted):
        return [
            {
                "kind": "garbled",
                "token": expected_tokens[0],
                "page": None,
                "expected_index": 0,
            }
        ]

    extracted_set = set(extracted_tokens)
    diffs: list[dict] = []
    reported_out_of_order: set[str] = set()
    pointer = 0
    for token in expected_tokens:
        if len(diffs) >= _MAX_DIFFS:
            break
        found_at = None
        for scan in range(pointer, len(extracted_tokens)):
            if extracted_tokens[scan] == token:
                found_at = scan
                break
        if found_at is not None:
            pointer = found_at + 1
            continue
        if token in extracted_set:
            if token in reported_out_of_order:
                continue
            reported_out_of_order.add(token)
            diffs.append(
                {
                    "kind": "out_of_order",
                    "token": token,
                    "page": page_of_token.get(token),
                    "expected_index": expected_index[token],
                }
            )
        else:
            diffs.append(
                {
                    "kind": "missing",
                    "token": token,
                    "page": None,
                    "expected_index": expected_index[token],
                }
            )
    return diffs


__all__ = [
    "compare_text_order",
    "expected_lines",
    "extract_docx_text",
    "extract_pdf_text",
    "normalize_text",
    "tokens_of",
]
