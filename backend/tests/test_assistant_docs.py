# SPDX-License-Identifier: Apache-2.0
"""T30 文档检索质量守卫：切块、排序、片段上限、引用来源与 20 问标注集。

旧测试对检索质量的约束只有"结果里出现 user-guide 或 README"这一条结构性断言，
本质上是"至少有一个相关章节进了 top5"；20 个问题的标注集把口径收紧成"top1 必须
落在人工标注的期望小节上"，并且对 how-to 类额外要求 top1 是带列表的步骤小节。
这不是调松阈值：旧断言允许 top1 落在任何一个大章节上，新断言逐题钉到具体小节、
带面包屑消歧，还钉了 source、片段类型上限和排序优先级。

改手册标题不用改测试代码：把新标题加进 ``fixtures/assistant_docs_questions.json``
该题的 ``accepted_headings`` 即可，``test_fixture_headings_and_answer_phrases_are_still_valid``
会在标题消失时直接点名是哪几题；切片行号也不是写死的，按文件现算。
"""

from __future__ import annotations

import json
import re
from pathlib import Path

import pytest
from app.services.assistant_docs import (
    DEFAULT_LIMIT,
    MAX_RESULTS,
    MAX_SNIPPET_CHARS,
    RULE_SNIPPET_CHARS,
    STEPS_SNIPPET_CHARS,
    ProductDocChunk,
    _all_chunks,
    _excerpt,
    _matched_terms,
    _query_terms,
    _rank_chunks,
    _snippet_limit,
    _title_hits,
    format_product_doc_results,
    search_product_docs,
)
from app.services.assistant_tools import execute_tool, tool_names

FIXTURE_PATH = Path(__file__).parent / "fixtures" / "assistant_docs_questions.json"
_REPO_ROOT = Path(__file__).resolve().parents[2]
_HEADING_LINE = re.compile(r"^#{1,3}\s")


def _doc_heading_line(source: str) -> int:
    """返回 ``docs/xxx.md`` 里某个标题所在的行号（1 起）。

    切片行号只用来证明"chunk 的 line 指向标题那一行"。早先这里写死 ``== 1659`` 这类
    数字，导致每次在它上面增删一段都要手工平移——那不是被测行为，是测试自己的债。
    从文件里现算，判据不变、维护成本归零。
    """
    path, heading = source.split("#", 1)
    heading = heading.rsplit(" > ", 1)[-1]
    lines = (_REPO_ROOT / path).read_text(encoding="utf-8").splitlines()
    hits = [index for index, line in enumerate(lines, 1) if line.strip() == f"### {heading}"]
    assert len(hits) == 1, f"{path} 里应恰好有一个「### {heading}」，实际 {len(hits)} 个"
    return hits[0]


def _load_questions() -> list[dict]:
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    questions = payload["questions"]
    assert len(questions) == 20, "标注集必须保持 20 条（改题面也要保持条数）"
    return questions


def _load_spaced_questions() -> list[dict]:
    """带空格的自然问法（R03）：中英混排 + 空格分隔是最常见的真实问法。

    单独一个数组而不是塞进 ``questions``：上面那条「必须保持 20 条」的硬闸门是既有
    守卫，往 ``questions`` 里追加会逼着把它放宽；这里保持基础 20 条逐字不动，另加
    同 schema 的一组，由同一个参数化用例一起覆盖。
    """
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    questions = payload["spaced_questions"]
    assert len(questions) >= 4, "带空格的标注问法至少 4 条"
    for question in questions:
        assert " " in question["question"], f"{question['id']} 不是带空格的自然问法"
    return questions


def _annotated_questions() -> list[dict]:
    """基础 20 问 + 带空格问法，供同一个用例参数化（新问法自动被既有断言覆盖）。"""
    return [*_load_questions(), *_load_spaced_questions()]


def _chunk(path: str, heading: str, text: str, heading_path: str = "") -> ProductDocChunk:
    return ProductDocChunk(
        path=path,
        heading=heading,
        text=text,
        heading_path=heading_path or heading,
        line=1,
    )


def _user_guide_chunk(heading: str) -> ProductDocChunk:
    matches = [
        chunk
        for chunk in _all_chunks()
        if chunk.path == "docs/user-guide.md" and chunk.heading == heading
    ]
    assert len(matches) == 1, f"用户指南里应恰好有一个「{heading}」小节，实际 {len(matches)}"
    return matches[0]


def _matches_expected(question: dict, chunk: ProductDocChunk) -> bool:
    heading = chunk.heading
    accepted = question["accepted_headings"]
    # 只允许"完全相等"或"标题带编号前缀"两种（``4.3 手动备份`` 对 ``手动备份``）。
    # 不再用 ``item in heading``：那会让「怎么用」这类短标题匹配到任何含它的长标题，
    # 检索结论看起来是绿的，其实命中的是别的章节。
    if not any(heading == item or heading.endswith(item) for item in accepted):
        return False
    return all(part in chunk.heading_path for part in question.get("expected_path_contains") or [])


