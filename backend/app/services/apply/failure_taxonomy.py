# SPDX-License-Identifier: Apache-2.0
"""投递失败的稳定子码（#39）：把「分类 + 诊断文本」收敛成三个机器可读的码。

apply_task_item 上的三列（迁移 0073）语义：

- failure_step：失败发生在**哪一步**。复用 apply_task.current_step 的步骤码
  （opening / filling / greeting / uploading / submitting / verifying），界面直接按
  步骤名展示；unknown 表示诊断里也看不出。
- failure_target：**卡在哪个具体控件/环节**（chat_input / send_button / apply_entry /
  job_card / search_results / resume_upload）；空串 = 未识别。
- failure_reason：**为什么失败**的稳定子码（site_changed / render_timeout /
  page_not_navigated / selector_missing / login_required / captcha_required /
  greeting_missing / network_timeout / upload_failed / site_unsupported /
  profile_insufficient / unconfirmed / unknown）。

为什么要把它们从 failure_detail 的长句里拆出来：分类（10 类）粒度太粗——
「页面结构变化 / 选择器失效」底下「页面改版」「加载超时」「根本没跳到目标地址」
是三种完全不同的处理方式，界面上却只能靠用户自己读诊断长句区分。拆出稳定子码之后，
失败列表能筛、详情抽屉能按子码给建议、组头也能按同因聚合。

诊断文本是我们自己生成的（URL/标题/匹配数），但它是**自由文本**，所以这里只做
「关键词 → 码」的确定性映射，不执行任何内容。映射不中时回退到分类对应的最保守码
（selector_invalid → selector_missing，其余按分类同名），绝不因为一行奇怪的诊断把
失败吞掉。
"""

from __future__ import annotations

from dataclasses import dataclass

from ...models.apply import (
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_FILE_UPLOAD_FAILED,
    FAILURE_GREETING_MISSING,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_NETWORK_TIMEOUT,
    FAILURE_PROFILE_INSUFFICIENT,
    FAILURE_SELECTOR_INVALID,
    FAILURE_SITE_UNSUPPORTED,
    FAILURE_UNCONFIRMED,
    STEP_FILLING,
    STEP_GREETING,
    STEP_OPENING,
    STEP_SUBMITTING,
    STEP_UPLOADING,
    STEP_VERIFYING,
)

# ===== 稳定码 =====

# 步骤码直接复用 task.current_step 的取值；多一个 unknown 表示"诊断里也看不出"。
FAILURE_STEP_UNKNOWN = "unknown"
FAILURE_STEPS = (
    STEP_OPENING,
    STEP_FILLING,
    STEP_GREETING,
    STEP_UPLOADING,
    STEP_SUBMITTING,
    STEP_VERIFYING,
    FAILURE_STEP_UNKNOWN,
)

TARGET_CHAT_INPUT = "chat_input"
TARGET_SEND_BUTTON = "send_button"
TARGET_APPLY_ENTRY = "apply_entry"
TARGET_JOB_CARD = "job_card"
TARGET_SEARCH_RESULTS = "search_results"
TARGET_RESUME_UPLOAD = "resume_upload"
FAILURE_TARGET_UNKNOWN = ""
FAILURE_TARGETS = (
    TARGET_CHAT_INPUT,
    TARGET_SEND_BUTTON,
    TARGET_APPLY_ENTRY,
    TARGET_JOB_CARD,
    TARGET_SEARCH_RESULTS,
    TARGET_RESUME_UPLOAD,
    FAILURE_TARGET_UNKNOWN,
)

