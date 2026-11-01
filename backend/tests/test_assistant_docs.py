# SPDX-License-Identifier: Apache-2.0
from app.services.assistant_docs import format_product_doc_results, search_product_docs
from app.services.assistant_tools import execute_tool, tool_names


def test_product_docs_search_finds_resume_preview_guidance():
    results = search_product_docs("简历预览", limit=5)
    assert results
    assert any(item.path.endswith("user-guide.md") or item.path == "README.md" for item in results)


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
    # 这里只钉"带标点的中文问句不再被整句判定排除"。
    assert all(item.text.strip() for item in results)


def test_product_docs_search_reports_no_match_without_inventing_content():
    text = format_product_doc_results("zzzxq-feature-928371", limit=3)
    assert "没有找到" in text
    assert "zzzxq-feature-928371" in text
