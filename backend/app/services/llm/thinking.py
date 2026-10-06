"""思考模式的**形态与强度**：能力表、请求体片段，以及一次实测探测。

## 为什么要有"形态"这一层

上游没有统一标准，也没有"查询能力"的接口（``/v1/models`` 只给模型名）。同样是"开启
思考"，各家写进请求体的东西完全不同：OpenAI 系是顶层 ``reasoning_effort``、Claude 原生是
``thinking.budget_tokens``、智谱是 ``thinking:{type:enabled}``、通义 qwen3 是
``enable_thinking``。所以配置里存的是**意图**（开关 + 档位 + 形态），由这里翻译成请求体。

## 能力表只用来"猜形态"，判定权威是实测

``resolve_style`` 在用户没有显式指定形态时按表猜（不然"开关一开就生效"对智谱、通义
这类只有自己写法的服务商根本不成立）。猜错的代价被两道闸限制住：

- **上游 400** 时，``openai_compat`` 会去掉思考参数重试一次——最坏是"这一次没有思考"，
  不是"简历生成、岗位解析一起失败"；
- **被静默忽略**（很多服务商对不认识的参数不报错）只有实发一次才看得出来，
  那正是 :func:`probe_thinking` 的职责：它区分**真的生效**（响应里有思考内容）、
  **接受了但没效果**、**上游明确拒绝**三种情况。
"""
from __future__ import annotations

import asyncio
import contextlib
import logging
import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit

from ...schemas.setting import THINKING_STYLE_UNMANAGED, LLMConfig
from .base import LLMError

logger = logging.getLogger(__name__)

STYLE_AUTO = "auto"
STYLE_REASONING_EFFORT = "reasoning_effort"
STYLE_THINKING_OBJECT = "thinking_object"
STYLE_ENABLE_THINKING = "enable_thinking"
STYLE_BUDGET = "budget"

# 强度档位 → 思考预算（tokens）。**只有这一份实现**：设置页的新开关与助手页的
# 「思考强度」在原生 Messages 协议下都从这里取预算。
EFFORT_BUDGETS: dict[str, int] = {
    "minimal": 1_024,
    "low": 2_048,
    "medium": 8_192,
    "high": 16_384,
}

# "开启了但没指定档位"时用的档位。`reasoning_effort` 形态下"开启"只能靠发一个档位表达，
# 而 medium 是 OpenAI 自己文档里的默认值；Anthropic 预算同理（8k 预算）。
DEFAULT_EFFORT = "medium"

# 各形态的档位候选；空元组 = 该形态只有开关，没有档位可选。
_EFFORTS_BY_STYLE: dict[str, tuple[str, ...]] = {
    STYLE_REASONING_EFFORT: ("minimal", "low", "medium", "high"),
    STYLE_BUDGET: ("low", "medium", "high"),
    STYLE_THINKING_OBJECT: (),
    STYLE_ENABLE_THINKING: (),
}

_UNLISTED_NOTE = (
    "内置表没有收录这个服务商，下面是按通用写法给的选项；"
    "点「检测思考支持」确认它是否真的生效。"
)

# 探测用的提示词：只要一个字，把花费压到最低。
_PROBE_PROMPT = "只回复一个字：好"
_PROBE_MAX_FRAMES = 60
_PROBE_SECONDS = 20.0
# 上游把 400/422 当作"参数不被接受"的两种常见表达。
_REJECT_STATUS = (400, 422)
_HTTP_STATUS_PATTERN = re.compile(r"（HTTP (\d{3})）")


@dataclass(frozen=True)
class ThinkingSupport:
    """对某个端点/模型"大概支持什么"的判断，只用于设置页给选项与解释。"""

    style: str
    efforts: tuple[str, ...]
    supported: bool
    note: str


@dataclass(frozen=True)
class ThinkingProbe:
    """实测结果。``accepted`` 指上游没有拒绝该参数，``reasoning_seen`` 才是"真的生效"。"""

    accepted: bool
    reasoning_seen: bool
    message: str


@dataclass(frozen=True)
class _VendorRule:
    """一条能力表规则：主机后缀匹配 + 模型名正则（空 = 不限）。"""

    host: str
    model_pattern: re.Pattern[str] | None
    style: str
    efforts: tuple[str, ...]
    supported: bool
    note: str
    # 该模型**不指定就思考**（DeepSeek V4、通义 Qwen3.5+ 这类）。这时"关"不能靠省略
    # 表达——省略等于沿用服务商默认，界面写着"关闭"、实际还在思考。所以关着的时候要
    # 显式发一次关闭参数，见 :func:`_disable_payload`。
    default_on: bool = False


