"""BOSS 筛选栏的选项目录：把站点自己的筛选项读成界面可用的下拉表，再映射成查询参数。

**为什么由站点提供选项，而不是我们写死一份**：这份清单一改，写死的那份就会**静默筛错**——
用户以为按「本科」筛了，实际站点认的是另一个编码。所以选项一律读站点自己的数据，
读不到就如实说"不可用"，绝不猜。

三条来源，按可信度排序（``Source`` 常量）：

1. ``SESSION``——在用户**已登录**的浏览器页面上发一次带凭据的请求，拿到**这个账号可见**的
   清单。**这一条是必需的**：2026-09-20 实测，「求职类型」的选项因人而异（登录账号能看到
   「实习」，未登录看不到），写死一份就等于替所有用户决定了他们能选什么。
2. ``PUBLIC``——同一批接口的**免登录**版本。全网一致的公共清单，浏览器没启动时用它。
3. ``SNAPSHOT``——内置快照，联网失败时的兜底。**只覆盖 6 个短清单**；行业有 134 条，
   放进代码里是纯粹的体积负担，拿不到就如实标 ``UNAVAILABLE``。

**参数名从哪来**：全部由**真实点击**得到——打开站点自己的筛选栏、点一个选项、读地址栏。
不是从 HTML 属性推的：埋点属性写的是 ``sel-job-rec-exp``，而地址栏里的参数名是
``experience``，照 HTML 抄就错了。见 ``FILTER_GROUPS`` 的逐条注释。

本模块是纯函数 + 一次可注入的网络调用（无浏览器、无数据库），因此可以离线逐条测。

本文件承接原 ``boss_filters`` 的数据模型、离线快照与解码/解析纯函数；
网络获取三件套（``default_fetcher`` / ``fetch_catalogue`` / ``_fetch_public``）与
``FILTER_BAR_SCRIPT`` 留在 ``boss_filters.py``（conftest 对 ``boss_filters.default_fetcher``
的全局 patch 契约）。
"""
from __future__ import annotations

import json
import logging
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from .base import (
    SOURCE_PUBLIC,
    SOURCE_SNAPSHOT,
    SOURCE_UNAVAILABLE,
)
from .base import (
    SOURCE_SESSION as SOURCE_SESSION,
)

logger = logging.getLogger(__name__)

CONDITIONS_ENDPOINT = "https://www.zhipin.com/wapi/zpgeek/pc/all/filter/conditions.json"
INDUSTRY_ENDPOINT = "https://www.zhipin.com/wapi/zpCommon/data/industry.json"
DEFAULT_TIMEOUT_SECONDS = 6.0
MAX_RESPONSE_BYTES = 2 * 1024 * 1024


# 「不限」的编码。**它不是一个筛选**：选中它等于不加这个查询参数。
UNLIMITED_CODE = "0"


@dataclass(frozen=True)
class FilterOption:
    """一个可选项。``group`` 只用于界面分组（行业有 15 个一级分组），其余为空。"""

    code: str
    label: str
    group: str = ""


@dataclass(frozen=True)
class FilterGroup:
    """界面上的一个下拉框：站点筛选栏里的一格。"""

    key: str
    param: str
    label: str
    options: tuple[FilterOption, ...] = ()
    source: str = SOURCE_UNAVAILABLE
    note: str = ""
    # 该分组在站点筛选栏里的标题可能不止一种写法（站点改过文案时按任意一种都能认出来）。
    aliases: tuple[str, ...] = ()

    def option(self, code: str) -> FilterOption | None:
        for item in self.options:
            if item.code == code:
                return item
        return None

    def titles(self) -> tuple[str, ...]:
        return (self.label, *self.aliases)


# 分组定义：``key`` 是内部标识，``param`` 是**实测得到的查询参数名**，``titles`` 是筛选栏标题。
#
# 每条 param 的实测记录（2026-09-20，登录会话，点一下读一次地址栏）：
#   求职类型 → jobType=1901（返回 15/15 条 jobType=0）
#   薪资待遇 → salary=402
#   工作经验 → experience=108
#   学历要求 → degree=209
#   公司规模 → scale=301
#   融资阶段 → stage=801
#   公司行业 → industry=100028（点「人工智能」，另点「电子/半导体/集成电路」得 101407）
@dataclass(frozen=True)
class GroupSpec:
    key: str
    param: str
    label: str
    titles: tuple[str, ...]
    # 页面筛选栏里的编码能不能当真实编码用。
    #
    # **只有行业是 False，而且必须是 False**：短清单的 ``ka`` 后缀就是真实编码
    # （实测 ``sel-job-rec-degree-203`` → ``degree=203``），行业的 ``ka`` 后缀却是**渲染序号**
    # （``sel-industry-23`` 对应的真实编码是 ``101407``，点一下读地址栏才知道）。照抄序号会
    # 发一个"合法但不相干"的编码出去，站点照样返回结果——那是最坏的一种错：用户以为筛了。
    dom_codes: bool = True


