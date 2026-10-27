// SPDX-License-Identifier: Apache-2.0
/** 求职助手 feature 内共享的展示类型。 */

import type { MessageKey } from "../../i18n";

export interface StarterPrompt {
  /** 按钮标签的 key；渲染处再 `t()`，模块级不求值文案。 */
  labelKey: MessageKey;
  /** 点选后直接作为用户消息发给模型：提示词不翻译，整条原样发送。 */
  content: string;
  enableWebSearch?: boolean;
}

export const STARTER_PROMPTS: readonly StarterPrompt[] = [
  {
    labelKey: "assistantUi.starter.matchAnalysis",
    // i18n-ok: 启动提示词原样发给模型，不属于界面文案
    content: "请结合我选择的岗位和资料，分析我的匹配度，并给出准备建议。",
  },
  {
    labelKey: "assistantUi.starter.polishProjects",
    // i18n-ok: 启动提示词原样发给模型，不属于界面文案
    content: "请帮我把我的项目经历改写得更贴合目标岗位，并保留真实事实。",
  },
  {
    labelKey: "assistantUi.starter.interviewRound",
    // i18n-ok: 启动提示词原样发给模型，不属于界面文案
    content: "请根据目标岗位模拟一轮面试，并逐题给出回答思路。",
  },
  {
    labelKey: "assistantUi.starter.findJobs",
    // i18n-ok: 启动提示词原样发给模型，不属于界面文案
    content: "请帮我查找与目标方向相关的招聘信息，并优先给出官网链接。",
    enableWebSearch: true,
  },
] as const;

export type { ConversationFilter } from "../../types";
