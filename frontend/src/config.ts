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

/** 大模型预设：选择后自动填充 Base URL 与模型名 */
export interface LLMPreset {
  /** 预设显示名（语言包 key；渲染处 t(preset.labelKey)）。 */
  labelKey: MessageKey;
  provider: string;
  base_url: string;
  model: string;
  /**
   * 这个预设要走的接口协议，省略即 OpenAI 兼容。
   *
   * 预设是协议的入口：选了 Anthropic 原生那条就必须把 api_style 一起切过去。
   * 只填地址不改协议的话，用户会拿着一整套 Messages 协议的配置去发 Chat Completions
   * 请求，而错误信息只会说"接口返回 404"，看不出是协议选错了。
   *
   * **这里永远不写 "responses"**：那等于让新配置默认走 Responses（D13/D14 明确禁止，
   * Claude / Gemini / 硅基流动 没有 Responses，默认一切就坏）。只有用户主动把协议切到
   * Responses 时，才按 supports_responses 决定是否改写地址。
   *
   * 类型写联合类型而不是 LLMApiStyle：本文件不引入 types/，原因见
   * enhancementLevelDescriptionKey 上方的说明。
   */
  api_style?: "openai" | "anthropic";
  /**
   * 该服务商是否提供 Responses 协议（2026-11-09 核对）。
   *
   * 只影响"用户主动切到 Responses 时要不要换地址"，**不改变新建配置的默认协议**。
   * 未核对的服务商一律不标（宁可不动地址，也不要猜）。
   */
  supports_responses?: boolean;
  /**
   * Responses 专用地址（只有与 chat 地址不同才填）。
   * 未填 = 在 base_url 后追加 /responses，见 presetResponsesBaseUrl。
   */
  responses_base_url?: string;
  /**
   * 该服务商是否有 Anthropic Messages 原生协议入口（2026-11-09 核对）。
   *
   * 与 supports_responses 同一口径：只影响"用户主动把协议切到 Anthropic 时要不要换
   * 地址"，**不改变新建配置的默认协议**。未核对的服务商一律不标。
   */
  supports_anthropic?: boolean;
  /**
   * Anthropic Messages 专用地址：**SDK 语义的 base**，即 `{它} + /messages` 就是真实端点。
   *
   * 只有与 chat 地址不同才填；未填 = 在 `base_url` 后追加 `/messages`（见
   * `presetAnthropicBaseUrl`）。本应用 provider 拼的是 `{base_url}/messages`，所以凡官方
   * 的 ANTHROPIC_BASE_URL 不带 `/v1` 的，这里必须补到 `/v1`——例如 DeepSeek 的真实端点
   * 是 `/anthropic/v1/messages`，本字段就填 `https://api.deepseek.com/anthropic/v1`。
   *
   * 不靠"在 chat 地址后追加 /anthropic"这类推断：各家路径前缀形状不同（有的在 chat
   * 路径下、有的是根域名、有的带 `/api`），猜出来的地址只会让用户看到一个 404。
   */
  anthropic_base_url?: string;
}

/**
 * 大模型预设：选择后自动填充 Base URL 与模型名。
 *
 * 绝大多数条目是**提供 OpenAI 兼容接口**的服务商；Claude 另有一条走 Messages 原生协议
 * （扩展思考、独立 system 字段），所以预设里带了 api_style。
 *
 * 模型名只作为起点：各家迭代很快，旧名称可能下线，也可能作为兼容别名继续映射。
 * 界面上因此提供了「获取可用模型」按钮，按当前账号实际可用的模型覆盖这里的预填值。
 *
 * **最后一次核对：2026-11-09**（逐家对官方文档/控制台示例核对，产品同学复核）。
 * 本次改动：豆包模型 ID 改成文档里的连字符写法、通义保持 qwen-plus 档位别名、OpenAI 升到
 * gpt-6-astra、Mistral 升到 mistral-large-4、硅基流动升到 DeepSeek-V4-Pro-0813、混元改用
 * TokenHub 可用的 hy3、星火整体迁到新 MaaS 平台（旧 spark-api-open 是上一代）、
 * MiniMax / 千帆 / 星火 / 阶跃补齐 Responses 支持，并给 13 家补上 Anthropic 入口声明。
 * 2026-11-09 复核：修正 Qwen/StepFun 的 Responses、xAI 的 Anthropic 判定，重排为热门优先，
 * Groq/Perplexity 换模型。
 *
 * **改这里的模型名时，记得同步两处**：
 * 1. 设置页的「各服务商协议支持」矩阵（features/settings/LLMProtocolSupportMatrix.tsx）；
 * 2. 后端 services/llm/thinking.py 的能力表（它按主机 + 模型名判断思考写法）。
 */