# ===== 原有入口回归 =====


def test_product_docs_search_finds_resume_preview_guidance():
    results = search_product_docs("简历预览", limit=5)
    assert results
    # README 有两份：默认的英文版 README.md 与中文版 README.zh-CN.md，中文提问命中的是后者。
    assert any(
        item.path.endswith("user-guide.md") or item.path.startswith("README") for item in results
    )
    # 每条结果都能直接引用：相对路径 + #标题路径，不含绝对路径。
    for item in results:
        assert item.source == f"{item.path}#{item.heading_path}"
        assert "#" in item.source and ":" not in item.path


def test_product_docs_tool_is_registered_and_offline(db_session):
    assert "search_product_docs" in tool_names()
    result = execute_tool(db_session, "search_product_docs", {"query": "设置 应用"})
    assert "简历通本地文档" in result.text
    assert result.changed is False


def test_product_docs_search_tolerates_chinese_question_punctuation():
    """问句是全角标点结尾时仍能检索（"页面概览这个按钮的提示语是什么？"）。

    以前"整句都是汉字"的判定会把带「？」的问句排除掉，于是最自然的用户问法反而搜不到，
    助手只能凭记忆答旧说法——这正是 #38 P0 要修的"答旧说法"缺口的一部分。
    """
    results = search_product_docs("页面概览这个按钮的提示语是什么？", limit=5)
    assert results
    # 索引覆盖是结构性的（DOC_PATHS 含 CHANGELOG / docs 递归 / zh-CN 语言包），
    # 这里钉"带标点的中文问句不再被整句判定排除"，且返回结构可用于引用。
    assert all(item.text.strip() for item in results)
    assert all(item.source.startswith(item.path + "#") for item in results)


def test_product_docs_search_reports_no_match_without_inventing_content():
    text = format_product_doc_results("zzzxq-feature-928371", limit=3)
    assert "没有找到" in text
    assert "zzzxq-feature-928371" in text


# ===== 切块：### 粒度 + 父级面包屑 + h4 留在块内 =====


def test_chunks_split_at_third_level_with_parent_breadcrumb():
    chunk = _user_guide_chunk("导出：格式、水印与脱敏")
    # 行号 = "这一块从第几行开始"的锚点，按文件现算：判据仍是"指向标题那一行"，
    # 但在这上面增删段落不再需要手工平移数字（旧写法是写死 1659、每次改文档改一遍）。
    assert chunk.line == _doc_heading_line(chunk.source)
    assert chunk.heading_path == "使用指南 > 4. 制作、编辑和导出简历 > 导出：格式、水印与脱敏"
    assert chunk.source == f"docs/user-guide.md#{chunk.heading_path}"
    # 切块停在 ###：块内不应再出现 1-3 级标题行（出现就说明跨度超过一个小节）。
    for user_guide_chunk in (item for item in _all_chunks() if item.path == "docs/user-guide.md"):
        extra = [
            line for line in user_guide_chunk.text.splitlines()[1:] if _HEADING_LINE.match(line)
        ]
        assert not extra, f"「{user_guide_chunk.heading}」块内混入了下一个章节标题：{extra[:2]}"


def test_deep_headings_stay_inside_their_parent_chunk():
    deep = [chunk for chunk in _all_chunks() if "\n#### " in chunk.text]
    assert deep, "索引里应有把 #### 留在父级小节内的块"
    sample = next(chunk for chunk in deep if chunk.path == "docs/system_design.md")
    assert sample.heading in sample.heading_path
    assert "#### " not in sample.heading
    # 父级面包屑只到 ###：#### 不当标题路径的一段。
    assert sample.heading_path.count(" > ") + 1 <= 3


def test_every_chunk_source_is_relative_path_plus_heading_path():
    chunks = _all_chunks()
    assert len(chunks) > 900
    for chunk in chunks:
        assert not Path(chunk.path).is_absolute()
        assert "\\" not in chunk.path
        assert chunk.line >= 1
        assert chunk.heading
        assert chunk.heading in chunk.breadcrumb
        assert chunk.source == f"{chunk.path}#{chunk.breadcrumb}"


# ===== 片段上限按内容类型给 =====