GROUP_SPECS: tuple[GroupSpec, ...] = (
    GroupSpec("jobType", "jobType", "求职类型", ("求职类型",)),
    GroupSpec("salary", "salary", "薪资待遇", ("薪资待遇", "薪资")),
    GroupSpec("experience", "experience", "工作经验", ("工作经验", "经验要求")),
    GroupSpec("degree", "degree", "学历要求", ("学历要求", "学历")),
    GroupSpec("industry", "industry", "公司行业", ("公司行业", "行业"), dom_codes=False),
    GroupSpec("scale", "scale", "公司规模", ("公司规模", "公司规模")),
    GroupSpec("stage", "stage", "融资阶段", ("融资阶段", "融资")),
)

# 页面筛选栏里读得到、但**编码不可信**的分组（见 ``GroupSpec.dom_codes``）。这些分组只从
# 接口取选项，页面的那份只用来发现"站点改版了"（标题都变了说明筛选栏动过）。
_DOM_CODE_KEYS = frozenset(spec.key for spec in GROUP_SPECS if spec.dom_codes)

# conditions.json 里 6 个短清单的键 → 分组 key。
_CONDITION_KEYS: tuple[tuple[str, str], ...] = (
    ("jobTypeList", "jobType"),
    ("salaryList", "salary"),
    ("experienceList", "experience"),
    ("degreeList", "degree"),
    ("scaleList", "scale"),
    ("stageList", "stage"),
)

# 离线兜底快照：值取自 2026-09-20 对上面两个接口的**真实响应**（免登录那版）。
# 只放 6 个短清单——行业 134 条放进来是纯粹的体积负担，拿不到就如实标不可用。
_SNAPSHOT: dict[str, tuple[tuple[str, str], ...]] = {
    "jobTypeList": (("0", "不限"), ("1901", "全职"), ("1903", "兼职")),
    "salaryList": (
        ("0", "不限"),
        ("402", "3K以下"),
        ("403", "3-5K"),
        ("404", "5-10K"),
        ("405", "10-20K"),
        ("406", "20-50K"),
        ("407", "50K以上"),
    ),
    "experienceList": (
        ("0", "不限"),
        ("108", "在校生"),
        ("102", "应届生"),
        ("101", "经验不限"),
        ("103", "1年以内"),
        ("104", "1-3年"),
        ("105", "3-5年"),
        ("106", "5-10年"),
        ("107", "10年以上"),
    ),
    "degreeList": (
        ("0", "不限"),
        ("209", "初中及以下"),
        ("208", "中专/中技"),
        ("206", "高中"),
        ("202", "大专"),
        ("203", "本科"),
        ("204", "硕士"),
        ("205", "博士"),
    ),
    "scaleList": (
        ("0", "不限"),
        ("301", "0-20人"),
        ("302", "20-99人"),
        ("303", "100-499人"),
        ("304", "500-999人"),
        ("305", "1000-9999人"),
        ("306", "10000人以上"),
    ),
    "stageList": (
        ("0", "不限"),
        ("801", "未融资"),
        ("802", "天使轮"),
        ("803", "A轮"),
        ("804", "B轮"),
        ("805", "C轮"),
        ("806", "D轮及以上"),
        ("807", "已上市"),
        ("808", "不需要融资"),
    ),
}


def _text(value: Any) -> str:
    return str(value or "").strip()


def _code(value: Any) -> str:
    """把编码折成字符串。

    **不能拿 ``_text`` 代劳**：``str(0 or "")`` 是空串，会把「不限」（编码 ``0``）整个吃掉，
    而它在每个清单里都是第一项——用户会看到下拉框少了一个选项，却不知道少的是哪一个。
    接口给的是数字、内置快照给的是字符串，两条路都要收敛成 ``"0"``。
    """
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    return str(value).strip()