# 子码：界面按它出建议，所以名字要能长期稳定，不要跟着某次文案改动走。
REASON_SITE_CHANGED = "site_changed"
REASON_RENDER_TIMEOUT = "render_timeout"
REASON_PAGE_NOT_NAVIGATED = "page_not_navigated"
REASON_SELECTOR_MISSING = "selector_missing"
REASON_LOGIN_REQUIRED = "login_required"
REASON_CAPTCHA_REQUIRED = "captcha_required"
REASON_GREETING_MISSING = "greeting_missing"
REASON_NETWORK_TIMEOUT = "network_timeout"
REASON_UPLOAD_FAILED = "upload_failed"
REASON_SITE_UNSUPPORTED = "site_unsupported"
REASON_PROFILE_INSUFFICIENT = "profile_insufficient"
REASON_UNCONFIRMED = "unconfirmed"
REASON_UNKNOWN = "unknown"
FAILURE_REASONS = (
    REASON_SITE_CHANGED,
    REASON_RENDER_TIMEOUT,
    REASON_PAGE_NOT_NAVIGATED,
    REASON_SELECTOR_MISSING,
    REASON_LOGIN_REQUIRED,
    REASON_CAPTCHA_REQUIRED,
    REASON_GREETING_MISSING,
    REASON_NETWORK_TIMEOUT,
    REASON_UPLOAD_FAILED,
    REASON_SITE_UNSUPPORTED,
    REASON_PROFILE_INSUFFICIENT,
    REASON_UNCONFIRMED,
    REASON_UNKNOWN,
)

# 分类 → 子码的兜底：诊断文本没给更细的线索时按分类取这一码。
REASON_BY_CATEGORY = {
    FAILURE_LOGIN_REQUIRED: REASON_LOGIN_REQUIRED,
    FAILURE_CAPTCHA_REQUIRED: REASON_CAPTCHA_REQUIRED,
    FAILURE_GREETING_MISSING: REASON_GREETING_MISSING,
    FAILURE_NETWORK_TIMEOUT: REASON_NETWORK_TIMEOUT,
    FAILURE_FILE_UPLOAD_FAILED: REASON_UPLOAD_FAILED,
    FAILURE_SITE_UNSUPPORTED: REASON_SITE_UNSUPPORTED,
    FAILURE_PROFILE_INSUFFICIENT: REASON_PROFILE_INSUFFICIENT,
    FAILURE_UNCONFIRMED: REASON_UNCONFIRMED,
    FAILURE_SELECTOR_INVALID: REASON_SELECTOR_MISSING,
}


@dataclass(frozen=True)
class FailureCodes:
    """一次失败的三段稳定码；空串表示这一维没识别出来。"""

    step: str = ""
    target: str = ""
    reason: str = REASON_UNKNOWN


def _contains(text: str, *needles: str) -> bool:
    return any(needle in text for needle in needles)


def _step_from_detail(detail: str) -> str:
    """从诊断里的步骤提示 + 控件名推断步骤。

    诊断文本由各站点适配器写（见 services/sites/*），这里只认其中**稳定出现**的
    线索：适配器会在句首写「第 N 步「xxx」」，或者直接点名控件。两条都不中时给
    unknown——乱猜一个步骤比空着更糟，用户会按错的步骤去排查。
    """
    if _contains(detail, "第 1 步", "打开投递入口", "岗位卡片", "页面加载", "登录页"):
        return STEP_OPENING
    if _contains(detail, "第 2 步", "打招呼", "聊天输入框", "招呼语"):
        return STEP_GREETING
    if _contains(detail, "上传", "附件"):
        return STEP_UPLOADING
    if _contains(detail, "第 3 步", "发送", "提交前"):
        return STEP_SUBMITTING
    if _contains(detail, "第 4 步", "确认", "核对"):
        return STEP_VERIFYING
    if _contains(detail, "填写", "表单", "输入框"):
        return STEP_FILLING
    return FAILURE_STEP_UNKNOWN