def test_snippet_limit_depends_on_content_type():
    assert STEPS_SNIPPET_CHARS > MAX_SNIPPET_CHARS
    steps_text = "### 怎么导出\n1. 第一步\n2. 第二步\n" + "说明" * 800
    steps = _chunk("docs/example.md", "怎么导出", steps_text)
    assert steps.is_steps
    assert _snippet_limit(steps) == STEPS_SNIPPET_CHARS
    excerpt = _excerpt(steps)
    assert excerpt.startswith(steps.text[:1200])  # 旧上限 900 之外的步骤内容也要能看到
    assert len(excerpt) <= STEPS_SNIPPET_CHARS + 40

    rule = _chunk("docs/example.md", "合并规则（两条是硬性的）", "很长" * 700)
    prose = _chunk("docs/example.md", "页面概览", "很长" * 700)
    assert _snippet_limit(rule) == RULE_SNIPPET_CHARS
    assert _snippet_limit(prose) == MAX_SNIPPET_CHARS
    assert len(_excerpt(prose)) <= MAX_SNIPPET_CHARS + 40


def test_real_step_section_gets_more_than_the_old_900_chars():
    top = search_product_docs("网申填表怎么用？", k=1)[0]
    assert top.is_steps
    assert len(top.text) > MAX_SNIPPET_CHARS
    assert len(_excerpt(top)) > MAX_SNIPPET_CHARS


# ===== 排序口径 =====


def test_title_hits_weight_leaf_heading_above_parent_breadcrumb():
    matched = ["合并", "并规", "规则"]
    leaf = _chunk("docs/x.md", "合并规则", "无关内容", "使用指南 > 合并规则")
    ancestor_only = _chunk("docs/x.md", "其他章节", "无关内容", "使用指南 > 合并规则说明")
    assert _title_hits(matched, "合并规则", leaf) > _title_hits(matched, "合并规则", ancestor_only)


def test_matched_terms_are_deduplicated():
    # 「样式模板和格式模板」里「模板」出现两次；去重后一个词只贡献一次标题权重。
    chunk = _chunk("docs/x.md", "样式模板和格式模板", "样式模板和格式模板")
    matched = _matched_terms("样式模板和格式模板", chunk)
    assert len(matched) == len(set(matched))
    assert "模板" in matched


def test_ranking_is_title_then_density_then_count():
    # 标题命中：正文几乎不含查询词也应当排第一（标题命中 > 正文密度/次数）。
    title = _chunk("docs/a.md", "合并规则", "无关内容" * 120)
    dense = _chunk("docs/b.md", "其他章节", "合并规则" * 2 + "x" * 100)
    counted = _chunk("docs/c.md", "其他章节", "合并规则" * 6 + "x" * 2000)
    ranked = _rank_chunks("合并规则", [dense, counted, title])
    assert ranked[0] is title, "标题命中必须优先于正文命中"
    assert ranked.index(dense) < ranked.index(counted), "命中密度必须优先于纯次数"


def test_howto_queries_boost_numbered_list_sections():
    prose = _chunk("docs/x.md", "导出说明", "### 导出说明\n" + "正文" * 200)
    steps = _chunk(
        "docs/x.md",
        "导出说明",
        "### 导出说明\n1. 第一步\n2. 第二步\n" + "正文" * 200,
    )
    assert steps.list_items == 2 and not prose.is_steps
    ranked = _rank_chunks("怎么导出说明", [prose, steps])
    assert ranked[0] is steps, "how-to 查询里带列表的步骤小节要加分"
    # 非 how-to 查询不加这个分：两块正文命中相同，列表块不能靠列表数量占便宜；
    # 步骤块正文更长，密度反而略低，所以这里必须排到后面。
    assert _rank_chunks("导出说明", [prose, steps])[0] is prose


# ===== 分词查询（含空格的自然问法）=====


def test_query_terms_splits_only_on_whitespace_queries():
    """无空格查询不切词（``([], False)``）；含空格查询按空格切并标记 split。"""
    assert _query_terms("简历预览") == ([], False)
    assert _query_terms("怎么把简历导出成 pdf") == (["怎么把简历导出成", "pdf"], True)
    # 全是泛词时退回原词表，不能把查询切成"没有检索词"。
    assert _query_terms("简历 按钮") == (["简历", "按钮"], True)


def test_split_query_prefers_sections_that_match_every_term():
    """全命中优先于部分命中：排序第一档只区分"问的词都在这"与"只沾到一部分"。"""
    both = _chunk("docs/x.md", "导出与水印", "导出 水印")
    one = _chunk("docs/y.md", "导出说明", "导出" * 40)
    ranked = _rank_chunks("导出 水印", [one, both])
    assert ranked[0] is both, "全命中的小节必须排在只命中一个词的小节之前"


