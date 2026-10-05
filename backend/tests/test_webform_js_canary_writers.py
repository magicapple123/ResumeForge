"""写入/回读脚本的真机验证：事件序列、滚入视口、contenteditable 回读。

这些行为**只有真跑 JS 才看得见**：离线假客户端只返回预设字符串，脚本里写了
``focus()`` 有没有真的拿到焦点、``blur`` 会不会被派发、contenteditable 读
``textContent`` 还是 ``value``——字符串断言一律管不着。踩过的坑就在本文件对应的
实现里：富文本回读读 ``el.value`` 恒为空串，填完永远被判 ``unverified``。
"""
import json

from app.services.webform.engine import (
    _read_back_script,
    _set_richtext_script,
    _set_value_script,
)
from webform_canary_support import page_client

__all__ = ["page_client"]

_RECORDER = """
(() => {
  window.__rfEvents = [];
  const el = document.querySelector(%s);
  for (const type of ['focus', 'input', 'change', 'blur']) {
    el.addEventListener(type, () => window.__rfEvents.push(type));
  }
  return true;
})()
"""


def test_the_value_writer_focuses_and_fires_input_change_without_blur(page_client):
    """happy path：写值前聚焦、写后 input + change，**不发 blur**。

    blur 会触发站点校验提示，个别站点还会在 onblur 里清掉未通过校验的值——
    所以它只属于重试路径（``full_events=True``）。

    **真机语义**：``el.focus()`` 只有在文档本身有焦点时才派发 focus 事件——
    后台标签里 activeElement 照样会设上、值照样写进去，但没有 focus/blur 事件。
    用户在用这个工具时页面就是前台（这也是 ``Page.bringToFront`` 在这里出现的原因，
    与应用里 trusted_click 的做法一致）。
    """
    page_client.send("Page.bringToFront")
    page_client.evaluate("window.scrollTo(0, 0)")
    page_client.evaluate(_RECORDER % json.dumps("#deep-name"))
    page_client.evaluate(
        _set_value_script("#deep-name", "张三", prototype="HTMLInputElement")
    )

    events = json.loads(page_client.evaluate("JSON.stringify(window.__rfEvents)"))
    active = page_client.evaluate("document.activeElement && document.activeElement.id")

    assert events == ["focus", "input", "change"], events
    assert active == "deep-name", active


def test_full_events_adds_the_blur_only_when_asked(page_client):
    """重试路径补发 blur —— 少数站点把值同步/校验挂在 onblur 上。"""
    page_client.send("Page.bringToFront")
    page_client.evaluate(_RECORDER % json.dumps("#long-note"))
    page_client.evaluate(
        _set_value_script(
            "#long-note", "换行说明", prototype="HTMLTextAreaElement", full_events=True
        )
    )

    events = json.loads(page_client.evaluate("JSON.stringify(window.__rfEvents)"))
    assert events == ["focus", "input", "change", "blur"], events


def test_the_writer_scrolls_a_far_away_control_into_view(page_client):
    """写值前先滚进视口：一部分组件只在"真的被看到"之后才同步内部状态。"""
    page_client.evaluate("window.scrollTo(0, 0)")
    assert page_client.evaluate("window.scrollY") == 0

    page_client.evaluate(
        _set_value_script("#far-away", "滚过来的值", prototype="HTMLInputElement")
    )

    scrolled = page_client.evaluate("window.scrollY")
    in_view = page_client.evaluate(
        "(() => { const r = document.querySelector('#far-away').getBoundingClientRect();"
        " return r.top >= 0 && r.bottom <= window.innerHeight; })()"
    )
    assert scrolled > 0, "没有发生滚动"
    assert in_view is True, "控件没有被滚进视口"


def test_richtext_read_back_reads_text_content_not_value(page_client):
    """contenteditable 没有 ``value``：回读必须走 ``textContent``。

    旧实现一律读 ``el.value``（恒为空串），富文本框填完永远被判 ``unverified``。
    """
    page_client.evaluate(
        _set_richtext_script("#rich-note", "熟悉 Python 与 TypeScript")
    )

    rich = json.loads(page_client.evaluate(_read_back_script("#rich-note", rich=True)))
    plain = json.loads(page_client.evaluate(_read_back_script("#rich-note")))

    assert rich["ok"] is True
    assert rich["value"] == "熟悉 Python 与 TypeScript"
    # 记录旧行为的后果：不传 rich 时读出来是空串——这正是那个 bug 的形状。
    assert plain["value"] == ""
