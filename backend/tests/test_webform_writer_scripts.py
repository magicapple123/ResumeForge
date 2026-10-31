# SPDX-License-Identifier: Apache-2.0
"""写入/回读注入脚本的**字符串级**回归。

真机行为由 test_webform_js_canary_writers.py 覆盖（需要本地受控浏览器）；这里钉住
两条"在真浏览器里会抛异常、而离线假客户端永远看不见"的性质：

- 富文本回读不能引用 select 分支才有的变量：selected 在 richtext 路径上是 null，
  一引用就 TypeError，富文本回读永远判 unverified（canary 真机用例抓到的缺陷）；
- contenteditable 没有 value：value / display 都必须从 textContent 读。
"""

from app.services.webform.engine import _read_back_script, _set_richtext_script


def test_rich_read_back_reads_text_content_for_both_value_and_display():
    script = _read_back_script("#rich-note", rich=True)

    assert "el.textContent" in script
    assert "String(el.value" not in script
    # selected 只可能是 null（富文本不是 select），引用它的属性会直接抛异常。
    assert "selected.textContent" not in script


def test_plain_read_back_keeps_the_select_display_fallback():
    script = _read_back_script("#degree")

    assert "el.value" in script
    # 自定义下拉的显示值画在容器里：value 为空时退回祖先 textContent（display 兜底）。
    assert "selected ? (selected.textContent || '').trim() : boxText" in script


def test_richtext_writer_sets_text_content_and_fires_input_change():
    script = _set_richtext_script("#rich-note", "熟悉 Python")

    assert "el.textContent =" in script
    assert "dispatchEvent(new Event('input'" in script
    # change 也必须发：一部分编辑器只在 change 时同步内部状态。
    assert "dispatchEvent(new Event('change'" in script
