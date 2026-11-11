# SPDX-License-Identifier: Apache-2.0
"""投递台屏蔽清单（公司 / 关键词）：匹配规则的**唯一实现**，以及三道闸门共用的助手。

存储是 ``AppSetting['apply_blocklist']``（JSON，零迁移，见 ``settings_service``）。

三道闸门缺一处就会漏：

1. **采集入库**（``services/apply/collector.py``）：命中即丢弃，只在采集账目里记一条
   ``blocked``——不写暂存区，用户就再也不会在待选列表里看见它；
2. **入队**（``_queue.add_to_queue``）：409 并点名命中项，不让它进队列；
3. **投递前**（``task_apply.run_apply``）：兜底跳过——黑名单很可能是"入队之后才加的"，
   只拦前两处的话，历史队列会照旧把它投出去。

匹配规则（用户可预期的部分，写在这里而不是散在三处）：

- **公司**按归一化键比较，与 analytics 的 ``company_key`` 是同一套归并（去空白、全半角、
  大小写），否则「字节跳动 」与「字节跳动」会被当成两家；
- **关键词**按包含匹配（公司名 + 岗位名），但要求长度 ≥ 2 且不在停用词表里。
  没有这一条，用户写「北京」就等于屏蔽整座城市——那是**看起来生效、实际把好岗位也筛掉**
  的静默事故，比不做更糟。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from ...models.apply import ITEM_STATUS_SKIPPED
from ...models.profile import utcnow
from ...models.tracker import normalize_key
from ..settings_service import get_apply_blocklist

# 关键词最短长度：单个汉字/字母几乎必然误伤（"算"、"A"）。
MIN_KEYWORD_CHARS = 2

# 停用词：城市 / 用工性质 / 泛化行业词。这些词写进屏蔽清单只会把整类岗位一起屏蔽，
# 用户本意通常是"不要某家公司的某个方向"，所以这里直接挡掉并让界面提示换个更具体的词。
KEYWORD_STOPWORDS: frozenset[str] = frozenset(
    {
        "北京",
        "上海",
        "深圳",
        "杭州",
        "广州",
        "成都",
        "南京",
        "武汉",
        "西安",
        "苏州",
        "长沙",
        "郑州",
        "重庆",
        "天津",
        "合肥",
        "厦门",
        "青岛",
        "济南",
        "大连",
        "宁波",
        "远程",
        "线下",
        "线上",
        "居家",
        "实习",
        "全职",
        "兼职",
        "外包",
        "劳务",
        "派驻",
        "应届",
        "校招",
        "社招",
        "春招",
        "秋招",
        "岗位",
        "职位",
        "招聘",
        "公司",
        "企业",
        "集团",
        "事业",
        "部门",
        "团队",
        "工程师",
        "开发",
        "研发",
        "技术",
        "产品",
        "运营",
        "测试",
        "算法",
        "数据",
        "设计",
        "面议",
        "双休",
        "五险一金",
        "高薪",
        "急招",
        "大厂",
        "正规",
        "长期",
    }
)


@dataclass(frozen=True)
class Blocklist:
    """已归一化、可直接用于匹配的屏蔽清单。"""

    # ``(归一化键, 用户填的原文)``：键用于比较，原文用于在提示里原样回显。
    companies: tuple[tuple[str, str], ...] = ()
    keywords: tuple[str, ...] = ()

    def company_hit(self, company: str) -> str:
        """命中的公司项（用户原文），未命中返回空串。"""
        key = normalize_key(company)
        if not key:
            # 没有公司名就没有"同一家公司"这个事实，判断不了就不判断。
            return ""
        for normalized, label in self.companies:
            if normalized and normalized == key:
                return label
        return ""

    def keyword_hit(self, company: str, title: str) -> str:
        """命中的关键词（用户原文），未命中返回空串。"""
        if not self.keywords:
            return ""
        haystack = f"{company or ''} {title or ''}".casefold()
        for word in self.keywords:
            if word.casefold() in haystack:
                return word
        return ""

    def hit(self, company: str, title: str) -> str:
        """返回一条可直接展示的命中描述（``公司「X」`` / ``关键词「Y」``），未命中返回空串。

        公司优先于关键词：公司是用户点名要屏蔽的实体，说"因为是这家公司"比说
        "因为公司名里含某个词"更贴近他的本意。
        """
        company_hit = self.company_hit(company)
        if company_hit:
            return f"公司「{company_hit}」"
        keyword_hit = self.keyword_hit(company, title)
        if keyword_hit:
            return f"关键词「{keyword_hit}」"
        return ""

    def __bool__(self) -> bool:
        return bool(self.companies or self.keywords)


def clean_keywords(values: list[str]) -> list[str]:
    """收敛关键词：去空白、保序去重、丢掉过短与停用词。

    返回的是**用户原话**（不是归一化结果）——匹配时再 casefold，这样界面上的清单
    与用户填进去的一字不差。
    """
    cleaned: list[str] = []
    seen: set[str] = set()
    for item in values:
        word = (item or "").strip()
        if len(word) < MIN_KEYWORD_CHARS or word in KEYWORD_STOPWORDS:
            continue
        folded = word.casefold()
        if folded in seen:
            continue
        seen.add(folded)
        cleaned.append(word)
    return cleaned


def build_blocklist(companies: list[str], keywords: list[str]) -> Blocklist:
    """由用户填的原文构造可匹配对象（**不查库**，测试与采集链路都用它）。"""
    company_pairs: list[tuple[str, str]] = []
    seen: set[str] = set()
    for item in companies:
        label = (item or "").strip()
        key = normalize_key(label)
        if not key or key in seen:
            continue
        seen.add(key)
        company_pairs.append((key, label))
    return Blocklist(companies=tuple(company_pairs), keywords=tuple(clean_keywords(keywords)))


def load_blocklist(db: Session) -> Blocklist:
    """从 ``AppSetting`` 读出当前屏蔽清单（一次查询）。"""
    stored = get_apply_blocklist(db)
    return build_blocklist(stored.get("companies", []), stored.get("keywords", []))


# ===== 闸门②③ 的共用助手 =====


# 形参刻意用 ``Any``：这两个助手被三处不同形态的对象调用（``ApplyTask`` + 队列条目、
# 采集账目），写成 ``Protocol`` 反而要把两个模块的对象结构引进本模块（循环依赖），
# 而本模块只需要「有这几个可写属性」。
def skip_if_blocked(session: Any, task: Any, item: Any) -> bool:
    """投递前的兜底：命中屏蔽清单就地把条目记为「已跳过」并返回 True。

    与 ``ItemSkip`` 同一形态（软跳过、不计失败、不触发熔断），但**必须留下原因**：
    用户看到"已跳过"却不知道为什么，只会以为程序漏投了。放在本模块而不是
    ``task_apply`` 里，是因为 ``task_apply`` 的行数预算已经贴线（496/500）。
    """
    hit = load_blocklist(session).hit(getattr(item, "company", ""), getattr(item, "job_title", ""))
    if not hit:
        return False
    item.status = ITEM_STATUS_SKIPPED
    item.failure_detail = (
        f"命中屏蔽清单（{hit}），已跳过；要去掉它请在「投递设置 → 屏蔽清单」里删除"
    )
    item.finished_at = utcnow()
    task.processed += 1
    task.skipped += 1
    session.commit()
    return True


def drop_if_blocked(report: Any, blocklist: Blocklist, company: str, title: str) -> bool:
    """采集入库前的闸门：命中就记账并返回 True（调用方随即 ``continue``）。

    只在采集账目里加一条 ``blocked``，不写暂存区：被屏蔽的岗位**不该**出现在
    "本次采集结果"里让用户再挑一次，否则他会以为是采集漏了。
    """
    if not blocklist.hit(company, title):
        return False
    report.blocked += 1
    return True


__all__ = [
    "KEYWORD_STOPWORDS",
    "MIN_KEYWORD_CHARS",
    "Blocklist",
    "build_blocklist",
    "clean_keywords",
    "drop_if_blocked",
    "load_blocklist",
    "skip_if_blocked",
]
