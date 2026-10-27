// SPDX-License-Identifier: Apache-2.0
/** 前端常量配置：品牌信息与展示类配置集中在此。 */

// 版本号的单源是根 package.json 的 version 字段（CI 有一致性核对把它与后端
// config.py 的 app_version 钉在一起），这里直接读它，前端展示永远不与单源脱节。
import pkg from "../package.json";
import type { MessageKey } from "./i18n";

/**
 * 应用名的语言包 key。
 *
 * 中文字面量已搬进 `i18n/messages/zh-CN.appConfig.ts`：品牌名的唯一真相在那里，
 * 渲染处 `t(APP_NAME_KEY)`（页面标题、页头品牌区、星标提示、源码入口的无障碍名都取它）。
 * 这里只 `import type`——本文件**不引入任何运行时 i18n 模块**，避免把整份语言包拉进
 * `config.ts` 的模块图。
 */
export const APP_NAME_KEY: MessageKey = "appConfig.brand.name";
/** 英文品牌名（常量口径，不是界面文案；界面上取 `APP_NAME_KEY` 的值）。 */
export const APP_NAME_EN = "ResumeForge";

/** 应用版本号（页头品牌区展示，如 "0.17.0"）。 */
export const APP_VERSION: string = pkg.version;

/** 公开仓库地址可被部署环境覆盖；默认值用于开源发行版的导航入口。 */
export const GITHUB_REPO =
  import.meta.env.VITE_GITHUB_REPO?.trim() || "https://github.com/magicapple123/ResumeForge";

/**
 * JD/招聘原文类文本输入的统一硬上限（字符数）。
 *
 * 对齐后端三处的 `max_length=50_000`（`AtsCheckRequest.jd_text`、`JobTextParseRequest.text`、
 * 备选岗位 `raw_text`）：前端 maxLength 先挡住，用户顶到上限时由 MaxLengthHint 提示，
 * 而不是提交后才吃到 422。全仓禁用 antd showCount，提示一律走 common/MaxLengthHint。
 */
export const MAX_JOB_TEXT_CHARS = 50_000;

/** 大模型预设：选择后自动填充 Base URL 与模型名，省去查文档的麻烦 */
export interface LLMPreset {
  /** 预设显示名（语言包 key；渲染处 `t(preset.labelKey)`）。 */
  labelKey: MessageKey;
  provider: string;
  base_url: string;
  model: string;
  /**
   * 这个预设要走的接口协议，省略即 OpenAI 兼容。
   *
   * 预设是协议的入口：选了 Anthropic 原生那条就必须把 `api_style` 一起切过去。
   * 只填地址不改协议的话，用户会拿着一整套 Messages 协议的配置去发 Chat Completions
   * 请求，而错误信息只会说"接口返回 404"，看不出是协议选错了。
   *
   * 类型写联合类型而不是 `LLMApiStyle`：本文件**不引入 `types/`**，原因见
   * `enhancementLevelDescriptionKey` 上方的说明。
   */
  api_style?: "openai" | "anthropic";
}

/**
 * 大模型预设：选择后自动填充 Base URL 与模型名。
 *
 * 绝大多数条目是**提供 OpenAI 兼容接口**的服务商；Claude 另有一条走 Messages 原生协议
 * （扩展思考、独立 system 字段），所以预设里带了 `api_style`。
 *
 * 模型名只作为起点：各家迭代很快，旧名称可能下线，也可能作为兼容别名继续映射。
 * 界面上因此提供了「获取可用模型」按钮，按当前账号实际可用的模型覆盖这里的预填值。
 *
 * **最后一次核对：2026-10-01**（依据各家官方文档/下线公告）。下一次核对时重点看：
 * `deepseek-flash`、`kimi-k3`、`doubao-seed-2.1-pro`、`glm-5.3`、`MiniMax-M3`、
 * `gemini-3.6-flash`、`grok-4.3`、`gpt-5.1` 是否还在售。
 *
 * **改这里的模型名时，记得同步后端 `services/llm/thinking.py` 的能力表**：那张表按
 * 「主机 + 模型名」判断该用哪种思考写法，两处脱节过一次（预设用 `qwen-plus`、表里只认
 * `^qwen3`，于是通义用户看到的是一句"未收录"）。
 */
