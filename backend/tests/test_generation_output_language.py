# SPDX-License-Identifier: Apache-2.0
"""生成链路的输出语言：英文简历必须生成英文正文。

这里守的是一条容易被混淆的边界：**界面语言不参与判断**。用户可以在中文界面下做一份
英文简历，也可以把界面切成英文但继续编辑中文简历；决定正文语言的自始至终只有
``resume.language``（落在 ``resume_record.language``）。

另一半同样重要：中文链路的提示词必须**逐字节不变**——既有 golden、导出基线与
``render_config_fingerprint`` 都以这条提示词为输入，多一个空格都会让"内容没变却
指纹变了"成立。所以实现是"额外追加一段"，不是"改写模板"。
"""

from app.services.resume.resume_generation_helpers import with_output_language


def test_english_resume_gets_english_rule() -> None:
    prompt = with_output_language("BASE", "en-US")

    assert prompt.startswith("BASE")
    assert "English" in prompt


def test_chinese_prompt_is_untouched() -> None:
    assert with_output_language("BASE", "zh-CN") == "BASE"


def test_missing_language_falls_back_to_untouched_prompt() -> None:
    """旧请求/旧记录读不出语言时走中文路径，不能凭空加一段英文指令。"""
    assert with_output_language("BASE", None) == "BASE"


def test_unknown_language_is_not_guessed() -> None:
    """只有 zh-CN / en-US 有完整文案表；其余值一律按原样处理，不猜、不翻译。"""
    assert with_output_language("BASE", "ja-JP") == "BASE"


def test_rule_keeps_headings_out_of_model_hands() -> None:
    """小节标题由 ``resume_labels.py`` 按纸面语言提供，模型不许自己写标题。"""
    assert "不要自己写标题" in with_output_language("", "en-US")


def test_rule_forbids_transliterating_proper_nouns() -> None:
    """公司/学校/项目名保留原文：简历上的机构名被音译等于改了事实。"""
    assert "不音译" in with_output_language("", "en-US")
