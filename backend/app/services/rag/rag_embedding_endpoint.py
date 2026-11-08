# SPDX-License-Identifier: Apache-2.0
"""自定义端点模板的受限渲染与响应解析（RAG v3 任务书 §4.7 路径 A）。

安全边界（每条都有测试钉住，红线见任务书 §8）：

- 占位符只认 {texts} / {model}，**纯字符串替换**；没有 eval / exec / 表达式 / 用户脚本；
- body_template 上限 8KB（按 UTF-8 字节）；响应体上限 16MB（由 provider 按原始字节判定，
  常量在这里，避免第二个实现）；
- response_path 只实现「a.b[*].c」极简子集（段名 + 至多一个 [*]），不引入 jsonpath；
- 渲染后的 header 可能含 API Key：本模块不写日志，错误信息也不回显模板正文/header 值；
- 已知不提供 /embeddings 的厂商只用于 404 文案（NON_EMBEDDING_HOSTS 是展示映射，不是
  拦截白名单——厂商哪天补上端点，这里不会挡住调用）。

占位符语义（因为只做字面替换，必须写死才有确定行为）：

- {texts} 替换成 JSON 数组字面量，例如 ["第一条","第二条"]；
- {model} 替换成 JSON 字符串字面量（**自带引号**）。模板里既可写 \"model\": {model}，
  也可写 \"model\": \"{model}\"（引号包裹形态会被识别并整体替换），两种都得到合法 JSON。
"""

from __future__ import annotations

import json
import math
import re
from collections.abc import Iterable, Mapping
from typing import Any

#: 模板长度上限（UTF-8 字节）。用户脚本式的长文本在这里就被拒绝，不进任何执行路径。
MAX_TEMPLATE_BYTES = 8192
#: 响应体上限（原始字节）：防止用户填的端点用超大响应把进程内存打满。
MAX_RESPONSE_BYTES = 16 * 1024 * 1024
#: response_path 长度上限（极简子集不需要更长）。
MAX_RESPONSE_PATH_CHARS = 256

TEXTS_PLACEHOLDER = "{texts}"
MODEL_PLACEHOLDER = "{model}"
API_KEY_PLACEHOLDER = "{api_key}"

#: host 后缀 → 展示名。只影响 404 可读文案，不是可配置白名单、也不参与放行判定。
NON_EMBEDDING_HOSTS: tuple[tuple[str, str], ...] = (
    ("deepseek.com", "DeepSeek"),
    ("groq.com", "Groq"),
    ("openrouter.ai", "OpenRouter"),
    ("together.xyz", "Together"),
    ("fireworks.ai", "Fireworks"),
    ("x.ai", "xAI"),
)

_UNKNOWN_PLACEHOLDER_RE = re.compile(r"\{[A-Za-z_][A-Za-z0-9_]*\}")
_PATH_SEGMENT_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*)(\[\*\])?$")
_GENERIC_404_HINT = "接口地址不存在或模型/服务不可用：请检查 Base URL、模型名与端点模式"


class TemplateError(ValueError):
    """模板/响应形状错误；message 可直接展示，不含模板正文与任何密钥。"""


def _byte_length(text: str) -> int:
    return len(text.encode("utf-8"))


def _check_placeholders(body: str) -> None:
    """只允许两种占位符：把已知占位符摘掉后仍出现 {name} 就拒绝。"""
    residual = body.replace('"' + MODEL_PLACEHOLDER + '"', "")
    residual = residual.replace(MODEL_PLACEHOLDER, "").replace(TEXTS_PLACEHOLDER, "")
    match = _UNKNOWN_PLACEHOLDER_RE.search(residual)
    if match is not None:
        raise TemplateError(
            "body_template 只允许 {texts} 与 {model} 两个占位符（发现 " + match.group(0) + "）"
        )


