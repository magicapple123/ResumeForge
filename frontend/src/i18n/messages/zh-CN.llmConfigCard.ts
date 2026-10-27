// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「大模型 API 配置」卡片：卡片头与新建入口、顶部说明条、空态、记录卡
 * （生效标记、脱敏提示、使用 / 测试连接 / 更多操作）、连接测试结果与删除确认。
 *
 * 记录里的模型名与地址是用户填的，这里只放「未填写」的兜底；预设名与 API Key
 * 占位符分别在 `SettingsConfig.ts` 与 `llmRecord` 包里，本文件不重复一份。
 */
const llmConfigCard = {
  /** 卡片标题。 */
  "llmConfigCard.card.title": "大模型 API 配置",
  /** 卡片右上角的唯一主动作。 */
  "llmConfigCard.action.create": "新建配置",
  /** 卡片顶部说明：支持哪些协议与服务商、所有数据集共用、密钥存在哪里。 */
  "llmConfigCard.hint.intro":
    "支持所有兼容 OpenAI Chat Completions 协议的模型服务（DeepSeek、豆包、Kimi、通义千问、智谱、MiniMax、硅基流动、OpenRouter、OpenAI、Gemini、Ollama 等），也可切换到 Anthropic 原生协议直连 Claude。所有数据集共用这里的配置：每张卡片是一份已保存的记录，点卡片本体查看详情，可直接测试连接、切换「使用中」。API Key 加密保存在本地数据目录，不进入备份包。",
  "llmConfigCard.empty.description":
    "还没有配置记录，点「新建配置」创建第一份；当前生效的配置会继续正常使用",

  /** 还沿用数据集旧配置时的那条提示：标题说明会被升级，正文给出当前实际值。 */
  "llmConfigCard.legacy.title": "当前沿用本数据集旧配置，保存后将升级为全局配置",
  "llmConfigCard.legacy.description":
    "正在使用：{model} · {baseUrl}。保存一次（或新建一条记录后点「使用」）即改为所有数据集共用。",
  /** 模型名 / 地址为空时的兜底文案（记录卡与上面的提示条共用一个 key）。 */
  "llmConfigCard.fallback.model": "未填写模型",
  "llmConfigCard.fallback.baseUrl": "未填写地址",

  /** 悬停在记录名上显示最近更新时间。 */
  "llmConfigCard.tooltip.updatedAt": "更新于 {time}",
  /** 生效记录上「使用中」标签的悬停解释。 */
  "llmConfigCard.tooltip.active": "当前生效的配置：简历生成与求职助手正在用它",
  "llmConfigCard.tag.active": "使用中",
  "llmConfigCard.tag.keyConfigured": "密钥已配置",

  /** 记录卡上的三个动作与更多菜单。 */
  "llmConfigCard.action.apply": "使用",
  "llmConfigCard.action.test": "测试连接",
  "llmConfigCard.action.edit": "编辑",
  "llmConfigCard.action.delete": "删除",
  "llmConfigCard.action.cancel": "取消",
  /** 「···」按钮的可访问名：读屏要听出操作的是哪条记录。 */
  "llmConfigCard.aria.moreActions": "更多操作（{name}）",

  /** 卡上的连接测试结果：成功带耗时，失败带原因。 */
  "llmConfigCard.test.ok": "{message}（耗时 {latency}ms）",
  "llmConfigCard.test.failed": "连接失败：{message}",

  /** 删除确认：说清删的是哪条记录，以及不影响正在使用的配置。 */
  "llmConfigCard.confirm.deleteTitle": "删除记录“{name}”？",
  "llmConfigCard.confirm.deleteContent": "删除记录不会影响当前正在使用的配置",
} as const;

export default llmConfigCard;