def _decode(value: Any) -> dict[str, Any]:
    """把一次接口响应折成字典。**解码失败返回空字典**——调用方据此退回下一层来源。"""
    if isinstance(value, bytes):
        try:
            value = value.decode("utf-8")
        except UnicodeDecodeError:
            return {}
    if isinstance(value, str):
        if len(value.encode("utf-8")) > MAX_RESPONSE_BYTES:
            return {}
        try:
            value = json.loads(value)
        except json.JSONDecodeError:
            return {}
    return value if isinstance(value, dict) else {}


def _zp_data(payload: Any) -> Any:
    """取出响应里的业务数据。

    **两种形状都要认**：``conditions.json`` 的 ``zpData`` 是对象，而 ``industry.json`` 的是
    数组（``{"code":0,"zpData":[...]}``）——只认对象会让行业清单**静默变成空的**，
    表现成"这一项读不到"，而真正的原因在解码这层。
    """
    data = _decode(payload)
    if _text(data.get("code")) not in ("", "0"):
        # 明确报错的响应不当成"没数据"：它意味着站点改了鉴权/参数，值得留一条可检索的记录。
        logger.info("BOSS 筛选条件接口返回错误 code=%s", data.get("code"))
        return None
    inner = data.get("zpData")
    if isinstance(inner, (dict, list)):
        return inner
    fallback = data.get("data")
    return fallback if isinstance(fallback, (dict, list)) else None


def _option_list(values: Any) -> tuple[FilterOption, ...]:
    result: list[FilterOption] = []
    # **list 与 tuple 都要认**：接口来的是 JSON 数组，内置快照是元组常量。只认 list 会让
    # 离线兜底**静默变成空清单**（表现成"这一项读不到"，而原因在类型判断这层）。
    if not isinstance(values, (list, tuple)):
        return ()
    for item in values:
        if isinstance(item, dict):
            code, label = _code(item.get("code")), _text(item.get("name"))
        elif isinstance(item, (list, tuple)) and len(item) >= 2:
            code, label = _code(item[0]), _text(item[1])
        else:
            continue
        if code and label:
            result.append(FilterOption(code=code, label=label))
    return tuple(result)


def parse_conditions(payload: Any) -> dict[str, tuple[FilterOption, ...]]:
    """``conditions.json`` → ``{分组 key: 选项}``。认不出的分组直接从结果里缺席。"""
    data = _zp_data(payload)
    if not isinstance(data, dict):
        return {}
    parsed: dict[str, tuple[FilterOption, ...]] = {}
    for condition_key, group_key in _CONDITION_KEYS:
        options = _option_list(data.get(condition_key))
        if options:
            parsed[group_key] = options
    return parsed


def parse_industries(payload: Any) -> tuple[FilterOption, ...]:
    """``industry.json`` → 行业选项（带一级分组名，便于界面按组展示）。

    只取**二级**（``subLevelModelList``）。站点页面上还多出十来个三级项
    （例如「电子/半导体/集成电路」，实测编码 101407），它们不在这份接口数据里——
    那部分只能从页面筛选栏本身读到，见 ``parse_filter_bar``。
    """
    data = _zp_data(payload)
    if isinstance(data, list):
        nodes = data
    elif isinstance(data, dict):
        nodes = data.get("industryList") or data.get("list") or []
    else:
        return ()
    if not isinstance(nodes, list):
        return ()
    result: list[FilterOption] = []
    for node in nodes:
        if not isinstance(node, dict):
            continue
        group = _text(node.get("name"))
        children = node.get("subLevelModelList")
        if not isinstance(children, list):
            continue
        for child in _option_list(children):
            result.append(FilterOption(code=child.code, label=child.label, group=group))
    return tuple(result)


def parse_filter_bar(payload: Any) -> dict[str, tuple[FilterOption, ...]]:
    """把 ``FILTER_BAR_SCRIPT`` 的产出折成 ``{分组 key: 选项}``（按标题认分组）。

    这是**唯一完整**的来源：站点页面上渲染的选项，含接口不给的三级行业。
    """
    if isinstance(payload, str):
        payload = _decode(payload)
    if not isinstance(payload, dict):
        return {}
    groups = payload.get("groups")
    if not isinstance(groups, list):
        return {}
    by_title = {title: spec.key for spec in GROUP_SPECS for title in spec.titles}
    parsed: dict[str, tuple[FilterOption, ...]] = {}
    for group in groups:
        if not isinstance(group, dict):
            continue
        key = by_title.get(_text(group.get("title")))
        if key is None or key in parsed or key not in _DOM_CODE_KEYS:
            continue
        options = tuple(
            FilterOption(code=_code(item.get("code")), label=_text(item.get("label")),
                         group=_text(item.get("group")))
            for item in (group.get("options") or [])
            if isinstance(item, dict)
        )
        usable = tuple(item for item in options if item.code and item.label)
        if usable:
            parsed[key] = usable
    return parsed


