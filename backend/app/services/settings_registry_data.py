# SPDX-License-Identifier: Apache-2.0
"""I-10 默认值登记表（数据）。改默认值只改这里；类型与判定见 ``settings_default_types``。"""

from __future__ import annotations

from ..config import get_settings
from .settings_default_types import SettingDefault

REGISTRY_ENTRIES: tuple[SettingDefault, ...] = (
    # —— 卡：AI 模型（scope=model）——
    SettingDefault(
        key="llm_config",
        scope="model",
        kind="fields",
        default={
            "temperature": 0.1,
            "timeout_seconds": 120,
            "max_tokens": 0,
            "api_style": "openai",
            "top_p": None,
            "frequency_penalty": None,
            "presence_penalty": None,
            "seed": None,
            "top_k": None,
            "repetition_penalty": None,
            "stop": [],
            "thinking_budget": None,
            "thinking_enabled": False,
            "thinking_effort": "",
            "thinking_style": "auto",
            "context_window_tokens": 0,
            "extra_body": {},
        },
        note="只重置调参；api_key / base_url / model / provider 属于「配置身份」，保留",
    ),
    SettingDefault(
        key="assistant_compaction_model",
        scope="model",
        default="",
        note="空串 = 跟随当前生效模型",
    ),
    SettingDefault(
        key="assistant_compaction_mask_percent",
        scope="model",
        default=60,
        note="与 assistant_compaction.DEFAULT_MASK_PERCENT 一致",
    ),
    SettingDefault(
        key="assistant_compaction_summary_percent",
        scope="model",
        default=75,
        note="与 assistant_compaction.DEFAULT_SUMMARY_PERCENT 一致",
    ),
    # —— 卡：语音转写（scope=asr）——
    SettingDefault(
        key="asr_config",
        scope="asr",
        kind="fields",
        default={"base_url": "", "model": "", "protocol": "openai"},
        note="迁移前的旧键；api_key 单独一行（asr_api_key），不在本字段表内",
    ),
    SettingDefault(
        key="asr_api_key",
        scope="asr",
        storage="text",
        default="",
        resettable=False,
        note="密钥：单独一行、加密存放，永不重置（用户点一下就会丢 Key）",
    ),
    # —— 卡：求职助手（scope=assistant）——
    SettingDefault(
        key="assistant_permission",
        scope="assistant",
        default="read_only",
        note="四档最低档；放宽读取等于扩大发往模型的个人信息面",
    ),
    SettingDefault(
        key="assistant_relaxed_mode",
        scope="assistant",
        default=False,
        note="旧键（读轴）；与新四档同步写入，重置时一并回默认",
    ),
    SettingDefault(
        key="assistant_max_tool_rounds",
        scope="assistant",
        default=30,
        note="与 assistant_limits.DEFAULT_MAX_TOOL_ROUNDS 一致",
    ),
    SettingDefault(
        key="assistant_stream_budget_seconds",
        scope="assistant",
        default=lambda: get_settings().assistant_stream_budget_seconds,
        note="默认跟随部署配置（1800 秒），删行即回部署默认",
    ),
    SettingDefault(
        key="assistant_tool_result_max_chars",
        scope="assistant",
        default=8000,
        note="与 assistant_limits.DEFAULT_TOOL_RESULT_MAX_CHARS 一致；0 = 不限",
    ),
    SettingDefault(
        key="assistant_memory_auto_extract",
        scope="assistant",
        default=False,
        note="后台自动写记忆，默认关（与其它「助手主动行为」同一口径）",
    ),
    SettingDefault(
        key="assistant_memory_inject",
        scope="assistant",
        default=True,
        note="记忆注入总开关（T23）：默认开，升级不改变既有行为",
    ),
    SettingDefault(
        key="agent_task_events_enabled",
        scope="assistant",
        default=False,
        note="提醒到期自动建卡，默认关：只建卡、不执行写操作",
    ),
    # —— 卡：网申填表（scope=webform）——
    SettingDefault(
        key="webform_relaxed_mode",
        scope="webform",
        default=False,
        note="会代点下拉/弹层控件，默认关",
    ),
    # —— 卡：界面与导航（scope=ui）——
    SettingDefault(
        key="reminder_popup_on_start",
        scope="ui",
        default=True,
        note="提醒弹窗是产品承诺的功能，默认开",
    ),
    SettingDefault(
        key="assistant_orb_enabled",
        scope="ui",
        default={"enabled": True, "tips_enabled": True, "selection_enabled": True},
        note="悬浮球三开关默认全开（与 AssistantOrbSetting() 一致）",
    ),
    SettingDefault(
        key="editor_inline_format_preview",
        scope="ui",
        default=False,
        note="未编辑时按真实行内样式预览；默认关，避免每次点击多一拍",
    ),
    SettingDefault(
        key="tray_icon_follow_system",
        scope="ui",
        default=False,
        note="桌面版：托盘图标跟随系统主题（兜底开关）；默认关，应用内主题优先",
    ),
    SettingDefault(
        key="navigation_visibility",
        scope="ui",
        default={"hidden": []},
        note="默认不隐藏任何入口",
    ),
    # —— 卡：投递台（scope=apply）——
    SettingDefault(
        key="apply_blocklist",
        scope="apply",
        default={"companies": [], "keywords": []},
        note="空清单 = 不屏蔽任何公司/关键词",
    ),
    SettingDefault(key="apply_greeting_templates", scope="apply", default=[]),
    # —— 卡：投递跟踪（scope=tracking）——
    SettingDefault(
        key="analytics_weekly_goal",
        scope="tracking",
        kind="fields",
        default={"target": 0},
        note="0 = 没设目标（不显示进度压力）",
    ),
    SettingDefault(key="tracker.probe.enabled", scope="tracking", default=False),
    SettingDefault(key="tracker.probe.page_url", scope="tracking", storage="text", default=""),
    SettingDefault(
        key="tracker.probe.cookie",
        scope="tracking",
        storage="text",
        default="",
        resettable=False,
        note="登录凭据：永不出现在接口响应里，也不随快照导出",
    ),
    # —— 卡：备份与导出（scope=backup）——
    SettingDefault(
        key="export_save_location",
        scope="backup",
        storage="text",
        default="",
        note="空串 = 仅浏览器下载（默认行为）",
    ),
    SettingDefault(
        key="auto_backup_interval_days",
        scope="backup",
        default=lambda: max(1, get_settings().auto_backup_interval_days),
        note="默认跟随部署配置（7 天）",
    ),
    # —— 卡：操作习惯（scope=interaction）——
    SettingDefault(
        key="batch_operation_config",
        scope="interaction",
        default={},
        note="两节参数（生成/导出）；空对象 = 两节都未配置",
    ),
    # —— 迁移前的联网搜索旧键（只登记密钥那一行，禁止重置）——
    SettingDefault(
        key="search_deepseek_api_key",
        scope="search",
        storage="text",
        default="",
        resettable=False,
        note="迁移前的旧密钥行（保留作回滚面包屑）；密钥一律不可重置",
    ),
)