def _target_from_detail(detail: str) -> str:
    """从诊断里点名的控件推断 failure_target。"""
    # 顺序有讲究：诊断里常同时出现"步骤名"与"真正卡住的控件"（例如「第 1 步「打开投递
    # 入口」的岗位卡片未渲染出来」）。要抓的是**真正卡住的那个控件**，所以具体控件排在
    # 泛泛的入口词之前。
    if _contains(detail, "聊天输入框", "消息输入框"):
        return TARGET_CHAT_INPUT
    if _contains(detail, "发送按钮"):
        return TARGET_SEND_BUTTON
    if _contains(detail, "岗位卡片"):
        return TARGET_JOB_CARD
    if _contains(detail, "搜索结果"):
        return TARGET_SEARCH_RESULTS
    if _contains(detail, "立即沟通", "沟通入口", "投递入口"):
        return TARGET_APPLY_ENTRY
    if _contains(detail, "上传", "简历附件"):
        return TARGET_RESUME_UPLOAD
    return FAILURE_TARGET_UNKNOWN


def _reason_from_detail(category: str, detail: str) -> str:
    """分类 + 诊断 → 子码。

    「页面结构变化 / 选择器失效」这一类必须再分三档，否则用户看不出该"等一等"还是
    "反馈给维护者"：
    - 页面根本没跳到目标地址 → page_not_navigated；
    - 页面加载超时（可能网络慢 / 被拦） → render_timeout；
    - 页面加载完了但控件找不到（改版） → site_changed。
    """
    if category == FAILURE_SELECTOR_INVALID:
        if _contains(detail, "没有切换到目标地址", "没有跳转", "未跳转"):
            return REASON_PAGE_NOT_NAVIGATED
        if _contains(detail, "加载超时", "超时"):
            return REASON_RENDER_TIMEOUT
        if _contains(detail, "页面改版", "结构可能已变化", "页面结构已变化", "改版"):
            return REASON_SITE_CHANGED
        return REASON_SELECTOR_MISSING
    return REASON_BY_CATEGORY.get(category, REASON_UNKNOWN)


def classify_failure(
    category: str,
    detail: str,
    *,
    step: str = "",
    target: str = "",
    reason: str = "",
) -> FailureCodes:
    """把一次失败收敛成三段稳定码。

    显式传进来的码优先（调用方知道得比诊断文本多，例如 SiteFailure 被标注了阶段）；
    其余从诊断文本推断。分类为空（不是失败）时返回全空 + unknown。
    """
    text = detail or ""
    if not category:
        return FailureCodes(step=step, target=target, reason=reason or REASON_UNKNOWN)
    resolved_reason = reason or _reason_from_detail(category, text)
    resolved_step = step or _step_from_detail(text)
    # 「页面根本没跳到目标地址」只可能发生在打开岗位页那一步——诊断里未必写了步骤名，
    # 但语义是确定的，所以补上，而不是留给界面显示"未识别"。
    if not resolved_step or (
        resolved_step == FAILURE_STEP_UNKNOWN and resolved_reason == REASON_PAGE_NOT_NAVIGATED
    ):
        resolved_step = STEP_OPENING
    return FailureCodes(
        step=resolved_step,
        target=target or _target_from_detail(text),
        reason=resolved_reason,
    )


__all__ = [
    "FAILURE_REASONS",
    "FAILURE_STEPS",
    "FAILURE_STEP_UNKNOWN",
    "FAILURE_TARGETS",
    "FAILURE_TARGET_UNKNOWN",
    "FailureCodes",
    "REASON_BY_CATEGORY",
    "REASON_CAPTCHA_REQUIRED",
    "REASON_GREETING_MISSING",
    "REASON_LOGIN_REQUIRED",
    "REASON_NETWORK_TIMEOUT",
    "REASON_PAGE_NOT_NAVIGATED",
    "REASON_PROFILE_INSUFFICIENT",
    "REASON_RENDER_TIMEOUT",
    "REASON_SELECTOR_MISSING",
    "REASON_SITE_CHANGED",
    "REASON_SITE_UNSUPPORTED",
    "REASON_UNCONFIRMED",
    "REASON_UNKNOWN",
    "REASON_UPLOAD_FAILED",
    "TARGET_APPLY_ENTRY",
    "TARGET_CHAT_INPUT",
    "TARGET_JOB_CARD",
    "TARGET_RESUME_UPLOAD",
    "TARGET_SEARCH_RESULTS",
    "TARGET_SEND_BUTTON",
    "classify_failure",
]