# 能力表：**先匹配先赢**，顺序即优先级。每条都只影响设置页的选项与提示。
#
# **最后一次核对：2026-10-01**（依据各家官方文档与下线公告）。这张表最容易过期——
# 改模型名、换档位词汇、把"默认不思考"改成"默认思考"都会发生。核对时的重点：
# OpenAI 的档位按代次分（5.2 起多了 none/xhigh）、国内几家普遍改成了默认思考。
_TABLE: tuple[_VendorRule, ...] = (
    _VendorRule(
        "open.bigmodel.cn",
        re.compile(r"^glm-(4\.[5-9]|5)"),
        STYLE_THINKING_OBJECT,
        (),
        True,
        "GLM-4.5 及以上用 thinking 开关控制思考；GLM-5.2 起还能分档（low/high/max，"
        "写法以官方文档为准）。",
    ),
    _VendorRule(
        "dashscope.aliyuncs.com",
        # 匹配 `^qwen` 而不是 `^qwen3`：预设里用的是官方长期保留的档位别名 `qwen-plus`，
        # 钉版本号会让它掉进"未收录"。该主机上也会托管别家的模型，所以不能按主机一刀切。
        re.compile(r"^qwen"),
        STYLE_ENABLE_THINKING,
        (),
        True,
        "通义 Qwen3.5 及以上的混合模型**默认就思考**：不想思考要显式关掉（本应用会在"
        "「思考模式」关闭时替你发关闭参数）。qwen3.8 起也支持 reasoning_effort 分档。",
        default_on=True,
    ),
    _VendorRule(
        "api.deepseek.com",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "DeepSeek V4（deepseek-v4-flash / -pro）用 thinking 开关控制思考，且**默认开着**；"
        "旧的 deepseek-chat / deepseek-reasoner 已于 2026-07-24 停用。",
        default_on=True,
    ),
    _VendorRule(
        "api.minimax",
        None,
        STYLE_THINKING_OBJECT,
        (),
        True,
        "MiniMax-M3 默认不思考，开启用的写法是 thinking:{type:'adaptive'}（与本应用的"
        "通用形态不同）；若检测提示被拒，可用高级调整里的 extra_body 手写。",
    ),
    _VendorRule(
        "api.moonshot",
        re.compile(r"^kimi-k3"),
        STYLE_THINKING_OBJECT,
        (),
        False,
        "kimi-k3 的思考是常开的，没有关闭参数——这里的「思考模式」对它不起作用。",
    ),
    _VendorRule(
        "api.openai.com",
        re.compile(r"^gpt-5\.[2-9]|^gpt-5\.\d\d"),
        STYLE_REASONING_EFFORT,
        ("none", "low", "medium", "high", "xhigh"),
        True,
        "GPT-5.2 及以后用 reasoning_effort 分档（含 none 与 xhigh）；档位不被支持时，"
        "上游会直接报错并列出可用的值。",
    ),
    _VendorRule(
        "api.openai.com",
        re.compile(r"^gpt-5(\.[01])?(-(mini|nano))?$"),
        STYLE_REASONING_EFFORT,
        ("minimal", "low", "medium", "high"),
        True,
        "GPT-5 / 5.1 代用 reasoning_effort：minimal/low/medium/high。",
    ),
    _VendorRule(
        "api.openai.com",
        re.compile(r"^o[1-9]"),
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "o 系列推理模型用 reasoning_effort：low/medium/high（该系列正被 GPT-5 取代）。",
    ),
    _VendorRule(
        "api.openai.com",
        re.compile(r"^(gpt-4|gpt-3|chatgpt)"),
        STYLE_REASONING_EFFORT,
        (),
        False,
        "gpt-4 这代不是推理模型（且已陆续下线），开了也不会有思考内容。",
    ),
    _VendorRule(
        "openrouter.ai",
        None,
        STYLE_REASONING_EFFORT,
        ("low", "medium", "high"),
        True,
        "OpenRouter 会把 reasoning_effort 归一化后转给具体模型（各模型支持的档位不同，"
        "以它列出的为准）。",
    ),
)


def _host_of(base_url: str) -> str:
    try:
        return (urlsplit(str(base_url or "")).hostname or "").casefold()
    except ValueError:
        return ""


def _explicit_style(config: LLMConfig) -> str:
    style = str(getattr(config, "thinking_style", "") or "").strip()
    return "" if style in ("", STYLE_AUTO) else style