export const LLM_PRESETS: LLMPreset[] = [
  {
    // 2026-10-16 核对：模型列表使用 deepseek-flash / deepseek-v4-pro。
    // deepseek-v4-flash 仍是兼容别名；思考由 thinking 参数控制，默认开启。
    labelKey: "appConfig.preset.deepseek",
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-flash",
  },
  {
    // 地址必须带 /v1：provider 拼的是 `{base_url}/messages`，少了这一段会打到
    // https://api.anthropic.com/messages，那是官方根本不存在的路径。
    labelKey: "appConfig.preset.anthropic",
    provider: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    api_style: "anthropic",
  },
  {
    labelKey: "appConfig.preset.doubao",
    provider: "doubao",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2.1-pro",
  },
  {
    // kimi-k2 系列已于 2026-05-25 下线（含 kimi-k2-0711-preview），moonshot-v1 与
    // kimi-k2.5 于 2026-08-31 下线；当前主推 kimi-k3（思考常开）。
    labelKey: "appConfig.preset.kimi",
    provider: "kimi",
    base_url: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
  },
  {
    // `qwen-plus` 是官方长期保留的档位别名（指向当前的中端模型），比钉死某个版本稳。
    labelKey: "appConfig.preset.qwen",
    provider: "qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    labelKey: "appConfig.preset.zhipu",
    provider: "zhipu",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
  },
  {
    labelKey: "appConfig.preset.minimax",
    provider: "minimax",
    base_url: "https://api.minimax.chat/v1",
    model: "MiniMax-M3",
  },
  {
    labelKey: "appConfig.preset.siliconflow",
    provider: "siliconflow",
    base_url: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    labelKey: "appConfig.preset.openrouter",
    provider: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    // gpt-4o 这代已陆续下线，推理模型用 reasoning_effort 分档（各代档位不同，
    // 详见后端 services/llm/thinking.py 的能力表）。
    labelKey: "appConfig.preset.openai",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-5.1",
  },
  {
    // gemini-2.5 系列已于 2026-06-17 停机，当前的 Flash 是 3.6。
    labelKey: "appConfig.preset.gemini",
    provider: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
  },
  {
    labelKey: "appConfig.preset.xai",
    provider: "xai",
    base_url: "https://api.x.ai/v1",
    model: "grok-4.3",
  },
  {
    labelKey: "appConfig.preset.groq",
    provider: "groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  {
    labelKey: "appConfig.preset.mistral",
    provider: "mistral",
    base_url: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
  },
  {
    labelKey: "appConfig.preset.ollama",
    provider: "ollama",
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
  },
  {
    labelKey: "appConfig.preset.lmstudio",
    provider: "lmstudio",
    base_url: "http://localhost:1234/v1",
    model: "qwen2.5-7b-instruct",
  },
];

/** 经历美化程度（与后端 GenerateOptions.enhancement_level 对应）。 */
export const RESUME_ENHANCEMENT_LEVELS = [
  {
    value: "light",
    labelKey: "appConfig.enhancement.light.label",
    descriptionKey: "appConfig.enhancement.light.description",
  },
  {
    value: "balanced",
    labelKey: "appConfig.enhancement.balanced.label",
    descriptionKey: "appConfig.enhancement.balanced.description",
  },
  {
    value: "strong",
    labelKey: "appConfig.enhancement.strong.label",
    descriptionKey: "appConfig.enhancement.strong.description",
  },
] as const;

/**
 * 通用简历没有岗位可匹配，深度档的说明要换一个说法。
 *
 * 返回**语言包 key**，不是文案：本文件是模块作用域，禁止求值 `t()`（切语言后不会重新
 * 求值）。调用方写 `t(enhancementLevelDescriptionKey(...))`。
 *
 * 参数类型直接写联合类型，**不要**改成 `import type { EnhancementLevel } from "./types"`：
 * 实测只是加上那一行类型导入，`AssistantPage.test.tsx` 就从稳定通过变成 5/6 失败
 * （报错是空态元素刚找到就被卸载，像时序问题；去掉后 6/6 通过）。类型导入本身不该有
 * 运行时影响，具体机制没查清，所以这里保持不引入 `types/` barrel。
 */
export function enhancementLevelDescriptionKey(
  level: "light" | "balanced" | "strong",
  general = false,
): MessageKey {
  if (general && level === "strong") return "appConfig.enhancement.strong.description-general";
  const matched = RESUME_ENHANCEMENT_LEVELS.find((item) => item.value === level);
  // 三档表覆盖了全部取值；find 的兜底只为让类型收窄，正常路径不会走到这里。
  return matched ? matched.descriptionKey : "appConfig.enhancement.light.description";
}