def test_spaced_natural_question_hits_export_section_without_rewriting():
    """R03 验收：用户原句（含中英混排空格）直接检索就能命中导出章节。

    旧口径要求空格切出的所有词全部命中同一小节，「怎么把简历导出成 PDF」必然零命中，
    模型只能自己改写问法才搜得到——检索门槛不该由模型猜。
    """
    results = search_product_docs("怎么把简历导出成 PDF", limit=3)
    assert results, "带空格的自然问法不该零命中"
    top1 = results[0]
    assert top1.path == "docs/user-guide.md"
    assert top1.heading == "导出：格式、水印与脱敏"
    assert top1.is_steps


# ===== 可选 k 与默认 5 条 =====


def test_default_limit_is_five_and_k_is_optional():
    assert DEFAULT_LIMIT == 5
    assert len(search_product_docs("简历预览")) == DEFAULT_LIMIT
    assert len(search_product_docs("简历预览", k=2)) == 2
    assert len(search_product_docs("简历预览", k=MAX_RESULTS)) == MAX_RESULTS
    assert len(search_product_docs("简历预览", k=0)) == 1
    assert len(search_product_docs("简历预览", k=999)) == MAX_RESULTS
    text = format_product_doc_results("简历预览", k=2)
    assert "[文档1]" in text and "[文档2]" in text and "[文档3]" not in text
    assert "简历通本地文档" in text


# ===== 20 问标注集（top1 必须命中人工标注标题） =====


def test_fixture_headings_and_answer_phrases_are_still_valid():
    """标注集自身的一致性：标题必须还在索引里，答案要点必须非空。

    这条不测检索、只测**标注集有没有腐坏**，作用是让"标题改名"的失败点落在这里：
    改手册标题后如果只改文档，20 问会在检索用例里报"期望 X，实际 top1 = Y"，改的人
    得反推是文档错了还是标注过期；有这条之后，失败信息直接说"「X」已不在任何被索引
    文档的标题里，请把新标题加进该题的 accepted_headings"。

    标题改名的正确顺序（三步，缺一步就红）：
    1. 改文档标题；
    2. 把新标题加进该题的 ``accepted_headings``（旧标题**只有仍存在时**才留着）；
    3. 跑本文件——``answer_phrases`` 若提到了改名的设置页分组，同批更新。
    """
    headings = {chunk.heading for chunk in _all_chunks()}
    payload = json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))
    problems: list[str] = []
    for question in payload["questions"] + payload["spaced_questions"]:
        accepted = question["accepted_headings"]
        if question["expected_heading"] not in accepted:
            problems.append(f"{question['id']}：expected_heading 不在 accepted_headings 里")
        problems.extend(
            f"{question['id']}：「{item}」已不在任何被索引文档的标题里，请把新标题加进 accepted_headings"
            for item in accepted
            if item not in headings
        )
        if not question.get("answer_phrases"):
            problems.append(
                f"{question['id']}：缺 answer_phrases（至少要一条能在 top1 里找到的原话）"
            )
    assert not problems, "标注集需要同步：\n" + "\n".join(problems)


@pytest.mark.parametrize("question", _annotated_questions(), ids=lambda item: item["id"])
def test_annotated_questions_hit_expected_headings(question):
    results = search_product_docs(question["question"])
    assert results, f"{question['id']} 检索结果为空"
    top1 = results[0]
    assert _matches_expected(question, top1), (
        f"{question['id']} 期望「{question['expected_heading']}」，实际 top1 = {top1.source}"
    )
    # 返回的 source 能直接被回答引用，且 format_product_doc_results 会带出同一来源。
    assert top1.source == f"{top1.path}#{top1.heading_path}"
    assert top1.source in format_product_doc_results(question["question"], k=1)
    # answer_phrases 以前是"只给人看的备注"，没人断言，于是设置页分组改名后仍写着
    # 「助手与 AI 行为」「数据与导出」两个已不存在的路径。现在逐条要求出现在 top1 里：
    # 它是"答案有没有跟着文档走"的最短判据，也不需要另建一套语料。
    missing = [phrase for phrase in question["answer_phrases"] if phrase not in top1.text]
    assert not missing, (
        f"{question['id']} 的答案要点在 top1 里找不到：{missing}。"
        f"若文档确实改了叫法（如设置页分组改名），同步更新该题的 answer_phrases"
    )
    if question.get("expect_steps"):
        assert top1.is_steps, f"{question['id']} 的 how-to top1 不是步骤小节：{top1.source}"


def test_howto_questions_cover_at_least_five_and_all_hit_step_sections():
    howto = [item for item in _load_questions() if item["kind"] == "howto"]
    assert len(howto) >= 5
    for question in howto:
        top1 = search_product_docs(question["question"], k=1)[0]
        assert _matches_expected(question, top1)
        assert top1.is_steps, f"{question['id']} top1 不是步骤小节：{top1.source}"
