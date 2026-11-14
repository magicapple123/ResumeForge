# SPDX-License-Identifier: Apache-2.0
"""流式响应片段的纯拼装：tool_calls 按 index 累加、reasoning 别名读取。

为什么单独一层：SSE 的每个 delta 只是"片段"——``function.arguments`` 会跨多个 chunk
到达，**必须追加而不是覆盖**；同一轮里可能并行调多个工具，片段交错到达，所以按
``index`` 分槽、最后按 index 排序输出。这里没有任何网络与状态依赖，测试不用起服务。
"""


def _accumulate_tool_calls(pending: dict[int, dict], fragments: object) -> None:
    """按 index 追加工具调用片段（片段是增量，永远不是替换）。

    同一个 index 可能分几次到达：``id``/``type`` 取第一次出现的非空值，``name`` 与
    ``arguments`` 逐段拼接——把它们当整体覆盖会丢掉后半截参数。
    """
    if not isinstance(fragments, list):
        return
    for fragment in fragments:
        if not isinstance(fragment, dict):
            continue
        try:
            index = int(fragment.get("index", 0))
        except (TypeError, ValueError):
            index = 0
        slot = pending.setdefault(
            index, {"id": "", "type": "function", "function": {"name": "", "arguments": ""}}
        )
        if isinstance(fragment.get("id"), str) and fragment["id"]:
            slot["id"] = fragment["id"]
        if isinstance(fragment.get("type"), str) and fragment["type"]:
            slot["type"] = fragment["type"]
        function = fragment.get("function")
        if isinstance(function, dict):
            if isinstance(function.get("name"), str):
                slot["function"]["name"] += function["name"]
            if isinstance(function.get("arguments"), str):
                slot["function"]["arguments"] += function["arguments"]


def _finalize_tool_calls(pending: dict[int, dict]) -> list[dict]:
    return [pending[index] for index in sorted(pending)]


def _extract_reasoning(delta: dict) -> str:
    """读 provider 的思考过程：两种别名都认，没有就返回空串（不编内容）。"""
    for key in ("reasoning_content", "reasoning"):
        value = delta.get(key)
        if isinstance(value, str) and value:
            return value
    return ""
