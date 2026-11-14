# SPDX-License-Identifier: Apache-2.0
"""候选人门户的状态识别（R-15 C）。

只做两件事：**认平台**与**从页面文字里认状态**。刻意不做推断——认不出就是
``unknown``，由上层决定"什么都不改"。这是本模块唯一可能误导用户的地方：

- 岗位页写「不再接受申请」不等于你被拒，只说明这个岗位下线了。所以下架文案
  单独走 :attr:`ProbeKind.CLOSED`，**绝不映射成** ``STATUS_REJECTED``。
- 门户页的「Under review」是筛选中，「Interview」才是面试；两者只差一个词，
  所以每条状态都要求命中**完整词组**，不接受单词模糊匹配。
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field
from enum import StrEnum

from ..models.tracker import (
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_SCREENING,
    STATUS_UNKNOWN,
)


class ProbeKind(StrEnum):
    """识别结果的种类：改状态 / 只说明岗位下线 / 什么都没读到。"""

    STATUS = "status"
    CLOSED = "closed"
    UNKNOWN = "unknown"


#: 平台识别：host 片段 → 平台名。与 `web_fetch/platform_adapters` 同一个口径，
#: 那边认的是公开岗位页，这边认的是候选人门户（路径不同、host 通常相同）。
PORTAL_HOSTS: tuple[tuple[str, str], ...] = (
    ("myworkdayjobs.com", "workday"),
    ("workday.com", "workday"),
    ("greenhouse.io", "greenhouse"),
    ("lever.co", "lever"),
    # 国内校招最常见的两家 SaaS：Moka（app.mokahr.com，校招官网与投递记录都在这儿）
    # 与北森（*.zhiye.com）。它们的候选人页面是服务端渲染的，状态词直接出现在 HTML 里。
    # 飞书招聘（Feishu Hire）：企业招聘官网通常是 `*.jobs.feishu.cn` 或自有域名，
    # 页面是前端渲染的，所以回读会走浏览器渲染那条路（见 `track_probe._fetch_html`）。
    ("feishu.cn", "feishu"),
    # 字节自研校招站：岗位详情页的徽标（已投递/面试中…）能读到；
    # 但「应聘记录」列表页在自动化打开时不拉数据（见 R-15C 验收记录），只能走单条页。
    ("bytedance.com", "bytedance"),
    ("mokahr.com", "moka"),
    ("zhiye.com", "beisen"),
    ("icims.com", "icims"),
    ("smartrecruiters.com", "smartrecruiters"),
)

#: 状态文案 → 状态。**顺序即优先级**：终态与更靠后的阶段先判，
#: 避免一封同时提到「面试」和「offer」的页面被判成面试。
#: 每条都要求完整词组（英文按小写全文比较，中文按原文比较）。
STATUS_PATTERNS: tuple[tuple[str, tuple[str, ...]], ...] = (
    (
        STATUS_REJECTED,
        (
            "no longer under consideration",
            "not moving forward",
            "will not be moving forward",
            "application was not selected",
            "not selected for this position",
            "we regret to inform",
            "unfortunately, we",
            "position has been filled",
            "流程终止",
            "未通过",
            "未获录用",
            "简历不合适",
            "已淘汰",
            "很遗憾",
        ),
    ),
    (
        STATUS_OFFER,
        (
            "offer letter",
            "we are pleased to offer",
            "pleased to extend an offer",
            "extend you an offer",
            "congratulations on your offer",
            "已发出 offer",
            "发放 offer",
            "录用通知",
            "已录用",
            "拟录用",
            "待入职",
            "已入职",
        ),
    ),
    (
        STATUS_INTERVIEW,
        (
            "schedule your interview",
            "interview invitation",
            "invite you to interview",
            "interview scheduled",
            "your interview",
            "面试邀请",
            "安排面试",
            "面试通知",
            "面试中",
            "待面试",
            "面试安排",
            "邀约面试",
            "初试",
            "复试",
            "终试",
            "ai面试",
        ),
    ),
    (
        STATUS_ASSESSMENT,
        (
            "online assessment",
            "coding challenge",
            "take-home",
            "take home assignment",
            "technical assessment",
            "笔试",
            "测评",
            "在线测试",
            "在线笔试",
            "笔试通知",
        ),
    ),
    (
        STATUS_SCREENING,
        (
            "under review",
            "in review",
            "reviewing your application",
            "application is being reviewed",
            "recruiter screen",
            "phone screen",
            "筛选中",
            "简历评估",
            "简历筛选",
            "初筛",
            "待筛选",
            "评估中",
            "审核中",
        ),
    ),
    (
        STATUS_APPLIED,
        (
            "application received",
            "thank you for applying",
            "we received your application",
            "application submitted",
            "已收到您的申请",
            "已投递",
            "申请成功",
            "投递成功",
            # 字节校招的流程节点名（实测：只渲染到当前步骤，未开始的步骤不在 DOM 里，
            # 所以取"最靠后"不会被误判成 Offer）。
            "投递简历",
        ),
    ),
)

#: 中立文案：命中后**不改状态**，只把原话带回去。
#:
#: 「进入人才库」是最容易被误判成淘汰的一句——Moka 等系统的招聘 Q&A 里明确写着它
#: 不等于淘汰（岗位招满或匹配度暂未达到优先推进标准时进储备）。这条必须先于
#: :data:`STATUS_PATTERNS` 判定，否则会被后面的「申请成功」之类盖过或反过来被
#: 误判成「已结束」。
NEUTRAL_PATTERNS: tuple[tuple[str, str], ...] = (
    ("进入人才库", "这条记录显示「进入人才库」——它不等于淘汰，进度保持不变。"),
    ("人才库", "这条记录显示在「人才库」中——它不等于淘汰，进度保持不变。"),
)

#: 岗位详情页特征：这一页在讲"要什么人"，「投递」是按钮/入口（字节实测 ``atsx-btn``），
#: 不能拿来判断投没投过。
JOB_PAGE_MARKERS: tuple[str, ...] = (
    "职位描述",
    "岗位职责",
    "工作职责",
    "职位要求",
    "任职要求",
    "岗位要求",
    "job description",
    "responsibilities",
    "what you'll do",
)

#: 只可能是"入口/按钮"的词：在岗位详情页上一律不认；它们在**投递记录页**上是
#: 真阶段名（字节校招流程节点就叫「投递简历」），所以只按页面类型排除，不删词。
CTA_ONLY_PATTERNS: frozenset[str] = frozenset(
    {"投递简历", "立即投递", "申请该职位", "立即申请", "apply now", "apply for this job"}
)

#: 登录页特征：命中两个以上、且页面很短，就认定"停在登录页"。
#: 只用中文词——英文 "sign in" 在页脚里到处都是，容易误判。
LOGIN_MARKERS: tuple[str, ...] = (
    "手机号码登录",
    "邮箱登录",
    "获取验证码",
    "扫码登录",
    "密码登录",
    "登录后",
)
#: 登录页通常只有几百字（状态页至少一张卡片）；两条回读路径共用同一句说明。
LOGIN_PAGE_MAX_CHARS = 1200
LOGIN_NOTE = "这一页停在登录页：先在投递浏览器里登录这家网站，再点一次回读。"

#: 岗位下线文案：只说明这条招聘关了，**不能**当成拒信。
CLOSED_PATTERNS: tuple[str, ...] = (
    "no longer accepting applications",
    "this job is no longer available",
    "job posting is closed",
    "position is closed",
    "applications are closed",
    "已停止招聘",
    "岗位已下线",
    "该职位已关闭",
)


@dataclass(frozen=True)
class ProbeResult:
    """一次识别的结论。"""

    kind: ProbeKind
    #: `kind == STATUS` 时是六个阶段之一，否则是空串。
    status: str = ""
    platform: str = ""
    #: 命中的原文片段（给用户看"我是凭哪句话判断的"）。
    evidence: str = ""
    #: 面向用户的说明；`kind != STATUS` 时一定能读懂的短句。
    note: str = ""
    #: 命中了多少条：`> 1` 说明页面同时提到多个阶段，按优先级取了最靠后的。
    hits: tuple[str, ...] = field(default_factory=tuple)

    @property
    def usable(self) -> bool:
        return self.kind == ProbeKind.STATUS and bool(self.status) and self.status != STATUS_UNKNOWN


#: 公司名与岗位名之间允许隔多少字符。投递记录的一张卡片通常是
#: 「公司 / 岗位 / 阶段 / 时间」，两者挨得很近；放宽到 60 是为了容忍
#: 「公司 · 城市 · 岗位」这种排法，又不足以跨到下一条记录。
GAP_CHARS = 60
#: 两个名字之后再多取多少字符找状态词（阶段标签通常在岗位名后面）。
TAIL_CHARS = 160


def _loose_pattern(value: str) -> str:
    """把关键词变成"字符之间允许任意空白"的正则。

    页面文本的换行与空格位置不可控（卡片布局会把「后端开发实习生」拆成多行），
    逐字符放宽比先压平文本更安全——压平后就没法拿回原文做证据了。
    """
    chars = [re.escape(ch) for ch in value if not ch.isspace()]
    return r"\s*".join(chars)


def _contains_status(text: str) -> bool:
    """这段文字里是否已经出现状态词（用于判断有没有跨到别的卡片）。"""
    lowered = text.lower()
    return any(pattern in lowered for _, patterns in STATUS_PATTERNS for pattern in patterns)


def looks_like_login_page(text: str) -> bool:
    """这一页是不是"要我登录"的登录页。

    判据是**两个以上中文登录控件词 + 页面很短**。只看一个词会误伤：登录之后的
    页面导航里也常有「登录」字样（「退出登录」），所以要求登录表单的几个控件同时在。
    英文词不参与判断——页脚里的 "sign in" 到处都是。
    """
    if not text or len(text) > LOGIN_PAGE_MAX_CHARS:
        return False
    lowered = text.lower()
    return sum(1 for pattern in LOGIN_MARKERS if pattern in lowered) >= 2


def locate_excerpt(
    text: str,
    company: str,
    title: str,
    *,
    others: tuple[str, ...] = (),
    gap: int = GAP_CHARS,
    tail: int = TAIL_CHARS,
) -> str:
    """定位「这家公司的这个岗位」，返回可用于读状态的片段；找不到返回空串。

    两条路径，都是为了避免把别家岗位的进度写到这条记录上：

    **正常路径**——公司名与岗位名相邻（``gap`` 字符内），且中间不夹别的记录的
    标识或任何状态词（夹了就说明跨了卡片）。窗口在下一个标识处切断。

    **单公司兜底**——整站只有一家公司时（字节校招的应聘记录页），卡片上只写岗位名，
    公司名只出现在页脚/导航里，离岗位名很远。这时要求：

    1. 公司名与这条记录的岗位名**在任何位置都不相邻**（相邻就说明它参与了记录，
       只是被跨卡片校验否掉了——那是有歧义，不能兜底）；
    2. 岗位名在整页**只出现一次**（出现多次比如"相关职位"里也有同名，无法判断）。

    找不到就返回空串，由上层记「跳过」，绝不猜。
    """
    if not text or not company.strip() or not title.strip():
        return ""
    flat = unicodedata.normalize("NFKC", text)
    head = _loose_pattern(unicodedata.normalize("NFKC", company))
    body = _loose_pattern(unicodedata.normalize("NFKC", title))
    neighbours = [
        _loose_pattern(unicodedata.normalize("NFKC", name))
        for name in others
        if name.strip() and name.strip() != company.strip()
    ]
    titles = list(re.finditer(body, flat, re.IGNORECASE))
    orgs = list(re.finditer(head, flat, re.IGNORECASE))

    def _window(named, org=None) -> str:
        start = named.start() if org is None else max(0, min(org.start(), named.start()))
        edge = named.end() if org is None else max(org.end(), named.end())
        stop = min(len(flat), edge + tail)
        for pattern in neighbours:
            found = re.search(pattern, flat[edge:stop], re.IGNORECASE)
            if found is not None:
                stop = min(stop, edge + found.start())
        return flat[start:stop]

    close_pairs = [
        (named, org) for named in titles for org in orgs if abs(org.start() - named.start()) <= gap
    ]
    for named, org in close_pairs:
        between = flat[max(0, min(org.start(), named.start())) : max(org.end(), named.end())]
        if any(re.search(pattern, between, re.IGNORECASE) for pattern in neighbours):
            # 两个名字之间夹着别的记录 → 这对组合跨了卡片，本条不能借它下结论。
            return ""
        if _contains_status(between):
            # 中间只隔着状态词：公司名不在这张卡片里（比如在页脚），换下一个组合。
            continue
        return _window(named, org)
    # 单公司站点兜底：**页面上完全不出现公司名**时才用（整站就一家，卡片只写岗位名），
    # 且岗位名必须唯一。公司名只要在页面上出现过（哪怕只在页脚），就不兜底——
    # 字节校招的应聘记录页正是这种情况：卡片不写公司名，页脚写「字节跳动」，
    # 任何"相邻"判断都会在短页面上失真。这种站只能逐条读岗位详情页的徽标。
    if re.search(head, flat, re.IGNORECASE):
        return ""
    if len(titles) != 1:
        return ""
    return _window(titles[0])


def detect_portal(url: str) -> str:
    """从 URL 认平台；认不出返回空串（不是错误，公开岗位页也能读）。"""
    host = (url or "").split("//")[-1].split("/")[0].lower()
    for fragment, name in PORTAL_HOSTS:
        if fragment in host:
            return name
    return ""


_TAG_RE = re.compile(r"<[^>]+>")
_SCRIPT_RE = re.compile(r"<(script|style|noscript)\b[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_SPACE_RE = re.compile(r"[ \t\r\f\v\u00a0]+")


def page_text(html: str) -> str:
    """HTML → 便于匹配的纯文本（保留换行，压缩行内空白）。

    先去 script/style：门户页的埋点脚本里常带 "interview" 之类的变量名，
    留着会让"每个页面都像面试通知"。
    """
    if not html:
        return ""
    stripped = _SCRIPT_RE.sub(" ", html)
    text = _TAG_RE.sub("\n", stripped)
    text = text.replace("&nbsp;", " ").replace("&amp;", "&")
    lines = [_SPACE_RE.sub(" ", line).strip() for line in text.splitlines()]
    return "\n".join(line for line in lines if line)


def probe_status(url: str, html: str) -> ProbeResult:
    """从一页 HTML 判断申请走到哪一步。

    命中多条时按 :data:`STATUS_PATTERNS` 的顺序取最靠后（终态优先）的那个，
    并把所有命中片段一起带出去，方便用户核对。
    """
    platform = detect_portal(url)
    text = page_text(html)
    if not text:
        return ProbeResult(
            ProbeKind.UNKNOWN, platform=platform, note="页面没有可读文字（可能需要登录）"
        )
    lowered = text.lower()

    if looks_like_login_page(text):
        return ProbeResult(
            ProbeKind.UNKNOWN,
            platform=platform,
            evidence=next(pattern for pattern in LOGIN_MARKERS if pattern in lowered),
            note=LOGIN_NOTE,
        )

    for pattern, note in NEUTRAL_PATTERNS:
        if pattern in lowered:
            return ProbeResult(ProbeKind.UNKNOWN, platform=platform, evidence=pattern, note=note)

    # 岗位详情页只讲"要什么人"，上面的「投递」是按钮；把它当成"已投递"是这套功能
    # 最容易造成的误报（用户没投过却被改成已投递）。这里按页面类型收紧：
    #
    # - 只认「已投递 / 申请成功」这类**关于你**的回执或徽标；
    # - 「面试」「笔试」「流程」在岗位页上是**流程介绍**（"面试流程：三轮"），
    #   不是你的进度，一律不认；
    # - 「投递简历」这类纯入口词在岗位页上一律不认（它在投递记录页是真阶段名）。
    job_page = any(marker in lowered for marker in JOB_PAGE_MARKERS)

    hits: list[str] = []
    for status, patterns in STATUS_PATTERNS:
        if job_page and status != STATUS_APPLIED:
            continue
        for pattern in patterns:
            if job_page and status == STATUS_APPLIED and pattern in CTA_ONLY_PATTERNS:
                continue
            if pattern in lowered:
                hits.append(pattern)
        if hits:
            return ProbeResult(
                ProbeKind.STATUS,
                status=status,
                platform=platform,
                evidence=hits[0],
                hits=tuple(hits),
            )

    for pattern in CLOSED_PATTERNS:
        if pattern in lowered:
            return ProbeResult(
                ProbeKind.CLOSED,
                platform=platform,
                evidence=pattern,
                note="这个岗位已下线；它不代表你被拒，进度保持不变。",
            )

    if job_page and any(pattern in lowered for pattern in CTA_ONLY_PATTERNS):
        return ProbeResult(
            ProbeKind.UNKNOWN,
            platform=platform,
            note=(
                "这一页是岗位详情页：上面的「投递」是按钮/入口，看不出你投没投。"
                "要看进度，改用应聘记录（投递记录）页的链接。"
            ),
        )

    if job_page:
        # 岗位页读不出进度是常态，不是"页面有问题"：明确告诉用户该换哪一页，
        # 免得他以为识别器坏了而反复点回读。
        return ProbeResult(
            ProbeKind.UNKNOWN,
            platform=platform,
            note=(
                "这一页是岗位详情页，只介绍岗位，不显示你的申请进度。"
                "要看进度，改用应聘记录（投递记录）页的链接。"
            ),
        )
    return ProbeResult(
        ProbeKind.UNKNOWN,
        platform=platform,
        note="页面里没有可识别的申请状态（多数门户需要登录后才能看到）。",
    )


__all__ = [
    "CLOSED_PATTERNS",
    "CTA_ONLY_PATTERNS",
    "JOB_PAGE_MARKERS",
    "LOGIN_MARKERS",
    "LOGIN_NOTE",
    "LOGIN_PAGE_MAX_CHARS",
    "NEUTRAL_PATTERNS",
    "PORTAL_HOSTS",
    "STATUS_PATTERNS",
    "ProbeKind",
    "ProbeResult",
    "GAP_CHARS",
    "TAIL_CHARS",
    "detect_portal",
    "locate_excerpt",
    "looks_like_login_page",
    "page_text",
    "probe_status",
]