def resolve_style(config: LLMConfig) -> str:
    """决定这次请求用哪种形态。

    优先级：**不参与思考配置**（助手/测试连接）> **用户显式指定** > 能力表按服务商/模型
    给出的判断 > 按协议兜底（OpenAI 兼容 → ``reasoning_effort``，原生 Messages → 预算）。

    表参与请求构造是有意的：不然"开关一开就生效"对智谱、通义这类只有自己写法的服务商
    根本不成立。风险由两道闸兜着——上游 400 时去掉思考参数重试一次
    （``openai_compat.stream_chat_events``），以及设置页的实测检测会把"被静默忽略"
    如实报出来，而不是让用户对着一个没有效果的开关猜。
    """
    if str(getattr(config, "thinking_style", "") or "").strip() == THINKING_STYLE_UNMANAGED:
        return THINKING_STYLE_UNMANAGED
    explicit = _explicit_style(config)
    if explicit:
        return explicit
    if (config.api_style or "openai") == "anthropic":
        # 原生 Messages 协议只认预算写法：``reasoning_effort``/``enable_thinking`` 都是
        # Chat Completions 的顶层字段，发到 /messages 上只会 400。
        return STYLE_BUDGET
    rule = _match_rule(config)
    return rule.style if rule is not None else STYLE_REASONING_EFFORT


def _match_rule(config: LLMConfig) -> _VendorRule | None:
    host = _host_of(config.base_url)
    model = str(config.model or "").strip().casefold()
    for rule in _TABLE:
        if rule.host and rule.host not in host:
            continue
        if rule.model_pattern is not None and not rule.model_pattern.search(model):
            continue
        return rule
    return None


def thinking_support(config: LLMConfig) -> ThinkingSupport:
    """这个端点/模型大概支持什么——**只影响设置页的选项与提示**。

    用户显式指定了形态就以他的为准（他可能比表更清楚，比如走的是中转站）：那时
    "支不支持"由他自己负责，表只贡献一句说明，档位按该形态的通用集合给。
    """
    style = resolve_style(config)
    rule = _match_rule(config)
    if _explicit_style(config):
        return ThinkingSupport(style, _EFFORTS_BY_STYLE.get(style, ()), True,
                               rule.note if rule else _UNLISTED_NOTE)
    if rule is not None:
        return ThinkingSupport(rule.style, rule.efforts, rule.supported, rule.note)
    return ThinkingSupport(style, _EFFORTS_BY_STYLE.get(style, ()), True, _UNLISTED_NOTE)


def normalize_effort(config: LLMConfig) -> str:
    """归一化档位：去空白、小写；空串表示"不指定档位"。

    **不再丢弃"不在候选表里的值"**：界面允许自定义（各家档位词汇不同，`xhigh`/`max`/
    `adaptive` 这类服务商自创的词就靠它）。候选集合现在只用来给选项与提示，不再当白名单；
    换了模型后残留的档位若真发不出去，由上游 400 → 去掉思考参数重试一次兜底。
    """
    return str(getattr(config, "thinking_effort", "") or "").strip().lower()


def effort_budget(config: LLMConfig) -> int:
    """把档位换算成预算（tokens）：自定义数字直接当预算，认得的词查表，其余用默认档。

    与 ``anthropic._thinking_budget`` 同一个口径：**绝不返回 0**——"不指定档位"只意味着
    用默认深度，而不是把思考关掉（关掉由开关负责）。
    """
    effort = normalize_effort(config)
    if effort.isdigit():
        return int(effort)
    return EFFORT_BUDGETS.get(effort or DEFAULT_EFFORT, EFFORT_BUDGETS[DEFAULT_EFFORT])


def thinking_budget(config: LLMConfig) -> int:
    """本次请求的思考预算（tokens）；0 = 不发。原生 Messages 协议用这个。"""
    if not getattr(config, "thinking_enabled", False):
        return 0
    return effort_budget(config)


def _disable_payload(style: str) -> dict:
    """**显式关闭**思考的写法；该形态没有"关"这种写法时返回空（表里会写明关不掉）。"""
    if style == STYLE_THINKING_OBJECT:
        return {"thinking": {"type": "disabled"}}
    if style == STYLE_ENABLE_THINKING:
        return {"enable_thinking": False}
    return {}


