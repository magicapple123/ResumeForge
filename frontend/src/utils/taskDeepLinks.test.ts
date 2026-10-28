// SPDX-License-Identifier: Apache-2.0
/**
 * 深链映射的纯函数单测。
 *
 * 只断言"输入 → 地址"这一件事：这类函数一旦偷偷读了 `window.location` 或 router 状态，
 * 通知点进去的落点就会随当前页面漂移——那正是要防的事，所以测试里也不给它挂任何环境。
 */
import { describe, expect, it } from "vitest";
import {
  jobDeepLink,
  jobMatchHistoryDeepLink,
  resumeDeepLink,
  taskDeepLink,
} from "./taskDeepLinks";

describe("taskDeepLinks", () => {
  it("maps a resume id to the resume center deep link", () => {
    expect(resumeDeepLink(42)).toBe("/resumes?resume_id=42");
    // 后端 id 从 query / localStorage 回来时可能是字符串，两边都要认。
    expect(resumeDeepLink("42")).toBe("/resumes?resume_id=42");
  });

  it("maps a job id to the job square deep link", () => {
    expect(jobDeepLink(7)).toBe("/jobs?job_id=7");
    expect(jobDeepLink("7")).toBe("/jobs?job_id=7");
  });

  it("keeps the batch match history link stable and id-less", () => {
    expect(jobMatchHistoryDeepLink()).toBe("/jobs?match_batch=history");
    expect(taskDeepLink("job_match_batch")).toBe("/jobs?match_batch=history");
    // 传了 id 也不能变成别的地址：记录视图本身不接受 id。
    expect(taskDeepLink("job_match_batch", 9)).toBe("/jobs?match_batch=history");
  });

  it("returns null when the result id is missing", () => {
    expect(resumeDeepLink(null)).toBeNull();
    expect(resumeDeepLink(undefined)).toBeNull();
    expect(resumeDeepLink("")).toBeNull();
    expect(jobDeepLink(null)).toBeNull();
    expect(taskDeepLink("resume")).toBeNull();
    expect(taskDeepLink("job", null)).toBeNull();
  });

  it("rejects ids that are not positive integers", () => {
    // 这些值被拼进地址会变成两个参数（等于允许往路由里注入 query）。
    expect(resumeDeepLink(0)).toBeNull();
    expect(resumeDeepLink(-3)).toBeNull();
    expect(resumeDeepLink(3.5)).toBeNull();
    expect(jobDeepLink("12&analysis=1")).toBeNull();
    expect(jobDeepLink("  ")).toBeNull();
  });

  it("maps page-level task kinds to their landing page", () => {
    expect(taskDeepLink("assistant")).toBe("/assistant");
    expect(taskDeepLink("interview")).toBe("/interview");
    expect(taskDeepLink("webform")).toBe("/webform");
    expect(taskDeepLink("drill")).toBe("/claims/drill");
    expect(taskDeepLink("claim")).toBe("/claims");
  });

  it("returns null for an unknown task kind", () => {
    // 上游新增了 kind 但这里还没映射：宁可不跳，也不要猜一个默认页。
    expect(taskDeepLink("unknown-kind" as never)).toBeNull();
  });
});
