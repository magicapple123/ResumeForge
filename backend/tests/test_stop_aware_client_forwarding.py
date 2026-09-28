"""``StopAwareCdpClient`` 必须覆写 ``CdpClient`` 的**每一个**公开方法。

## 为什么需要这条测试

``task_runner.py`` 里那段注释讲得很清楚：``CdpClient`` 给部分方法提供了"不支持"的
空实现（返回空列表、返回 ``False``），所以包装层忘了转发**不会报错**——它安静地退化成
"这个能力不可用"。后果是离线测试全绿、而生产里那条路径从未生效：

- 漏转发事件订阅 → 网络优先采集悄悄退回 DOM 抓取；
- 漏转发 ``ensure_page_visible`` → 窗口不可见时点击被站点忽略，投递卡在等待上超时。

这类缺陷没有报错、没有失败用例，只有"功能一直不太好用"。所以把那段注释变成不变量：
**新增任何 ``CdpClient`` 的公开方法，就必须在包装层显式转发**，否则这条测试红。
"""
import inspect

from app.services.apply.task_runner import StopAwareCdpClient
from app.services.browser.cdp_client import CdpClient, WindowAwareMixin

# 为什么不插停止检查点的成员：
# - ``close`` 是资源释放，停止时本来就要放行；
# - ``stop_event_capture`` / ``drain_events`` 是纯本地取缓冲，插检查点会把已拦到的响应丢掉。
_INTENTIONALLY_NOT_GUARDED = frozenset({"close", "stop_event_capture", "drain_events"})


def _public_methods(cls) -> set[str]:
    return {
        name
        for name, _ in inspect.getmembers(cls, predicate=inspect.isfunction)
        if not name.startswith("_")
    }


def test_every_cdp_client_method_is_forwarded():
    # **两个来源都要算**：``ensure_page_visible`` 与 ``switch_to_target`` 只在
    # ``WindowAwareMixin`` 上（``CdpClient`` 自己不声明），而它们恰恰是最典型的
    # "漏了不报错、只在生产里静默失效"的两个能力。
    declared = _public_methods(CdpClient) | _public_methods(WindowAwareMixin)
    assert declared, "没找到任何公开方法，这条测试就失去意义了"

    missing = sorted(declared - set(vars(StopAwareCdpClient)))
    assert not missing, (
        f"StopAwareCdpClient 没有转发这些 CdpClient 方法：{missing}。"
        "基类给的是空实现，漏转发不会报错、只会让该能力在生产里静默失效——"
        "补上转发，或在此处显式说明为什么不转发。"
    )


def test_the_guard_is_called_before_forwarding():
    """转发不等于"插了检查点"：停止信号必须真的在调用前被检查到。"""
    calls: list[str] = []

    class Inner(CdpClient):
        def list_targets(self):
            calls.append("inner")
            return []

        def new_tab(self, url="about:blank"):
            calls.append("inner")
            return "TAB"

        def send(self, method, params=None, *, timeout=None):
            calls.append("inner")
            return {}

        def evaluate(self, expression, *, timeout=None):
            calls.append("inner")
            return None

        def set_file_input(self, selector, files, *, timeout=None):
            calls.append("inner")

        def navigate(self, url, *, timeout=None):
            calls.append("inner")
            return {}

        def close(self):
            calls.append("inner")

    client = StopAwareCdpClient(Inner(), lambda: calls.append("guard"))
    client.evaluate("1")
    client.list_targets()

    # 每次转发之前都先过检查点，顺序不能反。
    assert calls == ["guard", "inner", "guard", "inner"]
