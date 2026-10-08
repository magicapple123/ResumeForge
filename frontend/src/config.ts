/** 前端常量配置：品牌信息与展示类配置集中在此。 */

// 版本号的单源是根 package.json 的 version 字段（CI 有一致性核对把它与后端
// config.py 的 app_version 钉在一起），这里直接读它，前端展示永远不与单源脱节。
import pkg from "../package.json";

export const APP_NAME = "简历通";
export const APP_NAME_EN = "ResumeForge";

/** 应用版本号（页头品牌区展示，如 "0.17.0"）。 */
export const APP_VERSION: string = pkg.version;

/** 公开仓库地址可被部署环境覆盖；默认值用于开源发行版的导航入口。 */
export const GITHUB_REPO =
  import.meta.env.VITE_GITHUB_REPO?.trim() || "https://github.com/magicapple123/ResumeForge";

/** 大模型预设：选择后自动填充 Base URL 与模型名，省去查文档的麻烦 */
export interface LLMPreset {
  label: string;
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
   * `enhancementLevelDescription` 上方的说明。
   */
  api_style?: "openai" | "anthropic";
}

/**
 * 大模型预设：选择后自动填充 Base URL 与模型名。
 *
 * 绝大多数条目是**提供 OpenAI 兼容接口**的服务商；Claude 另有一条走 Messages 原生协议
 * （扩展思考、独立 system 字段），所以预设里带了 `api_style`。
 *
 * 模型名只作为起点：各家迭代很快，**旧模型名会直接 404**（DeepSeek 的 `deepseek-chat`、
 * 月之暗面的 `kimi-k2-0711-preview`、Google 的 `gemini-2.5-flash` 都已按各自公告下线）。
 * 界面上因此提供了「获取可用模型」按钮，按当前账号实际可用的模型覆盖这里的预填值。
 *
 * **最后一次核对：2026-10-01**（依据各家官方文档/下线公告）。下一次核对时重点看：
 * `deepseek-v4-flash`、`kimi-k3`、`doubao-seed-2.1-pro`、`glm-5.3`、`MiniMax-M3`、
 * `gemini-3.6-flash`、`grok-4.3`、`gpt-5.1` 是否还在售。
 *
 * **改这里的模型名时，记得同步后端 `services/llm/thinking.py` 的能力表**：那张表按
 * 「主机 + 模型名」判断该用哪种思考写法，两处脱节过一次（预设用 `qwen-plus`、表里只认
 * `^qwen3`，于是通义用户看到的是一句"未收录"）。
 */
export const LLM_PRESETS: LLMPreset[] = [
  {
    // `deepseek-chat` / `deepseek-reasoner` 已于 2026-07-24 停用（调用返回 404），
    // V4 起把"选模型"和"是否思考"拆开了：模型是 deepseek-v4-flash / -pro，
    // 思考由 thinking 参数控制（且默认开着）。
    label: "DeepSeek（深度求索）",
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  },
  {
    // 地址必须带 /v1：provider 拼的是 `{base_url}/messages`，少了这一段会打到
    // https://api.anthropic.com/messages，那是官方根本不存在的路径。
    label: "Claude（Anthropic 原生协议）",
    provider: "anthropic",
    base_url: "https://api.anthropic.com/v1",
    model: "claude-sonnet-5-5",
    api_style: "anthropic",
  },
  {
    label: "豆包（火山方舟）",
    provider: "doubao",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2.1-pro",
  },
  {
    // kimi-k2 系列已于 2026-05-25 下线（含 kimi-k2-0711-preview），moonshot-v1 与
    // kimi-k2.5 于 2026-08-31 下线；当前主推 kimi-k3（思考常开）。
    label: "Kimi（月之暗面）",
    provider: "kimi",
    base_url: "https://api.moonshot.cn/v1",
    model: "kimi-k3",
  },
  {
    // `qwen-plus` 是官方长期保留的档位别名（指向当前的中端模型），比钉死某个版本稳。
    label: "通义千问（阿里云百炼）",
    provider: "qwen",
    base_url: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
  },
  {
    label: "智谱 GLM",
    provider: "zhipu",
    base_url: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-5.3",
  },
  {
    label: "MiniMax",
    provider: "minimax",
    base_url: "https://api.minimax.chat/v1",
    model: "MiniMax-M3",
  },
  {
    label: "硅基流动 SiliconFlow",
    provider: "siliconflow",
    base_url: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V3",
  },
  {
    label: "OpenRouter（聚合网关）",
    provider: "openrouter",
    base_url: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
  },
  {
    // gpt-4o 这代已陆续下线，推理模型用 reasoning_effort 分档（各代档位不同，
    // 详见后端 services/llm/thinking.py 的能力表）。
    label: "OpenAI",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-5.1",
  },
  {
    // gemini-2.5 系列已于 2026-06-17 停机，当前的 Flash 是 3.6。
    label: "Google Gemini（OpenAI 兼容）",
    provider: "gemini",
    base_url: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-3.6-flash",
  },
  {
    label: "xAI Grok",
    provider: "xai",
    base_url: "https://api.x.ai/v1",
    model: "grok-4.3",
  },
  {
    label: "Groq（推理加速）",
    provider: "groq",
    base_url: "https://api.groq.com/openai/v1",
    model: "llama-3.3-70b-versatile",
  },
  {
    label: "Mistral AI",
    provider: "mistral",
    base_url: "https://api.mistral.ai/v1",
    model: "mistral-large-latest",
  },
  {
    label: "Ollama（本地部署）",
    provider: "ollama",
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
  },
  {
    label: "LM Studio（本地部署）",
    provider: "lmstudio",
    base_url: "http://localhost:1234/v1",
    model: "qwen2.5-7b-instruct",
  },
];

/** 经历美化程度（与后端 GenerateOptions.enhancement_level 对应）。 */
export const RESUME_ENHANCEMENT_LEVELS = [
  {
    value: "light",
    label: "轻度",
    description: "优化措辞与重点，基本保持原有篇幅",
  },
  {
    value: "balanced",
    label: "均衡",
    description: "补足方法、技术细节与成果表达",
  },
  {
    value: "strong",
    label: "深度",
    description: "充分利用已有资料，强化岗位匹配度",
  },
] as const;

/**
 * 通用简历没有岗位可匹配，深度档的说明要换一个说法。
 *
 * 参数类型直接写联合类型，**不要**改成 `import type { EnhancementLevel } from "./types"`：
 * 实测只是加上那一行类型导入，`AssistantPage.test.tsx` 就从稳定通过变成 5/6 失败
 * （报错是空态元素刚找到就被卸载，像时序问题；去掉后 6/6 通过）。类型导入本身不该有
 * 运行时影响，具体机制没查清，所以这里保持不引入 `types/` barrel。
 */
export function enhancementLevelDescription(
  level: "light" | "balanced" | "strong",
  general = false,
): string {
  const matched = RESUME_ENHANCEMENT_LEVELS.find((item) => item.value === level);
  if (!matched) return "";
  if (!general || level !== "strong") return matched.description;
  return "充分利用已有资料，充分展开过程与成果";
}
