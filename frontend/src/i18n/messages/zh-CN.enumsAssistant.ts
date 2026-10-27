// SPDX-License-Identifier: Apache-2.0
/**
 * 枚举显示名：求职助手（`types/assistant.ts` 里的协议值）。
 *
 * 键里的 `default` / `off` / `low` / `medium` / `high` 依次对应思考强度的协议值
 * `""` / `none` / `low` / `medium` / `high`。协议值本身不翻、也不进语言包；
 * 这里只放「给人看的那一面」，映射表在 `i18n/enum/assistant.ts`，渲染处 `t()`。
 *
 * 值必须与 `REASONING_EFFORT_OPTIONS[].label` **逐字一致**：本批只是把显示名搬进语言包，
 * 中文界面的渲染结果不变（现有中文断言因此不用改）。
 *
 * 颜色 / 图标 / 档位顺序不在这里——那是协议层的属性，留在 `types/assistant.ts`。
 */
const enumsAssistant = {
  /** 不指定档位，沿用服务商默认。 */
  "enumsAssistant.reasoningEffort.default": "默认",
  /** 显式关闭思考。 */
  "enumsAssistant.reasoningEffort.off": "关闭",
  "enumsAssistant.reasoningEffort.low": "低",
  "enumsAssistant.reasoningEffort.medium": "中",
  "enumsAssistant.reasoningEffort.high": "高",
} as const;

export default enumsAssistant;
