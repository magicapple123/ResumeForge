// SPDX-License-Identifier: Apache-2.0
/**
 * 求职助手域的「协议值 → 语言包 key」映射。
 *
 * 协议值（`""` / `none` / `low` / `medium` / `high`）是发给模型服务的取值，永远不翻；
 * 其中文显示名原本写在 `types/assistant.ts` 的 `REASONING_EFFORT_OPTIONS[].label` 里，
 * 直接上屏在英文界面下会露中文。本模块只做「取值 → key」的对应，渲染处再 `t()`——
 * types 一个字没改，协议值与档位清单仍由它单一提供。
 *
 * 模块作用域**禁止**求值 `t()`：模块级常量不会随语言切换重新求值，界面会停在旧语言。
 */
import type { MessageKey } from "../../i18n";

/**
 * 思考强度的显示名。
 *
 * `ReasoningEffort` 只是 `string`（各家档位词汇不同，见 `isValidReasoningEffort`），
 * 所以这里不能写成穷尽的联合映射；不在表里的自定义档位按原值上屏，不猜中文。
 */
export const REASONING_EFFORT_LABEL_KEYS: Record<string, MessageKey> = {
  /** 空串 = 不发送该参数，沿用服务商默认。 */
  "": "enumsAssistant.reasoningEffort.default",
  /** 显式关闭思考（与「关闭窗口」不是一个意思）。 */
  none: "enumsAssistant.reasoningEffort.off",
  low: "enumsAssistant.reasoningEffort.low",
  medium: "enumsAssistant.reasoningEffort.medium",
  high: "enumsAssistant.reasoningEffort.high",
};
