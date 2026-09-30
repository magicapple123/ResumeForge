"""重复网申区块解析的纯函数测试。"""

from app.services.webform.fields import FIELD_LABELS
from app.services.webform.repeated_fields import (
    compatible_block,
    field_key_for_block,
    field_label_for_key,
    parse_block_label,
    parse_index,
    split_repeated_key,
)


def test_block_labels_support_numeric_and_chinese_indexes():
    assert parse_block_label("实习经历-2").family == "experience"
    assert parse_block_label("项目经历第３条").index == 3
    assert parse_block_label("第十二条校园经历").index == 12
    assert parse_block_label("教育经历 2").index == 2


def test_block_labels_accept_the_repeated_profile_group_names():
    assert parse_block_label("实习和工作补充-2").family == "experience"
    assert parse_block_label("校园和社会实践第2条").family == "campus"
    assert parse_block_label("竞赛和获奖 3").family == "award"
    assert parse_block_label("证书补充第4条").family == "certificate"


def test_chinese_index_parser_handles_tens():
    assert parse_index("十") == 10
    assert parse_index("二十一") == 21
    assert parse_index("０３") == 3


def test_dynamic_field_keys_keep_the_block_number():
    assert field_key_for_block("experience_company", "experience", 2) == (
        "experience_2_company"
    )
    assert field_key_for_block("school", "education", 2) == "education_2_school"
    assert split_repeated_key("experience_2_company") == ("experience_company", 2)
    assert field_label_for_key("experience_2_company", "实习单位") == "实习单位（第二条）"
    assert field_label_for_key("experience_2_company", "实习单位（第一条）") == "实习单位（第二条）"
    assert field_label_for_key("experience_company", FIELD_LABELS["experience_company"]) == "实习单位（第一条）"


def test_a_repeated_field_cannot_cross_block_families_or_indexes():
    assert compatible_block("experience_company", "experience", 2, target_index=2)
    assert not compatible_block("experience_company", "experience", 1, target_index=2)
    assert not compatible_block("experience_company", "project", 2, target_index=2)
