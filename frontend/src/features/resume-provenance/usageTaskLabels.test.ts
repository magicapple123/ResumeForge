// SPDX-License-Identifier: Apache-2.0
/**
 * R40：用量任务类型 → 文案映射的硬判据（与 resume-preflight/capabilityNotes.test.ts 同法）。
 *
 * 后端账本按协议码分组（`interview` / `resume_revise` / `settings_probe`…），界面必须显示
 * 标签而不是码。这里同时校验：
 * 1. 后端每个任务码都有前端映射（与 backend/tests/test_usage_task_labels.py 双向把守）；
 * 2. 每个词条在 zh-CN / en-US 两套 message 里都存在且非空；
 * 3. 英文词条确实是英文（不是从中文复制过来的）；
 * 4. 未登记的码原样透传（不编造解释）。
 */
import { describe, expect, it } from "vitest";
import enUS from "../../i18n/messages/en-US";
import zhCN from "../../i18n/messages/zh-CN";
import { TASK_TYPE_MESSAGE_KEY, usageTaskLabel } from "./usageTaskLabels";

// 与后端 `services/llm/usage_tasks.py` 的 TASK_* 常量逐字一致（后端有同名守卫，两边一起改）。
const BACKEND_TASKS = [
  "resume_generate",
  "resume_revise",
  "resume_suggestions",
  "resume_translate",
  "resume_optimize",
  "assistant",
  "unknown",
  "resume_writing",
  "resume_risk",
  "resume_scenario",
  "job_parse",
  "job_analysis",
  "job_match",
  "interview",
  "webform",
  "claims",
  "tracker",
  "profile_parse",
  "drill",
  "apply",
  "resume_template",
  "settings_probe",
] as const;

const zh = zhCN as Record<string, string>;
const en = enUS as Record<string, string>;

describe("用量任务类型 → 文案", () => {
  it("后端每个任务码都有前端映射", () => {
    const missing = BACKEND_TASKS.filter(
      (task) => !TASK_TYPE_MESSAGE_KEY[task as keyof typeof TASK_TYPE_MESSAGE_KEY],
    );
    expect(missing).toEqual([]);
  });

  it("每个词条在中英两套 message 里都存在且非空", () => {
    for (const task of BACKEND_TASKS) {
      const key = TASK_TYPE_MESSAGE_KEY[task as keyof typeof TASK_TYPE_MESSAGE_KEY];
      expect(zh[key], `zh-CN 缺少 ${key}`).toBeTruthy();
      expect(en[key], `en-US 缺少 ${key}`).toBeTruthy();
    }
  });

  it("英文文案确实是英文（不是从中文复制过来的）", () => {
    for (const task of BACKEND_TASKS) {
      const key = TASK_TYPE_MESSAGE_KEY[task as keyof typeof TASK_TYPE_MESSAGE_KEY];
      expect(zh[key]).not.toBe(en[key]);
      expect(/[\u4e00-\u9fff]/.test(zh[key])).toBe(true);
      expect(/[\u4e00-\u9fff]/.test(en[key])).toBe(false);
    }
  });

  it("usageTaskLabel：已知码出文案，未登记的码原样透传", () => {
    expect(usageTaskLabel("interview")).toBe(zh[TASK_TYPE_MESSAGE_KEY.interview]);
    expect(usageTaskLabel("settings_probe")).toBe(zh[TASK_TYPE_MESSAGE_KEY.settings_probe]);
    expect(usageTaskLabel("some_future_task")).toBe("some_future_task");
  });
});
