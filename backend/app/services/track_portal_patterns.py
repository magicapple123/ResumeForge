# SPDX-License-Identifier: Apache-2.0
"""候选人门户识别用的静态文案表（从 ``track_portal.py`` 纯搬迁）。

为什么独立成模块：``track_portal.py`` 贴着 500 行预算，而这一大段纯粹是数据
（平台 host、状态文案、页面特征、登录/下线标记）。``track_portal`` 仍是对外门面：
下面的常量从本模块再导出，``__all__`` 与既有导入路径不变。

判定口径本身（顺序即优先级、完整词组、不把「下线」当拒信）写在各表的注释里，
搬迁时逐字保留——它们是这张表的语义，不是普通注释。
"""

from __future__ import annotations

from ..models.tracker import (
    STATUS_APPLIED,
    STATUS_ASSESSMENT,
    STATUS_INTERVIEW,
    STATUS_OFFER,
    STATUS_REJECTED,
    STATUS_SCREENING,
)

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