def build_catalogue(
    *,
    conditions: Mapping[str, Sequence[FilterOption]] | None = None,
    industries: Sequence[FilterOption] | None = None,
    bar: Mapping[str, Sequence[FilterOption]] | None = None,
    source: str = SOURCE_PUBLIC,
) -> tuple[FilterGroup, ...]:
    """把各来源的选项合并成界面要展示的分组表。

    **合并规则是"页面优先"**：页面筛选栏是用户真实看到的那份（含账号可见的完整求职类型，
    例如学生账号多一个「实习」），接口那份作为它的补集——页面读不到某个分组时才用接口的。
    注意行业**永远来自接口**（``GroupSpec.dom_codes=False``）：页面上的行业只给渲染序号。
    """
    merged: dict[str, tuple[FilterOption, ...]] = {}
    # 顺序即优先级：后写入的覆盖先写入的，所以页面筛选栏放最后。
    sources: list[Mapping[str, Sequence[FilterOption]]] = []
    if conditions:
        sources.append(conditions)
    if industries:
        sources.append({"industry": tuple(industries)})
    if bar:
        sources.append(bar)
    for mapping in sources:
        merged.update({key: tuple(values) for key, values in mapping.items() if values})
    groups: list[FilterGroup] = []
    for spec in GROUP_SPECS:
        options = merged.get(spec.key, ())
        groups.append(
            FilterGroup(
                key=spec.key,
                param=spec.param,
                label=spec.label,
                options=options,
                source=source if options else SOURCE_UNAVAILABLE,
                note="" if options else "这一项暂时读不到，本次不显示选项。",
                aliases=spec.titles[1:],
            )
        )
    return tuple(groups)


def snapshot_catalogue() -> tuple[FilterGroup, ...]:
    """离线兜底：只用内置快照（6 个短清单），行业标成不可用。"""
    conditions = {
        group_key: _option_list(_SNAPSHOT.get(condition_key))
        for condition_key, group_key in _CONDITION_KEYS
    }
    return build_catalogue(conditions=conditions, source=SOURCE_SNAPSHOT)


@dataclass
class ResolvedFilters:
    """一次采集要带上的查询参数，以及**没能执行**的那几条（如实上报，不静默丢）。"""

    params: dict[str, str] = field(default_factory=dict)
    applied: list[str] = field(default_factory=list)
    unapplied: list[str] = field(default_factory=list)

    def as_dict(self) -> dict[str, Any]:
        return {"params": dict(self.params), "applied": list(self.applied),
                "unapplied": list(self.unapplied)}


def resolve_codes(
    selected: Mapping[str, str] | None,
    catalogue: Sequence[FilterGroup],
) -> ResolvedFilters:
    """把用户在界面上选的 ``{分组 key: 编码}`` 折成查询参数。

    三条纪律，每条都对应一种**静默失效**：

    - 选的是「不限」（编码 ``0``）→ 不产生参数，也不计入"已生效"（它本来就等于没筛）；
    - 编码**不在**本次读到的清单里 → 计入 ``unapplied``，**绝不发出去**。站点改版后编码会变，
      发一个过期的编码会被站点当成合法值而返回错误结果，比不筛更糟；
    - 分组本身读不到（``UNAVAILABLE``）→ 同样计入 ``unapplied``。
    """
    result = ResolvedFilters()
    if not selected:
        return result
    by_key = {group.key: group for group in catalogue}
    for key, raw_code in selected.items():
        code = _code(raw_code)
        if not code or code == UNLIMITED_CODE:
            continue
        group = by_key.get(key)
        if group is None:
            # 这一项是**旧配置留下的**（站点已经不再提供这个分组），同样如实上报。
            result.unapplied.append(key)
            continue
        if group.source == SOURCE_UNAVAILABLE:
            result.unapplied.append(group.label)
            continue
        option = group.option(code)
        if option is None:
            result.unapplied.append(group.label)
            continue
        result.params[group.param] = code
        result.applied.append(f"{group.label}：{option.label}")
    return result

