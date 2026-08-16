/** 前端常量配置：品牌信息与展示类配置集中在此。 */

export const APP_NAME = "简历通";
export const APP_NAME_EN = "ResumeForge";

/** 开源仓库地址（发布前请替换为你自己的仓库） */
export const GITHUB_REPO = "https://github.com/your-name/ResumeForge";

/** 大模型预设：选择后自动填充 Base URL 与模型名，省去查文档的麻烦 */
export interface LLMPreset {
  label: string;
  provider: string;
  base_url: string;
  model: string;
}

export const LLM_PRESETS: LLMPreset[] = [
  {
    label: "DeepSeek（深度求索）",
    provider: "deepseek",
    base_url: "https://api.deepseek.com",
    model: "deepseek-chat",
  },
  {
    label: "豆包（火山方舟）",
    provider: "doubao",
    base_url: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-1-6-250615",
  },
  {
    label: "Kimi（月之暗面）",
    provider: "kimi",
    base_url: "https://api.moonshot.cn/v1",
    model: "kimi-k2-0711-preview",
  },
  {
    label: "OpenAI",
    provider: "openai",
    base_url: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
  {
    label: "Ollama（本地部署）",
    provider: "ollama",
    base_url: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
  },
];

/** 简历定制风格（与后端 GenerateOptions.tone 对应） */
export const RESUME_TONES = [
  { value: "standard", label: "综合均衡", hint: "教育/实习/项目/技能均衡呈现，适合大多数岗位" },
  { value: "tech", label: "技术突出", hint: "强化项目技术深度与工程能力，弱化无关经历" },
  { value: "academic", label: "科研算法", hint: "突出科研竞赛与算法能力，适合 AI 算法岗" },
] as const;
