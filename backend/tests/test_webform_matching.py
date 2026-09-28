"""取值决策的纯函数测试：选哪个下拉项、日期怎么写。

这些都是**纯函数**（只吃数据、不碰浏览器），所以可以穷举边界。之所以把判断从注入的
JS 里搬到 Python，就是为了让"选错选项"这类错误能在单元测试里被抓住——旧实现把它们
留在 JS 里，而假客户端不执行 JS，等于没有覆盖。
"""
import pytest

from app.services.webform.matching import (
    SelectOption,
    aliases_of,
    format_date,
    is_ongoing,
    is_placeholder,
    normalize_option_text,
    resolve_select_option,
)


# ===== 文本规范化与占位项 =====


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("  请选择  ", "请选择"),
        ("--请选择--", "请选择"),
        ("（本科）", "本科"),
        ("ＢＡＣＨＥＬＯＲ", "bachelor"),  # 全角转半角 + 小写
        ("本科：", "本科"),
        # 选项文本来自 textContent，不会带 HTML 标签；尖括号只是被当作装饰性符号去掉。
        ("<本科>", "本科"),
    ],
)
def test_normalize_option_text(raw, expected):
    assert normalize_option_text(raw) == expected


@pytest.mark.parametrize(
    "text",
    ["", "请选择", "请选择…", "--请选择--", "Please select", "choose", "全部", "不限", "-", "—"],
)
def test_placeholders_are_recognized(text):
    assert is_placeholder(text) is True


@pytest.mark.parametrize("text", ["无", "本科", "男", "其他", "暂不填写", "0"])
def test_meaningful_options_are_not_placeholders(text):
    """**「无」不是占位项**——"婚姻状况：无"是一个合法答案。

    占位项的共同特征是"没有做出选择"，而不是"值为空"。
    """
    assert is_placeholder(text) is False


# ===== 别名组 =====


def test_aliases_are_bidirectional_within_a_group():
    bachelor = aliases_of("本科")
    assert "大学本科" in bachelor
    assert "bachelor" in bachelor
    # 反着来也要找得到：拿别名当输入时同样能取到整组。
    assert aliases_of("大学本科") >= {"本科", "bachelor"}


def test_an_unknown_value_has_only_itself():
    assert aliases_of("某个不存在的值") == {"某个不存在的值"}


# ===== 下拉选项匹配 =====

DEGREES = [
    SelectOption("", "请选择"),
    SelectOption("3", "本科"),
    SelectOption("4", "硕士研究生"),
]


def test_exact_text_match():
    result = resolve_select_option(DEGREES, "本科")
    assert result.status == "matched"
    assert result.option.value == "3"


def test_alias_match():
    """资料里写"大学本科"，页面选项是"本科"——别名要能接上。"""
    result = resolve_select_option(DEGREES, "大学本科")
    assert result.status == "matched"
    assert result.option.value == "3"


def test_match_against_the_option_value_too():
    """有些站点选项文本是英文/代号，`value` 才是有效信息。"""
    options = [SelectOption("", "请选择"), SelectOption("硕士", "Master")]
    result = resolve_select_option(options, "硕士")
    assert result.status == "matched"
    assert result.option.value == "硕士"


def test_placeholder_is_never_selected_even_if_it_matches():
    """取值恰好等于占位文案时也不选它——那等于什么都没选。"""
    result = resolve_select_option(DEGREES, "请选择")
    assert result.status == "no_option"


def test_disabled_options_are_ignored():
    options = [SelectOption("", "请选择"), SelectOption("3", "本科", disabled=True)]
    assert resolve_select_option(options, "本科").status == "no_option"


def test_an_empty_option_list_means_a_cascading_select():
    """级联下拉在上一级未选时 options 为空——要给出可操作的解释，而不是静默失败。"""
    result = resolve_select_option([], "北京")
    assert result.status == "no_option"
    assert "联动" in result.reason


def test_only_placeholders_also_means_cascading():
    result = resolve_select_option([SelectOption("", "请选择")], "北京")
    assert result.status == "no_option"
    assert "联动" in result.reason


def test_multiple_equal_matches_are_ambiguous_not_a_guess():
    """两个选项都沾边时不猜——选错比不选更糟。"""
    options = [SelectOption("1", "本科"), SelectOption("2", "本科")]
    result = resolve_select_option(options, "本科")
    assert result.status == "ambiguous"
    assert result.option is None


def test_containment_prefers_a_unique_hit_and_refuses_two():
    unique = [SelectOption("1", "全日制本科（学士）")]
    assert resolve_select_option(unique, "本科").status == "matched"

    ambiguous = [SelectOption("1", "本科及以上"), SelectOption("2", "本科以下")]
    assert resolve_select_option(ambiguous, "本科").status == "ambiguous"


def test_no_option_reports_the_value_so_the_user_can_act():
    result = resolve_select_option(DEGREES, "高中")
    assert result.status == "no_option"
    assert "高中" in result.reason


def test_empty_value_is_not_a_match_request():
    assert resolve_select_option(DEGREES, "   ").status == "empty"


# ===== 日期 =====


@pytest.mark.parametrize(
    "raw, kind, expected",
    [
        ("2022.09", "text", "2022.09"),
        ("2022.09", "month", "2022-09"),
        ("2022-09", "month", "2022-09"),
        ("2022/9", "month", "2022-09"),
        ("2022年9月", "month", "2022-09"),
        ("2022.09.15", "date", "2022-09-15"),
        ("2022年9月15日", "date", "2022-09-15"),
        ("2022", "year", "2022"),
    ],
)
def test_format_date_understood_shapes(raw, kind, expected):
    result = format_date(raw, kind=kind)
    assert result.status == "matched"
    assert result.value == expected


def test_a_missing_day_is_assumed_but_flagged():
    """年月有了、日没有时补 1 号，但**必须把这件事标出来**——预览要提示用户核对。"""
    result = format_date("2022.09", kind="date")
    assert result.status == "matched"
    assert result.value == "2022-09-01"
    assert result.assumed_day is True


def test_a_year_only_value_is_refused_for_a_date_control():
    """只有年份时不往日期控件里塞——`2022-01-01` 的月和日是我们编的。"""
    result = format_date("2004", kind="date")
    assert result.status == "unparsed"
    assert "只有年份" in result.reason


def test_ongoing_is_a_valid_answer_but_not_a_date():
    result = format_date("至今", kind="date")
    assert result.status == "ongoing"
    assert result.value == ""


def test_garbage_is_refused_rather_than_guessed():
    result = format_date("去年", kind="date")
    assert result.status == "unparsed"


def test_empty_date_is_reported_as_missing_data():
    assert format_date("", kind="date").status == "empty"


def test_is_ongoing_recognizes_common_wording():
    for text in ("至今", "现在", "在职", "present", "Current"):
        assert is_ongoing(text) is True
    assert is_ongoing("2022.09") is False