def thinking_payload(config: LLMConfig) -> dict:
    """OpenAI 兼容请求体里的思考参数片段。

    - **关着**：默认返回空 dict——一个字都不发，请求体与加这个功能之前逐字节一致。
      例外是表里标了 ``default_on`` 的模型（DeepSeek V4、通义 Qwen3.5+）：它们不指定就
      思考，"省略"等于"开着"，所以必须显式发一次关闭参数，否则界面写着"关闭"、实际在思考。
    - **开着**：按形态生成。
    """
    style = resolve_style(config)
    if style == THINKING_STYLE_UNMANAGED:
        # 助手/测试连接：这次调用不参与思考配置，一个字都不发。
        return {}
    if not getattr(config, "thinking_enabled", False):
        rule = _match_rule(config)
        if rule is not None and rule.default_on:
            return _disable_payload(style)
        return {}
    if style == STYLE_REASONING_EFFORT:
        return {"reasoning_effort": normalize_effort(config) or DEFAULT_EFFORT}
    if style == STYLE_THINKING_OBJECT:
        return {"thinking": {"type": "enabled"}}
    if style == STYLE_ENABLE_THINKING:
        return {"enable_thinking": True}
    if style == STYLE_BUDGET:
        # 与「思考预算」字段同一种写法（Claude 系网关的方言）；自定义数字档位在这里
        # 就当作预算本身。
        return {"thinking": {"type": "enabled", "budget_tokens": effort_budget(config)}}
    return {}


def wants_thinking(config: LLMConfig) -> bool:
    """这次请求会不会真的带上思考参数（供"被上游拒绝时降级重试"判断）。"""
    return bool(thinking_payload(config)) or thinking_budget(config) > 0


def _http_status_of(error: LLMError) -> int | None:
    """从已翻译的错误文案里认出状态码。

    provider 刻意不把上游正文带进错误消息（可能回显敏感资料），所以这里只能认状态码——
    与 ``openai_compat._looks_like_rejected_parameter`` 是同一个取舍。
    """
    match = _HTTP_STATUS_PATTERN.search(str(error))
    return int(match.group(1)) if match else None


async def probe_thinking(config: LLMConfig, *, seconds: float = _PROBE_SECONDS) -> ThinkingProbe:
    """实发一次最小请求，看这个端点接不接受思考参数、有没有真的思考。

    用**最便宜的档位**、只取一个字，并且看到思考内容就立刻收手（不把整段生成完）。
    逐帧限时用 ``asyncio.wait_for`` 而不是 ``asyncio.timeout``：两者行为等价，
    前者在更老的写法资料里更常见，没有别的原因。
    """
    from . import create_provider  # 延迟导入：provider 反向引用本模块，模块级会成环

    style = resolve_style(config)
    cheapest = _EFFORTS_BY_STYLE.get(style, ())
    candidate = config.model_copy(
        update={
            "thinking_enabled": True,
            "thinking_effort": normalize_effort(config) or (cheapest[0] if cheapest else ""),
        }
    )
    deadline = time.monotonic() + max(5.0, seconds)
    saw_text = False
    # provider 的构造与流对象本身也可能在第一帧之前就抛（地址非法、模型名为空……），
    # 所以整段都在 try 里——探测失败要如实回报，不能变成 500。
    stream = None
    try:
        provider = create_provider(candidate)
        stream = provider.stream_chat_events([{"role": "user", "content": _PROBE_PROMPT}])
        for _ in range(_PROBE_MAX_FRAMES):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            try:
                delta = await asyncio.wait_for(stream.__anext__(), timeout=remaining)
            except StopAsyncIteration:
                break
            if delta.reasoning:
                return ThinkingProbe(
                    True, True, "已确认生效：这次调用真的产出了思考内容。"
                )
            if delta.text:
                saw_text = True
    except LLMError as exc:
        status = _http_status_of(exc)
        if status in _REJECT_STATUS:
            return ThinkingProbe(
                False,
                False,
                f"上游拒绝了带思考参数的请求（HTTP {status}）。可以在高级调整里换一种"
                f"「思考参数形态」再检测一次。{exc}",
            )
        return ThinkingProbe(False, False, f"这次检测没能完成：{exc}")
    finally:
        if stream is not None:
            with contextlib.suppress(Exception):
                await stream.aclose()
    if saw_text:
        return ThinkingProbe(
            True,
            False,
            "上游接受了思考参数，但这次没有产出思考内容：可能被静默忽略了，"
            "也可能该模型不展示思考过程。可以换一种形态再检测。",
        )
    return ThinkingProbe(True, False, "上游接受了这次请求，但没有产出内容，也没有思考内容。")


__all__ = [
    "DEFAULT_EFFORT",
    "EFFORT_BUDGETS",
    "STYLE_AUTO",
    "STYLE_BUDGET",
    "STYLE_ENABLE_THINKING",
    "STYLE_REASONING_EFFORT",
    "STYLE_THINKING_OBJECT",
    "ThinkingProbe",
    "ThinkingSupport",
    "effort_budget",
    "normalize_effort",
    "probe_thinking",
    "resolve_style",
    "thinking_budget",
    "thinking_payload",
    "thinking_support",
    "wants_thinking",
]
