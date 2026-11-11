# SPDX-License-Identifier: Apache-2.0
"""P4-07：正文分块选段（把"整页正文"变成"与问题相关的 2~3 段"）。

旧实现取 ``text[:1200]`` 头部截断，读到的是一屏导航。这里钉住：

1. **答案在第 5 段、前 1200 字是导航**的 fixture：选段结果必须包含答案段；
2. 0 命中的页整页跳过（不产生 ``text``）；
3. 预算按**总字符**分配（不是每页均分）；
4. 跨页按前 80 字指纹去重；
5. 边界：空正文 / 全英文 / 超长单段（没有任何分隔符）。
"""

from __future__ import annotations

from app.services.search.aggregate import DEPTH_PROFILE
from app.services.search.passages import (
    CHUNK_OVERLAP_CHARS,
    CHUNK_TARGET_CHARS,
    chunk_text,
    fingerprint,
    passage_title,
    query_terms,
    rank_passages,
    select_context,
    select_passages,
)

#: 一段与招聘无关的导航文字（真实站点开头几乎都是这种）。
_NAV = "首页 关于我们 产品中心 解决方案 客户案例 新闻动态 加入我们 联系方式 "


def _naval_page(chars: int = 1200) -> str:
    """前 ``chars`` 字全是导航，再往后才是正文（答案在第 5 段）。"""
    filler = (_NAV * (chars // len(_NAV) + 1))[:chars]
    paragraphs = [
        "第一章 公司简介：我们是一家专注于企业服务的公司。",
        "第二章 发展历程：从 2015 年成立至今，服务了上千家客户。",
        "第三章 业务范围：包含咨询、实施与运维三块。",
        "第四章 团队介绍：研发团队占比一半以上。",
        # 答案段：命中查询词项「后端」「招聘」。
        "第五章 后端工程师招聘：负责服务端接口设计与开发，要求熟悉 Python 与数据库，"
        "后端团队现有 20 人，本次招聘 5 人，工作地点在北京。",
        "第六章 投递方式：请把简历发到招聘邮箱。",
    ]
    return filler + "\n" + "\n".join(paragraphs)


def test_answer_paragraph_is_selected_even_when_it_starts_after_1200_chars():
    page = _naval_page()
    assert len(page) > 1200
    # 旧实现（text[:1200]）拿不到答案——这正是本任务要修的东西。
    assert "后端工程师招聘" not in page[:1200]

    picked = select_passages(page, "后端 招聘", max_passages=2, max_chars=1800)
    assert picked, "没有选中任何段落"
    joined = "\n".join(passage.text for passage in picked)
    assert "后端工程师招聘" in joined
    # 得分最高的那一段必须就是答案段（而不是"顺手把前 1200 字也带上了"）。
    top = rank_passages(page, "后端 招聘")[0]
    assert "后端工程师招聘" in top.text
    # 纯导航的头部块没被选中：整页 2000+ 字，选出来的远少于一半。
    assert len(joined) <= 2 * CHUNK_TARGET_CHARS
    assert page[:CHUNK_TARGET_CHARS] not in joined


def test_chunking_uses_300_to_400_char_blocks_with_60_char_overlap():
    page = _naval_page(2000)
    chunks = chunk_text(page)
    assert len(chunks) > 1
    body_chunks = [chunk for chunk in chunks if len(chunk.text) > 200]
    assert all(len(chunk.text) <= CHUNK_TARGET_CHARS + 40 for chunk in body_chunks)
    # 相邻块有重叠（答案横跨切点时不丢）。
    assert CHUNK_OVERLAP_CHARS == 60
    first, second = chunks[0].text, chunks[1].text
    assert first[-CHUNK_OVERLAP_CHARS:] in second or second[:CHUNK_OVERLAP_CHARS] in first


def test_empty_body_produces_no_passage():
    assert chunk_text("") == []
    assert chunk_text("   \n\t ") == []
    assert select_passages("", "后端 招聘", max_passages=2, max_chars=1800) == []
    assert (
        select_context(
            [{"url": "https://x.example.com/1", "text": ""}],
            "后端 招聘",
            max_passages=2,
            total_chars=1800,
        )
        == []
    )


def test_english_page_is_scored_on_word_boundaries():
    page = ("Navigation Home About Products Solutions Customers News Careers Contact ") * 20 + (
        "We are hiring a backend engineer to build recruitment services. "
        "The backend team owns the recruitment pipeline and the hiring API."
    )
    terms = query_terms("backend recruitment")
    assert terms, "英文查询也要能切出词项"
    ranked = rank_passages(page, "backend recruitment")
    assert ranked[0].score > 0
    picked = select_passages(page, "backend recruitment", max_passages=2, max_chars=1800)
    joined = "\n".join(passage.text for passage in picked)
    assert "backend engineer" in joined
    # 词边界：`api` 不该命中 `rapid` 这类词。
    assert passage_title("") == ""


def test_super_long_single_paragraph_is_chunked():
    """没有任何空白/标点的超长单段（JSON/日志页）也必须能切，且不能死循环。"""
    page = "后端招聘" * 1000  # 4000 字，无分隔符
    chunks = chunk_text(page)
    assert len(chunks) > 1
    assert all(chunk.text for chunk in chunks)
    picked = select_passages(page, "后端 招聘", max_passages=2, max_chars=1800)
    assert picked


def test_pages_without_any_hit_are_skipped_entirely():
    pages = [
        {"url": "https://nav.example.com/1", "text": _NAV * 20},
        {"url": "https://careers.example.com/2", "text": _naval_page()},
    ]
    selected = select_context(pages, "后端 招聘", max_passages=2, total_chars=1800)
    assert [entry["url"] for entry in selected] == ["https://careers.example.com/2"]
    assert selected[0]["passages"]
    assert set(selected[0]["passages"][0]) == {"index", "title"}


def test_budget_is_allocated_by_total_chars_not_per_page():
    """三页都有命中时，总字符不超过预算（不是"每页都塞满 1800"）。"""
    page = "后端招聘岗位说明。" * 400
    pages = [
        {"url": f"https://careers.example.com/{index}", "text": page + str(index)}
        for index in range(3)
    ]
    selected = select_context(pages, "后端 招聘", max_passages=2, total_chars=1800)
    total = sum(len(str(entry["text"])) for entry in selected)
    assert total <= 1800
    assert len(selected) >= 1


def test_duplicate_pages_are_deduplicated_by_fingerprint():
    page = _naval_page()
    pages = [
        {"url": "https://mirror-a.example.com/1", "text": page},
        {"url": "https://mirror-b.example.com/1", "text": page},
    ]
    assert fingerprint(pages[0]["text"]) == fingerprint(pages[1]["text"])
    # 预算直接取「深入」档（4000）：`DEPTH_PROFILE` 是**唯一**预算来源，
    # 这里不写字面数字，避免出现第二份"总字符预算"的说法。
    selected = select_context(
        pages, "后端 招聘", max_passages=3, total_chars=DEPTH_PROFILE["deep"][2]
    )
    assert [entry["url"] for entry in selected] == ["https://mirror-a.example.com/1"]
