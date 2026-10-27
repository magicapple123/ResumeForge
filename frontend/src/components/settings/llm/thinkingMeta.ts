// SPDX-License-Identifier: Apache-2.0
/**
 * 思考模式相关的共享元数据。
 * （档位文案、兜底档位、说明与思考参数形态选项。）
 *
 * 表里只存语言包 key：模块作用域**禁止**求值 `t()`（切语言后不会重新求值），
 * 渲染处再 `t(item.labelKey)`。
 */
import type { MessageKey } from "../../../i18n";

/** 档位在语言包里的显示名 key；表里出现的其它取值（各家自定义的）原样显示。 */
export const EFFORT_LABEL_KEYS: Record<string, MessageKey> = {
  minimal: "appConfig.effort.minimal",
  low: "appConfig.effort.low",
  medium: "appConfig.effort.medium",
  high: "appConfig.effort.high",
};

/**
 * 检测之前先给一份通用档位。
 *
 * 真正的选项来自后端的「检测思考支持」（各家划分不同），这份兜底只是让控件在还没检测时
 * 可用；检测结果一到就被替换。
 */
export const FALLBACK_EFFORTS = ["low", "medium", "high"];

/** 「思考强度」的说明：两个分支（下拉 / 自定义输入框）共用同一份文案。 */
export const EFFORT_TOOLTIP_KEY: MessageKey = "appConfig.effort.tooltip";

/** 思考参数形态的下拉选项：`labelKey` 在渲染处 `t()`。 */
export const THINKING_STYLE_OPTIONS: { value: string; labelKey: MessageKey }[] = [
  { value: "auto", labelKey: "appConfig.thinkingStyle.auto" },
  { value: "reasoning_effort", labelKey: "appConfig.thinkingStyle.reasoningEffort" },
  { value: "thinking_object", labelKey: "appConfig.thinkingStyle.thinkingObject" },
  { value: "enable_thinking", labelKey: "appConfig.thinkingStyle.enableThinking" },
  { value: "budget", labelKey: "appConfig.thinkingStyle.budget" },
];
