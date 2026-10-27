// SPDX-License-Identifier: Apache-2.0
/**
 * 应用级展示表：品牌名、大模型预设名、经历美化档位、思考档位与参数形态、生成进度阶段、
 * GitHub 星标提示、页头源码入口，以及简历详情预览与模型配置 hook 的提示文案。
 *
 * 这些字符串原先散落在 `config.ts` / `settings/SettingsConfig.ts` / `thinkingMeta.ts`
 * 等模块级常量表里。表里只存 key：**模块作用域禁止求值 `t()`**（切语言后不会重新求值），
 * 渲染处再取文案。
 */
const appConfig = {
  // ── 品牌 ──────────────────────────────────────────────────
  /** 应用名的唯一真相（页头品牌区、文档标题、星标提示、源码入口的无障碍名都取它）。 */
  "appConfig.brand.name": "简历通",

  // ── 大模型预设（选择后自动填充 Base URL 与模型名）────────────
  "appConfig.preset.deepseek": "DeepSeek（深度求索）",
  "appConfig.preset.anthropic": "Claude（Anthropic 原生协议）",
  "appConfig.preset.doubao": "豆包（火山方舟）",
  "appConfig.preset.kimi": "Kimi（月之暗面）",
  "appConfig.preset.qwen": "通义千问（阿里云百炼）",
  "appConfig.preset.zhipu": "智谱 GLM",
  "appConfig.preset.minimax": "MiniMax",
  "appConfig.preset.siliconflow": "硅基流动 SiliconFlow",
  "appConfig.preset.openrouter": "OpenRouter（聚合网关）",
  "appConfig.preset.openai": "OpenAI",
  "appConfig.preset.gemini": "Google Gemini（OpenAI 兼容）",
  "appConfig.preset.xai": "xAI Grok",
  "appConfig.preset.groq": "Groq（推理加速）",
  "appConfig.preset.mistral": "Mistral AI",
  "appConfig.preset.ollama": "Ollama（本地部署）",
  "appConfig.preset.lmstudio": "LM Studio（本地部署）",
  /** 自定义模型：选中时保留当前内容（避免误点丢失已填的接口信息）。 */
  "appConfig.preset.custom": "自定义模型（OpenAI 兼容）",
  /** 纯手动配置：选中时清空 Base URL 与模型名，由用户从空白开始填。 */
  "appConfig.preset.manual": "纯手动配置（不套用任何预设）",

  // ── 经历美化档位 ───────────────────────────────────────────
  "appConfig.enhancement.light.label": "轻度",
  "appConfig.enhancement.light.description": "优化措辞与重点，基本保持原有篇幅",
  "appConfig.enhancement.balanced.label": "均衡",
  "appConfig.enhancement.balanced.description": "补足方法、技术细节与成果表达",
  "appConfig.enhancement.strong.label": "深度",
  "appConfig.enhancement.strong.description": "充分利用已有资料，强化岗位匹配度",
  /** 通用简历没有岗位可匹配，「深度」档换一个说法。 */
  "appConfig.enhancement.strong.description-general": "充分利用已有资料，充分展开过程与成果",

  // ── 思考强度 ──────────────────────────────────────────────
  "appConfig.effort.minimal": "最低",
  "appConfig.effort.low": "低",
  "appConfig.effort.medium": "中",
  "appConfig.effort.high": "高",
  /** 下拉里的「不指定档位」项。 */
  "appConfig.effort.default": "默认档位（不指定）",
  /** 档位名 + 原始取值，如「低（low）」；`{label}` 是档位名，`{effort}` 是协议取值。 */
  "appConfig.effort.withValue": "{label}（{effort}）",
  /** 「思考强度」的说明：两个分支（下拉 / 自定义输入框）共用同一份文案。 */
  "appConfig.effort.tooltip":
    "档位越高通常越慢也越贵。各家的档位划分不同，选项来自「检测思考支持」；也可以选「自定义…」自己填。" +
    "自定义值原样发给 OpenAI 兼容接口；Claude 原生协议下填写数字＝思考预算 tokens，填其他词按默认档处理。" +
    "留空表示不指定档位。",

  // ── 思考参数形态（请求体里用哪种写法）───────────────────────
  "appConfig.thinkingStyle.auto": "自动（按协议与服务商推断）",
  "appConfig.thinkingStyle.reasoningEffort": "reasoning_effort（OpenAI 系）",
  "appConfig.thinkingStyle.thinkingObject": "thinking 开关（智谱等）",
  "appConfig.thinkingStyle.enableThinking": "enable_thinking（通义 qwen3）",
  "appConfig.thinkingStyle.budget": "thinking 预算（Claude 原生）",

  // ── 生成进度阶段（与后端 progress 事件一一对应）──────────────
  "appConfig.progressStage.prepare.title": "整理资料",
  "appConfig.progressStage.prepare.description": "读取个人资料与岗位要求",
  "appConfig.progressStage.select.title": "筛选资料",
  "appConfig.progressStage.select.description": "按篇幅预算挑选相关内容",
  "appConfig.progressStage.generate.title": "调用模型生成",
  "appConfig.progressStage.generate.description": "模型正在撰写简历正文",
  "appConfig.progressStage.repair.title": "校验修复",
  "appConfig.progressStage.repair.description": "修正格式或改写空话套话",
  "appConfig.progressStage.done.title": "完成",
  "appConfig.progressStage.done.description": "结果已保存",

  // ── GitHub 星标提示 ──────────────────────────────────────
  /** `{name}` 是应用名（`appConfig.brand.name`）。 */
  "appConfig.star.title": "如果 {name} 对你有帮助",
  "appConfig.star.body": "欢迎去 GitHub 给项目点一个 Star ⭐——这是对独立开发最实在的支持。",
  "appConfig.star.action": "去点 Star",

  // ── 页头源码入口 ──────────────────────────────────────────
  "appConfig.header.repoTooltip": "在 GitHub 上查看源码 / 反馈问题",
  /** `{name}` 是应用名（`appConfig.brand.name`）。 */
  "appConfig.header.repoAria": "在 GitHub 上查看 {name} 源码",

  // ── 简历详情预览头部 ──────────────────────────────────────
  /** `{job}` 是已填写的岗位名，空值由调用方先用 `appConfig.detail.notFilled` 兜底。 */
  "appConfig.detail.targetJob": "目标岗位：{job}",
  /** 字段留空时的取值（求职意向为空）。 */
  "appConfig.detail.notFilled": "未填写",
  "appConfig.detail.model": "模型：{model}",
  /** `{level}` 是档位显示名（或已开启/未开启）。 */
  "appConfig.detail.enhancement": "美化拓展：{level}",
  /** `{time}` 是创建时刻（yyyy-MM-dd HH:mm）。 */
  "appConfig.detail.createdAt": "创建于 {time}",
  "appConfig.detail.rationale": "为什么是这样一份简历（生成说明）",
  "appConfig.detail.relayouting": "正在按新设置重新排版…",

  // ── 模型配置记录弹窗（`useLLMRecordTools`）─────────────────
  "appConfig.llmRecord.checkThinkingFailed": "检测思考支持失败",
  "appConfig.llmRecord.testFailed": "测试失败",
  /** 编辑保存成功；`{name}` 是记录名。 */
  "appConfig.llmRecord.savedEdit": "配置记录「{name}」已保存",
  /** 新建保存成功；`{name}` 是记录名。新记录不会自动生效。 */
  "appConfig.llmRecord.savedCreate": "新配置「{name}」已保存，点记录卡上的「使用」即可生效",
  "appConfig.llmRecord.saveFailed": "保存配置记录失败",
  "appConfig.llmRecord.fetchModelsFailed": "获取模型列表失败",

  // ── 设置页模型配置（`useLLMSettings`）─────────────────────
  "appConfig.llmSettings.loadFailed": "加载配置失败",
  /** `{name}` 是记录名。 */
  "appConfig.llmSettings.switched": "已切换到配置「{name}」",
  "appConfig.llmSettings.switchFailed": "切换配置失败",
  "appConfig.llmSettings.refreshFailed": "配置记录已删除，但当前配置刷新失败",
  /** 同上，带上失败原因；`{message}` 是错误信息。 */
  "appConfig.llmSettings.refreshFailedDetail": "配置记录已删除，但当前配置刷新失败：{message}",
  "appConfig.llmSettings.deleted": "配置记录已删除",
  "appConfig.llmSettings.deleteFailed": "删除配置记录失败",
} as const;

export default appConfig;
