// SPDX-License-Identifier: Apache-2.0
/**
 * 用量账本「按任务」视图的任务名 → 文案（R40）。
 *
 * 后端账本里存的是协议码（`interview` / `resume_revise` / `settings_probe`…），界面不直接
 * 显示码——与 `resume-preflight/capabilities.ts` 的 `NOTE_MESSAGE_KEY` 同一模式：码 →
 * i18n key 的映射表放在前端，中文/英文各自查词条，英文界面就不会漏出英文协议码，
 * 中文界面也不会漏出 `unknown` 这类原值。
 *
 * 守卫：`backend/tests/test_usage_task_labels.py` 读取本文件静态断言「账本的每个
 * TASK_* 常量在这张表里都有条目」；`usageTaskLabels.test.ts` 断言每个词条在 zh/en
 * 两套 message 里都存在。新增任务类型时三处（账本常量、这张表、两套词条）一起改。
 */
import { pt, type ProvenanceMessageKey } from "./i18n";

export const TASK_TYPE_MESSAGE_KEY = {
  resume_generate: "provenance.usage.task.resumeGenerate",
  resume_revise: "provenance.usage.task.resumeRevise",
  resume_suggestions: "provenance.usage.task.resumeSuggestions",
  resume_translate: "provenance.usage.task.resumeTranslate",
  resume_optimize: "provenance.usage.task.resumeOptimize",
  assistant: "provenance.usage.task.assistant",
  // 未知任务沿用「未知」这个共用词条，不另写一份。
  unknown: "provenance.usage.unknown",
  resume_writing: "provenance.usage.task.resumeWriting",
  resume_risk: "provenance.usage.task.resumeRisk",
  resume_scenario: "provenance.usage.task.resumeScenario",
  job_parse: "provenance.usage.task.jobParse",
  job_analysis: "provenance.usage.task.jobAnalysis",
  job_match: "provenance.usage.task.jobMatch",
  interview: "provenance.usage.task.interview",
  webform: "provenance.usage.task.webform",
  claims: "provenance.usage.task.claims",
  tracker: "provenance.usage.task.tracker",
  profile_parse: "provenance.usage.task.profileParse",
  drill: "provenance.usage.task.drill",
  apply: "provenance.usage.task.apply",
  resume_template: "provenance.usage.task.resumeTemplate",
  settings_probe: "provenance.usage.task.settingsProbe",
} as const satisfies Record<string, ProvenanceMessageKey>;

/** 任务码 → 界面文案；未登记的码原样返回（新后端配旧前端时不编造解释）。 */
export function usageTaskLabel(task: string): string {
  const key = TASK_TYPE_MESSAGE_KEY[task as keyof typeof TASK_TYPE_MESSAGE_KEY];
  return key ? pt(key) : task;
}
