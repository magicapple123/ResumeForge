"""版面诊断与「自动一页」的规则。

这些规则决定"要不要让人改版式、先改哪一项、字号能缩到多小"，全是判断，所以逐条钉住。
最要紧的两条：

- **建议的顺序**：先让人调间距、调不好再让人删内容，等于让人白改一轮；反过来先说
  "精简内容"，用户又可能删掉本来放得下的经历。
- **字号下限按绝对像素算**：同一个系数在小字号档上会缩得更狠，只盯比例会让小字号档
  一路缩到 10px 以下。

拆分说明：字号下限 / 收紧阶梯用例已迁至 test_resume_layout_ladder.py；
模板 CSS 漂移守卫与全部 CSS 解析 helper 已迁至 test_resume_layout_templates.py。
"""
import re

import pytest
from app.services.resume.resume_layout import (
    FILL_DENSE,
    FILL_SPARSE,
    STATUS_DENSE,
    STATUS_HEALTHY,
    STATUS_OVERFLOW,
    STATUS_SPARSE,
    STATUS_TOO_SPARSE,
    STATUS_UNKNOWN,
    SUGGESTION_EXTEND,
    derive_pages,
    diagnose,
)

PAGE = 2600.0  # 一页正文可用高度，约等于 A4 去上下页边距后的像素值


# ===== 高度换算 =====


def test_derive_pages_single_page():
    pages, needed, fill = derive_pages(1300, PAGE, 1)
    assert needed == 1
    assert fill == 0.5
    assert [(p.page, p.fill) for p in pages] == [(1, 0.5)]


def test_derive_pages_exactly_full_is_one_page():
    pages, needed, fill = derive_pages(PAGE, PAGE, 1)
    assert needed == 1
    assert fill == 1.0
    assert len(pages) == 1


def test_derive_pages_overflow_by_a_hair_still_needs_a_second_page():
    """超一点点也算超——打印出来确实会多出一页，不该替用户粉饰。

    注意这里断言的是「需要第 2 页」而不是 fill > 1：fill 是给界面看的读数，
    四舍五入到三位小数后 1.0002 会显示成 1.0，**判断结论不能建立在它上面**。
    """
    pages, needed, _ = derive_pages(PAGE + 0.5, PAGE, 1)
    assert needed == 2
    assert len(pages) == 2


def test_derive_pages_multi_page_reports_the_last_page():
    pages, needed, _ = derive_pages(PAGE * 1.2, PAGE, 2)
    assert needed == 2
    assert pages[0].fill == 1.0
    assert pages[1].fill == pytest.approx(0.2)


def test_derive_pages_never_reports_zero_pages():
    pages, needed, fill = derive_pages(0, PAGE, 1)
    assert needed == 1
    assert fill == 0.0
    assert [(p.page, p.fill) for p in pages] == [(1, 0.0)]


def test_derive_pages_guards_against_a_zero_page_height():
    """页面高度量成 0（还没渲染完就量了）时不能除零，返回空结果让上层走「无法测量」。"""
    assert derive_pages(100, 0, 1) == ([], 0, 0.0)
    assert derive_pages(100, PAGE, 0) == ([], 0, 0.0)


# ===== 诊断 =====


@pytest.mark.parametrize(
    ("used", "expected"),
    [
        (PAGE * 0.50, STATUS_TOO_SPARSE),
        (PAGE * 0.70, STATUS_SPARSE),
        (PAGE * FILL_SPARSE, STATUS_HEALTHY),  # 正好在下边界上算健康
        (PAGE * 0.90, STATUS_HEALTHY),
        (PAGE * FILL_DENSE, STATUS_HEALTHY),  # 正好在上边界上也算健康
        (PAGE * 0.99, STATUS_DENSE),
        (PAGE * 1.05, STATUS_OVERFLOW),
    ],
)
def test_single_page_status_boundaries(used, expected):
    assert diagnose(used_height=used, page_content_height=PAGE, page_limit=1).status == expected