export const LLM_PRESETS: LLMPreset[] = [
  {
    // 最后核对：2026-11-09。官方文档：Chat Completions 在 api.deepseek.com；Responses 同址
    // 打 /responses；Anthropic 兼容入口在独立前缀下，真实端点是 /anthropic/v1/messages。
    labelKey: "appConfig.preset.deepseek",
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-flash",
    supports_responses: true,
    supports_anthropic: true,
    anthropic_base_url: "https://api.deepseek.com/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。qwen-plus 是官方长期保留的档位别名（指向当前中端模型），
    // 比钉死某个版本稳。Anthropic 兼容入口在 /apps/anthropic 下。
    labelKey: "appConfig.preset.qwen",
    provider: "qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    supports_responses: true,
    supports_anthropic: true,
    anthropic_base_url: "https://dashscope.aliyuncs.com/apps/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。官方文档的模型 ID 是连字符 + 日期写法
    // （doubao-seed-2-1-pro-260915），点号写法只是别名，以文档写法为准。
    // **官方没有 Anthropic Messages 入口**（清单 §11.4 缺陷 7）：不声明 supports_anthropic，
    // 否则切协议时会把地址改写成 /api/compatible/v1，用户拿到的必然 404。
    labelKey: "appConfig.preset.doubao",
    provider: "doubao",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-1-pro-260915",
    supports_responses: true,
  },
  {
    // 最后核对：2026-11-09。智谱两条专用地址都与 chat 不同：Responses 换到 /api/v1；
    // Anthropic 兼容入口在 /api/anthropic 下（不是在 paas/v4 后追加）。
    labelKey: "appConfig.preset.zhipu",
    provider: "zhipu",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
    supports_responses: true,
    responses_base_url: "https://open.bigmodel.cn/api/v1",
    supports_anthropic: true,
    anthropic_base_url: "https://open.bigmodel.cn/api/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。官方只写 chat + Anthropic 兼容，**没有 Responses**。
    // Anthropic 入口与 chat 同址（根域名 + /v1/messages），所以不填专用地址。
    labelKey: "appConfig.preset.siliconflow",
    provider: "siliconflow",
    base_url: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V4-Pro-0813",
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。kimi-k2 系列已于 2026-05-25 下线，moonshot-v1 与 kimi-k2.5
    // 于 2026-08-31 下线；当前主推 kimi-k3（思考常开）。Anthropic 兼容入口在 /anthropic 下。
    labelKey: "appConfig.preset.kimi",
    provider: "kimi",
    base_url: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
    supports_responses: true,
    supports_anthropic: true,
    anthropic_base_url: "https://api.moonshot.cn/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。TokenHub 当前可用的是 hy3 / hy4（turbos-latest 在 TokenHub
    // 不可用）；base 自带 /v1，所以 Responses 与 Anthropic 都与 chat 同址。
    // 境外入口：https://tokenhub-intl.tencentmaas.com/v1。
    labelKey: "llmProtocol.preset.hunyuan",
    provider: "hunyuan",
    base_url: "https://tokenhub.tencentmaas.com/v1",
    model: "hy3",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。gpt-4o 这代已陆续下线，当前旗舰是 gpt-6-astra；推理模型用
    // reasoning_effort 分档（各代档位不同，详见后端 services/llm/thinking.py 的能力表）。
    // OpenAI 没有 Anthropic 入口。
    labelKey: "appConfig.preset.openai",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-6-astra",
    supports_responses: true,
  },
  {
    // 最后核对：2026-11-09。地址必须带 /v1：provider 拼的是 base_url + /messages。
    // Claude 走 Anthropic 原生协议；Claude 4.7 及以后改用自适应思考（effort），不再发预算。
    // Responses 不支持（走原生 Messages 即可）。
    labelKey: "appConfig.preset.anthropic",
    provider: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    api_style: "anthropic",
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。gemini-2.5 系列已于 2026-06-17 停机，当前 Flash 是 3.8。
    // OpenAI 兼容层仍为 beta，且不止 chat（embeddings / images / batches 等也走同一层）；
    // 没有 Responses 入口（走原生 SDK 才有）。
    labelKey: "appConfig.preset.gemini",
    provider: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.8-flash",
  },
  {
    // 最后核对：2026-11-09。百度千帆（文心）chat 走 /v2；Responses 与 Anthropic 入口
    // 官方都已提供，Anthropic 在 /anthropic 下（拼 /v1/messages）。
    labelKey: "llmProtocol.preset.qianfan",
    provider: "qianfan",
    base_url: "https://qianfan.baidubce.com/v2",
    model: "ernie-4.5-turbo-128k",
    supports_responses: true,
    supports_anthropic: true,
    anthropic_base_url: "https://qianfan.baidubce.com/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。**已迁到新 MaaS 平台**：chat 打 /v2（旧的 spark-api-open
    // 域名是上一代，不再作为默认）。Responses 换到同主机的 /v1；Anthropic 在 /anthropic 下。
    labelKey: "llmProtocol.preset.spark",
    provider: "spark",
    base_url: "https://maas-api.cn-huabei-1.xf-yun.com/v2",
    model: "spark-x2.6",
    supports_responses: true,
    responses_base_url: "https://maas-api.cn-huabei-1.xf-yun.com/v1",
    supports_anthropic: true,
    anthropic_base_url: "https://maas-api.cn-huabei-1.xf-yun.com/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。官方文档（platform.minimax.io）的 OpenAI 兼容入口是
    // https://api.minimax.io/v1，Anthropic 入口是 https://api.minimax.io/anthropic
    // （拼 /v1/messages）；旧 api.minimax.chat 已不在文档里。国内平台是
    // https://api.minimaxi.com（**Key 与域名绑定**，换域名会报 invalid api key），
    // 国内用户可手动改回。预设跟随官方文档域名。
    labelKey: "appConfig.preset.minimax",
    provider: "minimax",
    base_url: "https://api.minimax.io/v1",
    model: "MiniMax-M3.1-Flash",
    supports_responses: true,
    supports_anthropic: true,
    anthropic_base_url: "https://api.minimax.io/anthropic/v1",
  },
  {
    // 最后核对：2026-11-09。聚合网关：Responses 在现有地址后追加 /responses；
    // Anthropic 入口与 chat 同址（/v1/messages）。
    labelKey: "appConfig.preset.openrouter",
    provider: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。Anthropic 走同一 Base URL 的 /v1/messages；Step Plan 是另一条
    // /step_plan 通道（见支持矩阵的说明），不作为默认。
    labelKey: "llmProtocol.preset.stepfun",
    provider: "stepfun",
    base_url: "https://api.stepfun.com/v1",
    model: "step-5-preview",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。本机端点；Responses 需 Ollama 0.13.3+，Anthropic 入口需
    // 0.14.0+，两者都与 chat 同址（/v1/messages）。
    labelKey: "appConfig.preset.ollama",
    provider: "ollama",
    base_url: "http://localhost:11434/v1",
    model: "gpt-oss:20b",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。xAI 文档当前示例是 grok-4.7；Responses 按官方兼容层补
    // /responses。Anthropic：官方已**废弃** Anthropic 兼容入口（清单 §11.5-E），所以不声明
    // supports_anthropic、矩阵标「不支持」；需要 Anthropic 形态请走 Responses 或第三方网关。
    labelKey: "appConfig.preset.xai",
    provider: "xai",
    base_url: "https://api.x.ai/v1",
    model: "grok-4.7",
    supports_responses: true,
  },
  {
    // 最后核对：2026-11-09。当前旗舰 mistral-large-4；Responses 仍是 Public Preview（矩阵
    // 里有标注），没有 Anthropic 入口。
    labelKey: "appConfig.preset.mistral",
    provider: "mistral",
    base_url: "https://api.mistral.ai/v1",
    model: "mistral-large-4",
    supports_responses: true,
  },
  {
    // 最后核对：2026-11-09。本机端点；Responses 需 LM Studio 0.3.29+，Anthropic 入口需
    // 0.4.1+，两者都与 chat 同址（/v1/messages）。
    labelKey: "appConfig.preset.lmstudio",
    provider: "lmstudio",
    base_url: "http://localhost:1234/v1",
    model: "qwen2.5-7b-instruct",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。Groq 走 OpenAI 兼容 chat；Responses 仍是 Beta（矩阵里有标注），
    // 没有 Anthropic 入口。模型：llama-3.3-70b-versatile 已于 2026-08-16 对 free/developer 层
    // 关停（企业合约不受影响），官方推荐 openai/gpt-oss-120b，故按推荐改用它。
    labelKey: "appConfig.preset.groq",
    provider: "groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "openai/gpt-oss-120b",
    supports_responses: true,
  },
  {
    // 最后核对：2026-11-09。官方 Responses 文档：POST /v1/responses（现有地址后追加）；
    // Anthropic 入口同址（/v1/messages），但只覆盖部分 serverless 模型（矩阵里有标注）。
    labelKey: "llmProtocol.preset.together",
    provider: "together",
    base_url: "https://api.together.ai/v1",
    model: "zai-org/GLM-5.3",
    supports_responses: true,
    supports_anthropic: true,
  },
  {
    // 最后核对：2026-11-09。对话补全已迁 Agent API（Sonar Chat Completions 于 2026-09-27
    // 停止），/v1/responses 可用；Anthropic 只有 Orchestrator（原 Router）private preview，
    // 需申请且入口在 /orchestrator/v1 下，故不声明。模型：Agent API 官方模型表只有
    // perplexity/sonar，旧 sonar-pro 现在对应 preset/effort=low。
    labelKey: "llmProtocol.preset.perplexity",
    provider: "perplexity",
    base_url: "https://api.perplexity.ai/v1",
    model: "perplexity/sonar",
    supports_responses: true,
  },
];

