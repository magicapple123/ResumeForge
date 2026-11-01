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
# 合并后片段的长度上限：`schemas.preflight.TextOrderDiff.token` 是 max_length=200，
# 超出的片段会在响应校验时被丢掉（表现为"某些缺字凭空消失"）。
_MAX_FRAGMENT = 180
# 可见性/身份元数据不是"纸面上该出现的正文"：既不该当文本比较，也不该参与缺字判定。
_VISIBILITY_KEYS = frozenset(
    {"id", "point_ids", "hidden", "hidden_points", "lock_content", "lock_layout"}
)


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


def expected_lines(content: ResumeContent | dict, *, language: str | None = None) -> list[str]:
    """按纸面顺序列出"应该出现在产物里"的文本行。

    只收结构化正文里用户真正看得见的字段：照片（base64）不参与、隐藏条目（W06）不参与。
    """
    if isinstance(content, dict):
        from .document_html import coerce_document, paper_document
        from .document_plan import build_document_plan, plan_to_text

        plan = build_document_plan(paper_document(coerce_document(content)), language=language)
        # Headings are presentation, not source facts; hide_title must not create a missing-text blocker.
        plan = plan.model_copy(
            update={
                "sections": [section.model_copy(update={"title": ""}) for section in plan.sections]
            }
        )
        return plan_to_text(plan)
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

    # 从正文分区表推导条目数组（A4：科研三栏目 + 资格证照都已在
    # DEFAULT_SECTION_ORDER 登记；summary 是字符串，按"不是 list"排除）。
    # 手写第二份清单会让新栏目的可见正文不参与"产物是否缺字"的比对。
    sections: dict[str, list] = {}
    for key in DEFAULT_SECTION_ORDER:
        value = getattr(content, key, None)
        if isinstance(value, list):
            sections[key] = value
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

    * `missing`：产物里找不到这段文字（真丢内容，blocker）；
    * `out_of_order`：这段文字存在但出现在已确认位置的更前面（顺序差异，verify）；
    * `garbled`：页面抽取为空但期望文本非空（产物可能损坏，verify 起步）。

    **R-25：`token` 是"片段"而不是单个字。** 上一版逐 token 返回差异，于是"激活"这种
    两字词会变成两条相邻的差异，前端把它们渲染成两个紧挨着的黄块——用户看到的是
    "黄色断断续续"。现在相邻且同类的差异会合并成一段（`_merge_runs`）：
    「日更看板」是一个片段，单字缺失（他/申/请）仍是一个字的片段，照样能定位。
    """
    expected_tokens: list[str] = []
    # 每个 token 属于哪一行（`expected_lines` 的第几条）。合并片段时要求**同一行**：
    # 两行在归一化后是首尾相连的，跨行合并会拼出「激活用户日更看板」这种不存在的词。
    expected_line_of: list[int] = []
    for line_index, line in enumerate(expected_lines):
        for token in _sequence(line):
            expected_tokens.append(token)
            expected_line_of.append(line_index)
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
    raw: list[tuple[dict, int | None]] = []
    pointer = 0
    for token in expected_tokens:
        if len(raw) >= _MAX_DIFFS:
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
            raw.append(
                (
                    {
                        "kind": "out_of_order",
                        "token": token,
                        "page": page_of_token.get(token),
                        "expected_index": expected_index[token],
                        "line": expected_line_of[expected_index[token]],
                    },
                    None,
                )
            )
        else:
            raw.append(
                (
                    {
                        "kind": "missing",
                        "token": token,
                        "page": None,
                        "expected_index": expected_index[token],
                        "line": expected_line_of[expected_index[token]],
                    },
                    None,
                )
            )
    return _merge_runs(raw)


def _merge_runs(raw: list[tuple[dict, int | None]]) -> list[dict]:
    """把**相邻且同类**的差异合并成一个片段（R-25）。

    合并条件三条，缺一不可：
    1. 同类（missing 不和 out_of_order 合并——两者的严重级别与颜色都不同）；
    2. 在**期望序列**里相邻（`expected_index` 连续）且属于**同一行**（跨行合并会拼出
       并不存在的词：`expected_lines` 归一化后是首尾相连的）；
    3. `out_of_order` 还要求落在**同一页**：跨页的两段在纸面上根本不是一处，
       合并会让用户在一页里找一个不在这一页的词。
    `missing` 的 page 恒为 None，天然满足第 3 条。
    """
    merged: list[dict] = []
    # 需要记"这一段最后一个字在期望序列里的位置"：合并后 `expected_index` 保持段首值
    # （前端用它定位），如果直接拿它 +1 去比，段最多只能长到两个字。
    last_expected: int | None = None
    for diff, _ in raw:
        previous = merged[-1] if merged else None
        same_kind = previous is not None and previous["kind"] == diff["kind"]
        adjacent = (
            same_kind
            and last_expected is not None
            and diff["expected_index"] is not None
            and diff["expected_index"] == last_expected + 1
        )
        same_page = previous is not None and previous["page"] == diff["page"]
        same_line = previous is not None and previous.get("line") == diff.get("line")
        # 片段长度上限：`TextOrderDiff.token` 是 `max_length=200`，超了会被 pydantic 丢掉。
        fits = previous is not None and len(previous["token"]) + len(diff["token"]) <= _MAX_FRAGMENT
        if previous is not None and same_kind and adjacent and same_page and same_line and fits:
            previous["token"] += diff["token"]
            last_expected = diff["expected_index"]
            continue
        merged.append(dict(diff))
        last_expected = diff["expected_index"]
    return merged


__all__ = [
    "compare_text_order",
    "expected_lines",
    "extract_docx_text",
    "extract_pdf_text",
    "normalize_text",
    "tokens_of",
]