def test_multi_page_flags_an_empty_last_page():
    """第一页塞满、第二页只有两行——这是多页简历最常见的问题。"""
    result = diagnose(used_height=PAGE * 1.2, page_content_height=PAGE, page_limit=2)
    assert result.status == STATUS_SPARSE
    assert "末页" in result.summary
    # 报的是实测填充度，不是阈值——阈值写进文案等于让用户自己去对表格。
    assert "20%" in result.summary
    assert result.pages[-1].fill == pytest.approx(0.2, abs=0.01)


def test_multi_page_with_a_healthy_last_page_is_fine():
    result = diagnose(used_height=PAGE * 1.9, page_content_height=PAGE, page_limit=2)
    assert result.status == STATUS_HEALTHY


def test_unmeasurable_layout_is_reported_honestly():
    result = diagnose(used_height=100, page_content_height=0, page_limit=1)
    assert result.status == STATUS_UNKNOWN
    assert "无法" in result.summary


# ===== 建议顺序 =====


def test_overflow_suggestions_follow_the_documented_order():
    """重排 → 结构 → 间距/字号 → 精简内容 → 扩页。顺序本身就是规则。"""
    result = diagnose(used_height=PAGE * 1.4, page_content_height=PAGE, page_limit=1)
    kinds = [item.kind for item in result.suggestions]
    assert kinds == [
        "restructure",
        "structure",
        "spacing",
        "content",
        "extend",
    ]


def test_no_fit_room_changes_the_advice_instead_of_repeating_itself():
    """版式已经收到底时不该再让人「自动一页」——那是条死路。"""
    result = diagnose(
        used_height=PAGE * 1.4, page_content_height=PAGE, page_limit=1, has_fit_room=False
    )
    kinds = [item.kind for item in result.suggestions]
    assert "spacing" not in kinds
    assert "font" in kinds
    assert "已经到下限量" in " ".join(item.detail for item in result.suggestions)


def test_overflow_at_the_page_limit_does_not_offer_more_pages():
    """页数上限已经是 3 页时不该再说"增加页数"。"""
    result = diagnose(used_height=PAGE * 3.5, page_content_height=PAGE, page_limit=3)
    assert SUGGESTION_EXTEND not in [item.kind for item in result.suggestions]


def test_sparse_single_page_suggests_filling_not_shrinking():
    result = diagnose(used_height=PAGE * 0.5, page_content_height=PAGE, page_limit=1)
    kinds = [item.kind for item in result.suggestions]
    assert "content" in kinds
    assert "spacing" not in kinds
    assert "extend" not in kinds


def test_sparse_multi_page_suggests_reducing_the_page_count():
    result = diagnose(used_height=PAGE * 0.6, page_content_height=PAGE, page_limit=2)
    first = result.suggestions[0]
    assert first.kind == SUGGESTION_EXTEND
    # 内容本来一页就够，可以直接减页。
    assert "1 页" in first.title


def test_empty_last_page_with_no_spare_page_counts_how_much_to_cut():
    """末页空、但页数已经压到刚好装下时，要说清"还要压掉多少"，而不是「精简一下」。"""
    result = diagnose(used_height=PAGE * 1.19, page_content_height=PAGE, page_limit=2)
    assert result.status == STATUS_SPARSE
    first = result.suggestions[0]
    assert first.kind == "restructure"
    # 需要再压掉约 16%（1.19 页 -> 1 页）
    percent = re.search(r"约 (\d+)%", first.detail)
    assert percent is not None
    assert 12 <= int(percent.group(1)) <= 20


def test_healthy_layout_says_so_without_pushing_changes():
    result = diagnose(used_height=PAGE * 0.9, page_content_height=PAGE, page_limit=1)
    assert result.status == STATUS_HEALTHY
    assert len(result.suggestions) == 1
    assert "保持即可" in result.suggestions[0].title
