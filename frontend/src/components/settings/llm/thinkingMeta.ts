/**
 * 思考模式相关的共享元数据。
 * （自 LLMConfigCard 拆出：档位文案、兜底档位、说明与思考参数形态选项。）
 */

/** 档位的中文名；表里出现的其它取值（各家自定义的）原样显示。 */
export const EFFORT_LABELS: Record<string, string> = {
  minimal: "最低",
  low: "低",
  medium: "中",
  high: "高",
};

/**
 * 检测之前先给一份通用档位。
 *
 * 真正的选项来自后端的「检测思考支持」（各家划分不同），这份兜底只是让控件在还没检测时
 * 可用；检测结果一到就被替换。
 */
export const FALLBACK_EFFORTS = ["low", "medium", "high"];

/** 「思考强度」的说明：两个分支（下拉 / 自定义输入框）共用同一份文案。 */
export const EFFORT_TOOLTIP =
  "档位越高通常越慢也越贵。各家的档位划分不同，选项来自「检测思考支持」；也可以选「自定义…」自己填。" +
  "自定义值原样发给 OpenAI 兼容接口；Claude 原生协议下填写数字＝思考预算 tokens，填其他词按默认档处理。" +
  "留空表示不指定档位。";

export const THINKING_STYLE_OPTIONS = [
  { value: "auto", label: "自动（按协议与服务商推断）" },
  { value: "reasoning_effort", label: "reasoning_effort（OpenAI 系）" },
  { value: "thinking_object", label: "thinking 开关（智谱等）" },
  { value: "enable_thinking", label: "enable_thinking（通义 qwen3）" },
  { value: "budget", label: "thinking 预算（Claude 原生）" },
];