def render_body(template: str, *, texts: Iterable[str], model: str) -> str:
    """把 {texts}/{model} 字面替换成 JSON 值，并校验结果仍是 JSON 对象。

    纯字符串替换：不执行任何表达式，模板里的其余字符原样保留。渲染失败抛
    TemplateError（message 不含资料正文）。
    """
    body = str(template or "")
    if not body.strip():
        raise TemplateError("body_template 不能为空")
    if _byte_length(body) > MAX_TEMPLATE_BYTES:
        raise TemplateError(f"body_template 超过 {MAX_TEMPLATE_BYTES} 字节上限")
    if TEXTS_PLACEHOLDER not in body:
        raise TemplateError("body_template 必须包含 {texts} 占位符")
    _check_placeholders(body)
    texts_json = json.dumps(list(texts), ensure_ascii=False)
    model_json = json.dumps(str(model), ensure_ascii=False)
    rendered = body.replace('"' + MODEL_PLACEHOLDER + '"', model_json)
    rendered = rendered.replace(MODEL_PLACEHOLDER, model_json)
    rendered = rendered.replace(TEXTS_PLACEHOLDER, texts_json)
    try:
        parsed = json.loads(rendered)
    except json.JSONDecodeError as exc:
        raise TemplateError(
            f"body_template 渲染后不是合法 JSON（第 {exc.pos} 个字符附近）"
        ) from exc
    if not isinstance(parsed, dict):
        raise TemplateError("body_template 渲染结果必须是 JSON 对象")
    return rendered


def render_headers(headers: Iterable[Mapping[str, str]] | None, api_key: str) -> dict[str, str]:
    """渲染 header 列表：值里的 {api_key} 换成明文密钥；结果**绝不进日志/异常**。"""
    rendered: dict[str, str] = {}
    for item in headers or ():
        if not isinstance(item, Mapping):
            raise TemplateError("headers 必须是 name/value 对象列表")
        name = str(item.get("name") or "").strip()
        value = str(item.get("value") or "")
        if not name:
            raise TemplateError("headers 里的 name 不能为空")
        if (
            not name.isascii()
            or any(ch in name for ch in "\r\n")
            or any(ch in value for ch in "\r\n")
        ):
            raise TemplateError("headers 的 name/value 不允许包含换行或非 ASCII 名称")
        if API_KEY_PLACEHOLDER in value and not str(api_key or "").strip():
            # key 未填时整条认证头不发：发 "Bearer " 这种值会被 h11 判非法 header，
            # 最终被误报成"无法连接"。用户没配 key 就应让服务端按未认证处理。
            continue
        rendered_value = value.replace(API_KEY_PLACEHOLDER, str(api_key or "")).strip()
        if not rendered_value:
            continue
        rendered[name] = rendered_value
    return rendered


def _parse_path(path: str) -> list[tuple[str, bool]]:
    """a.b[*].c → [(a,False),(b,True),(c,False)]；只接受段名与至多一个 [*]。"""
    cleaned = str(path or "").strip()
    if not cleaned:
        raise TemplateError("response_path 不能为空")
    if len(cleaned) > MAX_RESPONSE_PATH_CHARS:
        raise TemplateError(f"response_path 超过 {MAX_RESPONSE_PATH_CHARS} 字符上限")
    segments: list[tuple[str, bool]] = []
    for part in cleaned.split("."):
        match = _PATH_SEGMENT_RE.match(part)
        if match is None:
            raise TemplateError(
                "response_path 只支持「段名 / 段名[*]」形式（例如 data[*].embedding）"
            )
        segments.append((match.group(1), match.group(2) is not None))
    if sum(1 for _key, is_array in segments if is_array) > 1:
        raise TemplateError("response_path 最多支持一个 [*] 数组段")
    return segments


def _walk_dict(node: Any, key: str) -> Any:
    if not isinstance(node, dict) or key not in node:
        raise TemplateError("response_path 指向的响应结构不符（缺少字段）")
    return node[key]


