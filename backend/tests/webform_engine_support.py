"""网申引擎离线测试的共享替身：按调用顺序应答的假客户端与执行语料加载。

``test_webform_engine.py`` 里的 ``FakeCdpClient`` 是"按子串静态应答"，同一轮里
同一类调用只能拿到同一个答案——写入→回读→重试这类**有先后顺序**的序列它表达不了。
``ScriptedCdpClient`` 用一份有序脚本补上这块，执行语料（fixtures/webform/execution）
与恢复/重试类用例都基于它。
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.services.browser.cdp_client import CdpClient
from app.services.webform.engine import FormEngine

FIXTURES_DIR = Path(__file__).resolve().parent / "fixtures" / "webform"

_EXCEPTIONS = {
    "RuntimeError": RuntimeError,
    "ValueError": ValueError,
    "TimeoutError": TimeoutError,
}


class ScriptedCdpClient(CdpClient):
    """按调用顺序应答的假客户端：第 N 次 ``evaluate`` 必须命中脚本第 N 条。

    ``steps`` 是 ``[{"needle": "rf:set-value", "reply": ...}, ...]`` 的有序列表。
    ``reply`` 可以是字符串（原样返回）、``None``，或
    ``{"raise": "RuntimeError", "message": "..."}``（抛出对应异常）。
    多一次、少一次、顺序不符都会直接断言失败——脚本就是调用序列的规格，
    顺序错了要显式改脚本，不允许静默放过。
    """

    def __init__(self, steps: list[dict[str, Any]]):
        self.steps = list(steps)
        self.cursor = 0
        self.expressions: list[str] = []
        self.sent: list[tuple[str, dict]] = []

    # --- CdpClient 接口（与 FakeCdpClient 相同的空实现面） ---
    def list_targets(self):  # noqa: ANN201 - 与基类假实现保持一致
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "TAB"

    def send(self, method, params=None, *, timeout=None):  # noqa: ANN001, ANN201
        self.sent.append((method, dict(params or {})))
        return {}

    def evaluate(self, expression, *, timeout=None):  # noqa: ANN001, ANN201
        self.expressions.append(expression)
        assert self.cursor < len(self.steps), (
            f"多出的第 {self.cursor + 1} 次 evaluate（脚本只有 {len(self.steps)} 条）："
            f"{expression[:120]!r}"
        )
        step = self.steps[self.cursor]
        assert _matches(step["needle"], expression), (
            f"第 {self.cursor + 1} 次 evaluate 与脚本不符：期望包含 {step['needle']!r}，"
            f"实际 {expression[:160]!r}"
        )
        self.cursor += 1
        return _materialize(step.get("reply"))

    def set_file_input(self, selector, files, *, timeout=None):  # noqa: ANN001
        pass

    def close(self):  # noqa: ANN201
        pass

    # --- 断言辅助 ---
    def calls(self, needle: str) -> int:
        """整个序列里命中 ``needle`` 的 evaluate 次数（如 ``rf:set-value``）。

        匹配规则见 ``_matches``：脚本标记按整段 ``/* rf:xxx */`` 精确匹配，
        ``rf:select-option`` 不会命中 ``rf:select-options``。
        """
        return sum(1 for expression in self.expressions if _matches(needle, expression))

    def sent_calls(self, method: str) -> int:
        return sum(1 for name, _params in self.sent if name == method)

    def assert_finished(self) -> None:
        assert self.cursor == len(self.steps), (
            f"脚本还有 {len(self.steps) - self.cursor} 条没有被执行："
            f"{[step['needle'] for step in self.steps[self.cursor:]]}"
        )


def _matches(needle: str, expression: str) -> bool:
    """脚本标记按整段注释精确匹配，避免 ``rf:select-option`` 子串命中
    ``/* rf:select-options */`` 这类前缀陷阱（真实踩过：断言"一次选项写入都没有"
    被选项**读取**计数污染）。非 ``rf:`` 前缀的 needle 退化为包含匹配。"""
    if needle.startswith("rf:"):
        return f"/* {needle} */" in expression
    return needle in expression


def _materialize(reply: Any) -> Any:
    if isinstance(reply, dict) and "raise" in reply:
        name = str(reply["raise"])
        error_type = _EXCEPTIONS.get(name)
        assert error_type is not None, f"脚本里不认识的异常类型：{name}"
        raise error_type(str(reply.get("message", "")))
    return reply


def load_execution_cases() -> list[dict[str, Any]]:
    """加载执行语料（``fixtures/webform/execution/*.json``），按文件名排序。"""
    return [
        json.loads(path.read_text(encoding="utf-8"))
        for path in sorted((FIXTURES_DIR / "execution").glob("*.json"))
    ]


def run_execution_case(case: dict[str, Any]):
    """跑一个执行语料：匹配 → 按脚本写入/回读，返回 ``(outcomes, client)``。

    两条入口，对应两种真实来源：

    - ``profile``：**自动匹配**（预览/实时）——只可能产出文本类映射，因为下拉 / 单选 /
      复选 / 日期 / 弹层选择器在 ``skip_reason`` 就被挡下（"只填不点"，2026-10-05）。
    - ``selections``：**显式填充**（``/fill``）——用户在预览里确认过的
      ``(控件序号, 字段, 值)``，整理映射用的是 ``service.fill._rebuild_mapping``，
      与真正的填充请求同一条路。想覆盖下拉/单选的执行纪律就用它。

    要求脚本被**恰好**执行完（``assert_finished``），所以每条语料同时钉住了
    调用序列本身——写入发出几次、回读几次、有没有多余动作。
    """
    from app.services.webform.service.fill import _rebuild_mapping

    engine = FormEngine()
    controls = engine.snapshot_controls(case["controls"])
    if "selections" in case:
        by_index = {control.index: control for control in controls}
        mappings = [
            mapping
            for selection in case["selections"]
            if (
                mapping := _rebuild_mapping(
                    by_index[int(selection["index"])],
                    str(selection["field"]),
                    str(selection["value"]),
                )
            )
            is not None
        ]
    else:
        mappings = engine.match_fields(controls, case["profile"]).mappings
    client = ScriptedCdpClient(case["script"])
    # recheck_delay=0：复读逻辑照常执行（脚本里就是两次回读），但不吃墙钟。
    outcomes = engine.apply(client, mappings, recheck_delay=0.0)
    client.assert_finished()
    return outcomes, client
