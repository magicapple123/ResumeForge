# SPDX-License-Identifier: Apache-2.0
"""自动投递的失败分类词表（一等的可识别类型，前后端共用一份取值）。

失败分类不是运行时故障日志：它决定用户看到的诊断信息与「只重试这 N 条」的筛选口径。
所以取值必须是稳定码、只在一处定义，且不允许把能归类的失败写成 ``unknown``。
"""

# ===== 失败分类（一等的可识别类型）=====
FAILURE_SELECTOR_INVALID = "selector_invalid"
FAILURE_LOGIN_REQUIRED = "login_required"
FAILURE_CAPTCHA_REQUIRED = "captcha_required"
FAILURE_GREETING_MISSING = "greeting_missing"
FAILURE_NETWORK_TIMEOUT = "network_timeout"
FAILURE_FILE_UPLOAD_FAILED = "file_upload_failed"
# 岗位不属于任何已注册的招聘网站（例如纯手动录入、来源与投递链接都指不到站点）。
# 它**不是**运行时故障，而是"这个岗位本来就不该走到投递这一步"——所以单列一类，
# 否则记录里只会写「未知失败」，用户与我们都看不出真正的原因。
FAILURE_SITE_UNSUPPORTED = "site_unsupported"
# 「资料不足」是**用户可以自己解决**的前置条件缺失（没有可用简历 / 资料键没值），不是站点
# 故障——所以按软跳过处理（不触发熔断），但要留下机器可读的分类让统计与界面说清楚。
FAILURE_PROFILE_INSUFFICIENT = "profile_insufficient"
# 「无法确认」= 动手了但读不到成功凭据。**未知状态永不记成功**，也不能当成站点故障去熔断
# （页面可能其实已经投出去了，重试反而会重复投递）——单列一类，让用户去浏览器核对。
FAILURE_UNCONFIRMED = "unconfirmed"
FAILURE_UNKNOWN = "unknown"
FAILURE_CATEGORIES = (
    FAILURE_SELECTOR_INVALID,
    FAILURE_LOGIN_REQUIRED,
    FAILURE_CAPTCHA_REQUIRED,
    FAILURE_GREETING_MISSING,
    FAILURE_NETWORK_TIMEOUT,
    FAILURE_FILE_UPLOAD_FAILED,
    FAILURE_SITE_UNSUPPORTED,
    FAILURE_PROFILE_INSUFFICIENT,
    FAILURE_UNCONFIRMED,
    FAILURE_UNKNOWN,
)
