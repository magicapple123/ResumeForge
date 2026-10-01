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


def test_product_docs_search_reports_no_match_without_inventing_content():
    text = format_product_doc_results("zzzxq-feature-928371", limit=3)
    assert "没有找到" in text
    assert "zzzxq-feature-928371" in text