def _select_values(payload: Any, segments: list[tuple[str, bool]]) -> Any:
    current = payload
    for index, (key, is_array) in enumerate(segments):
        current = _walk_dict(current, key)
        if not is_array:
            continue
        if not isinstance(current, list):
            raise TemplateError("response_path 的 [*] 段必须指向数组")
        rest = segments[index + 1 :]
        if not rest:
            return current
        return [_walk_rest(item, rest) for item in current]
    return current


def _walk_rest(node: Any, segments: list[tuple[str, bool]]) -> Any:
    current = node
    for key, _is_array in segments:
        current = _walk_dict(current, key)
    return current


def _to_vector(raw: Any) -> tuple[float, ...]:
    if not isinstance(raw, (list, tuple)) or not raw:
        raise TemplateError("response_path 解析出的向量必须是数字数组")
    values: list[float] = []
    for value in raw:
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise TemplateError("response_path 解析出的向量包含非数字")
        number = float(value)
        if not math.isfinite(number):
            raise TemplateError("response_path 解析出的向量包含非有限值")
        values.append(number)
    return tuple(values)


def parse_response(payload: object, path: str, *, expected: int) -> tuple[tuple[float, ...], ...]:
    """按极简 response_path 取向量列表；条数必须等于请求条数，否则报错。

    同时支持两种形态：指向向量二维数组（如 embeddings → [[...],[...]]）与对象数组再取
    字段（如 data[*].embedding → [{"embedding":[...]}, ...]）。
    """
    values = _select_values(payload, _parse_path(path))
    if not isinstance(values, list):
        raise TemplateError("response_path 指向的响应不是向量数组")
    if len(values) != expected:
        raise TemplateError(
            f"返回向量条数与请求条数不一致：期望 {expected} 条，实际 {len(values)} 条"
        )
    return tuple(_to_vector(raw) for raw in values)


def validate_template(*, body_template: str, response_path: str) -> None:
    """保存前校验模板：非法在写入配置前就给出可读错误，不等到真正调用。"""
    _parse_path(response_path)
    body = str(body_template or "")
    if not body.strip():
        raise TemplateError("body_template 不能为空")
    if _byte_length(body) > MAX_TEMPLATE_BYTES:
        raise TemplateError(f"body_template 超过 {MAX_TEMPLATE_BYTES} 字节上限")
    if TEXTS_PLACEHOLDER not in body:
        raise TemplateError("body_template 必须包含 {texts} 占位符")
    _check_placeholders(body)
    render_body(body, texts=["探测文本"], model="probe-model")


def non_embedding_vendor(host: str) -> str | None:
    """已知不提供 /embeddings 的厂商展示名；普通 host 返回 None（不拦截）。"""
    normalized = str(host or "").strip().rstrip(".").casefold()
    if not normalized:
        return None
    for suffix, vendor in NON_EMBEDDING_HOSTS:
        if normalized == suffix or normalized.endswith("." + suffix):
            return vendor
    return None


def host_supports_embeddings(host: str) -> bool:
    """该 host 是否**已知**不提供 embeddings 接口（False 只表示"已知不支持"）。"""
    return non_embedding_vendor(host) is None


def generic_404_hint() -> str:
    """未知厂商的 404 提示（不含 URL，避免把用户填的地址回显进错误）。"""
    return _GENERIC_404_HINT


__all__ = [
    "API_KEY_PLACEHOLDER",
    "MAX_RESPONSE_BYTES",
    "MAX_RESPONSE_PATH_CHARS",
    "MAX_TEMPLATE_BYTES",
    "MODEL_PLACEHOLDER",
    "NON_EMBEDDING_HOSTS",
    "TEXTS_PLACEHOLDER",
    "TemplateError",
    "generic_404_hint",
    "host_supports_embeddings",
    "non_embedding_vendor",
    "parse_response",
    "render_body",
    "render_headers",
    "validate_template",
]
