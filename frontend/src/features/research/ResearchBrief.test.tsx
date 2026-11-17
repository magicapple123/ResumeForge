// SPDX-License-Identifier: Apache-2.0
/**
 * 调研简报 v2 的排版约定（T16）。
 *
 * 三类断言：
 * 1. **结论带**：v2 的 `lead` 单独渲染，正文里不再重复「一句话结论」；
 * 2. **来源标注**：`[n] 标题 — 域名`，域名让用户不点开也能判断出处；
 * 3. **上标**：引用是 `<a>`，字号/上标由 CSS 决定（jsdom 不求值，读样式原文断言）。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ResearchBrief } from "../../api/research";
import ResearchBriefPanel from "./ResearchBrief";

declare const process: { cwd(): string };

function brief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    status: "ok",
    reason: "",
    markdown: "## 公司概况\n腾讯主营社交与游戏[1]。",
    lead: "Apply, but close the distributed-systems gap first.",
    sources: [{ number: 1, title: "Tencent", url: "https://www.tencent.com/about" }],
    deep: true,
    tool_calls: 2,
    query_terms: 2,
    billed_searches: 2,
    fetched_pages: 1,
    tool_call_budget: 6,
    tool_budget_exceeded: false,
    elapsed_ms: 4200,
    ...overrides,
  };
}

describe("ResearchBriefPanel（T16）", () => {
  it("结论带单独渲染，正文不再出现「一句话结论」", () => {
    const { container } = render(<ResearchBriefPanel brief={brief()} />);
    const lead = container.querySelector(".rf-research-brief-lead");
    expect(lead?.textContent).toBe("Apply, but close the distributed-systems gap first.");
    expect(container.textContent).not.toContain("一句话结论");
  });

  it("旧简报没有 lead 时不渲染空结论带", () => {
    const { container } = render(<ResearchBriefPanel brief={brief({ lead: "" })} />);
    expect(container.querySelector(".rf-research-brief-lead")).toBeNull();
  });

  it("来源行带标题与域名", () => {
    render(<ResearchBriefPanel brief={brief()} />);
    expect(screen.getByText(/Tencent/)).toBeTruthy();
    // 域名去掉 www. 前缀：列表要的是"哪个站"，不是主机名全称。
    expect(screen.getAllByText(/tencent\.com/)[0]).toBeTruthy();
  });

  it("顶部元信息：深度 + 来源数 + 耗时", () => {
    const { container } = render(<ResearchBriefPanel brief={brief()} />);
    const meta = container.querySelector(".rf-research-brief-meta")?.textContent ?? "";
    expect(meta).toContain("1");
    expect(meta).toContain("4.2");
  });

  it("CSS：引用是上标 0.72em 且不撑行盒", () => {
    const css = readFileSync(
      [process.cwd(), "src", "features", "research", "research.css"].join("/"),
      "utf8",
    );
    const block = /\.rf-research-citation\s*\{([^}]*)\}/u.exec(css)?.[1] ?? "";
    expect(block).toContain("font-size: 0.72em");
    expect(block).toContain("vertical-align: super");
    // 上标会撑高行盒；line-height:0 是 1.85 行距不被顶开的前提。
    expect(block).toContain("line-height: 0");
  });

  it("CSS：正文栏宽 46em、行距 1.85", () => {
    const css = readFileSync(
      [process.cwd(), "src", "features", "research", "research.css"].join("/"),
      "utf8",
    );
    const blocks = [...css.matchAll(/\.rf-research-brief\s*\{([^}]*)\}/gu)].map((m) => m[1]);
    const merged = blocks.join("\n");
    expect(merged).toContain("max-width: 46em");
    expect(merged).toContain("line-height: 1.85");
  });
});
