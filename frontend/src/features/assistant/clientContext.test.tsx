// SPDX-License-Identifier: Apache-2.0
/** T25 界面上下文：路径 → route/view/selected 的确定性解析；解析不到不许编造。 */
import { describe, expect, it } from "vitest";
import { buildAssistantClientContext } from "./clientContext";

describe("buildAssistantClientContext", () => {
  it("静态路由只送 route + view（不编造 selected）", () => {
    expect(buildAssistantClientContext("/")).toEqual({ route: "/", view: "home" });
    expect(buildAssistantClientContext("/jobs")).toEqual({ route: "/jobs", view: "jobs" });
    expect(buildAssistantClientContext("/claims/drill")).toEqual({
      route: "/claims/drill",
      view: "claims_drill",
    });
    expect(buildAssistantClientContext("/settings")).toEqual({
      route: "/settings",
      view: "settings",
    });
  });

  it("路径里的数字 id 解析成 selected，type 由集合段决定", () => {
    expect(buildAssistantClientContext("/jobs/12")).toEqual({
      route: "/jobs/12",
      view: "jobs",
      selected: { type: "job", id: 12 },
    });
    expect(buildAssistantClientContext("/interview-experiences/7")).toEqual({
      route: "/interview-experiences/7",
      view: "",
      selected: { type: "interview_experience", id: 7 },
    });
    expect(buildAssistantClientContext("/knowledge/4")).toEqual({
      route: "/knowledge/4",
      view: "knowledge",
      selected: { type: "knowledge", id: 4 },
    });
  });

  it("解析不到就不猜：非数字 id / 未知页面 / 尾斜杠", () => {
    expect(buildAssistantClientContext("/jobs/not-an-id")).toEqual({
      route: "/jobs/not-an-id",
      view: "jobs",
    });
    expect(buildAssistantClientContext("/jobs/0")).toEqual({ route: "/jobs/0", view: "jobs" });
    expect(buildAssistantClientContext("/unknown-page")).toEqual({
      route: "/unknown-page",
      view: "",
    });
    // 尾斜杠与不带斜杠是同一页。
    expect(buildAssistantClientContext("/resumes/")).toEqual({
      route: "/resumes",
      view: "resumes",
    });
  });

  it("白名单查询串解析成 selected（明细是抽屉 + ?id=，路径段里没有 id）", () => {
    // 岗位页详情抽屉：`?job_id=N`。
    expect(buildAssistantClientContext("/jobs", "?job_id=12")).toEqual({
      route: "/jobs",
      view: "jobs",
      selected: { type: "job", id: 12 },
    });
    // 简历页详情抽屉：`?resume_id=N`。
    expect(buildAssistantClientContext("/resumes", "?resume_id=7")).toEqual({
      route: "/resumes",
      view: "resumes",
      selected: { type: "resume", id: 7 },
    });
    // search 不带 `?` 也认（URLSearchParams 自己会处理）。
    expect(buildAssistantClientContext("/jobs", "job_id=12")).toEqual({
      route: "/jobs",
      view: "jobs",
      selected: { type: "job", id: 12 },
    });
  });

  it("白名单之外的参数不猜：/resumes?job_id= 是按岗位筛简历，不是选中岗位", () => {
    // 筛选条件不是"当前选中的那一条"：选中项会让助手对着错误的对象说话。
    expect(buildAssistantClientContext("/resumes", "?job_id=12")).toEqual({
      route: "/resumes",
      view: "resumes",
    });
    // 未登记的路由即使带同名参数也不猜。
    expect(buildAssistantClientContext("/settings", "?job_id=12")).toEqual({
      route: "/settings",
      view: "settings",
    });
    // id 只认正整数：0 / 负数 / 非数字 / 空值都不猜。
    expect(buildAssistantClientContext("/jobs", "?job_id=0")).toEqual({
      route: "/jobs",
      view: "jobs",
    });
    expect(buildAssistantClientContext("/jobs", "?job_id=-3")).toEqual({
      route: "/jobs",
      view: "jobs",
    });
    expect(buildAssistantClientContext("/jobs", "?job_id=abc")).toEqual({
      route: "/jobs",
      view: "jobs",
    });
    expect(buildAssistantClientContext("/jobs", "?job_id=")).toEqual({
      route: "/jobs",
      view: "jobs",
    });
  });

  it("路径段里的 id 优先于查询串，查询串绝不进入 route 字段", () => {
    expect(buildAssistantClientContext("/jobs/12", "?job_id=99")).toEqual({
      route: "/jobs/12",
      view: "jobs",
      selected: { type: "job", id: 12 },
    });
    const context = buildAssistantClientContext("/jobs", "?job_id=12&token=secret");
    expect(context?.route).toBe("/jobs");
    expect(context?.route).not.toContain("?");
    expect(context?.route).not.toContain("token");
  });

  it("路径形状不合后端白名单时整个上下文不传（避免把任意文本送进提示）", () => {
    expect(buildAssistantClientContext("")).toBeUndefined();
    expect(buildAssistantClientContext("   ")).toBeUndefined();
    expect(buildAssistantClientContext("/岗位/12")).toBeUndefined();
    expect(buildAssistantClientContext("/jobs page")).toBeUndefined();
    expect(buildAssistantClientContext("/jobs;rm -rf")).toBeUndefined();
    expect(buildAssistantClientContext("/" + "a".repeat(130))).toBeUndefined();
  });
});