/** 该预设切到 Responses 时使用的地址；null = 未声明支持（地址不动，避免瞎猜）。 */
export function presetResponsesBaseUrl(preset: LLMPreset): string | null {
  if (!preset.supports_responses) return null;
  if (preset.responses_base_url) return preset.responses_base_url;
  return preset.base_url.replace(/\/+$/, "") + "/responses";
}

/**
 * 该预设切到 Anthropic 原生协议时使用的地址；null = 未声明（地址不动，避免瞎猜）。
 *
 * 语义与 `presetResponsesBaseUrl` 对齐：未填 `anthropic_base_url` 就在 base_url 后追加
 * `/messages`（provider 拼的也正是 `{base_url}/messages`，已带 `/messages` 的地址不会
 * 被重复追加，见后端 anthropic.py 的同名判定）。所以 `anthropic_base_url` 只在两种情况下
 * 需要填：入口与 chat 不同址，或官方 base 不带 `/v1` 而端点带。
 */
export function presetAnthropicBaseUrl(preset: LLMPreset): string | null {
  if (!preset.supports_anthropic) return null;
  if (preset.anthropic_base_url) return preset.anthropic_base_url;
  return preset.base_url.replace(/\/+$/, "") + "/messages";
}

/** 从 Responses / Anthropic 切回其它协议时要还原的 chat 地址（预设的常规 Base URL）。 */
export function presetChatBaseUrl(preset: LLMPreset): string {
  return preset.base_url;
}

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
