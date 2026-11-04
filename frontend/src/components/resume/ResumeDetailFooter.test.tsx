// SPDX-License-Identifier: Apache-2.0
/**
 * 简历预览底栏的排版口径（2026-11 问题 3）。
 *
 * 这些性质在 jsdom 里量不出来（不求值网格、不求值 flex 换行），所以分两层钉：
 * - **样式层**：直接读 `resume-panels.css` 原文断言 `auto-fit` 与三处 gap 的收敛结果；
 * - **结构层**：按钮的层级（只有「导出」是 primary）与 DOM 顺序（= Tab 顺序）。
 */
import { cleanup, render, screen } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cssDeclarations, LAYOUT } from "../../test/resumeDetailPreviewHarness";
import ResumeDetailFooter from "./ResumeDetailFooter";

declare const process: { cwd(): string };

afterEach(cleanup);

function renderFooter(overrides: { showRevise?: boolean; jobId?: number | null } = {}) {
  return render(
    <ResumeDetailFooter
      resumeId={42}
      layout={LAYOUT}
      pdfDirectAvailable
      showRevise={overrides.showRevise ?? true}
      suggestionsGenerated={false}
      // `jobId` 的 null 是"没有关联岗位"，不能用 `??` 兜底（null 也是 nullish）。
      jobId={overrides.jobId === undefined ? 7 : overrides.jobId}
      onOpenZoom={vi.fn()}
      onOpenRevise={vi.fn()}
      onOpenSuggestions={vi.fn()}
      onOpenJob={vi.fn()}
      onOpenAssistant={vi.fn()}
      onOpenQuality={vi.fn()}
      onOpenSharePackage={vi.fn()}
      onOpenExportOptions={vi.fn()}
    />,
  );
}

function readPanelsCss(): string {
  return readFileSync([process.cwd(), "src", "styles", "resume-panels.css"].join("/"), "utf8");
}

describe("底栏样式：空列折叠与间距收敛（问题 3）", () => {
  it("主网格用 auto-fit：装不满的行不再保留空轨道", () => {
    const rule = cssDeclarations(readPanelsCss(), ".resume-detail-footer");
    // `auto-fill` 会为 4 个按钮 / 5 列的场景保留第 5 个空列，auto-fit 才折叠。
    expect(rule).toContain("repeat(auto-fit, minmax(150px, 1fr))");
    expect(rule).not.toContain("auto-fill");
  });

  it("三处 gap 收敛为「组内 8px / 组间 12px」", () => {
    const css = readPanelsCss();
    // 主网格：同一行按钮之间 8px，换行的另一组之间 12px。
    expect(cssDeclarations(css, ".resume-detail-footer")).toContain("gap: 12px 8px");
    // 尾行同理。
    expect(cssDeclarations(css, ".resume-detail-footer-tail")).toContain("gap: 12px 8px");
    // 导出组只按内容排、没有"组间"：统一到 8px。
    const exportRule = cssDeclarations(css, ".resume-detail-footer-export");
    expect(exportRule).toContain("gap: 8px");
    expect(exportRule).not.toContain("8px 12px");
  });

  it("换行阈值注释跟着 gap 重算过（8px 间距 → 615px / 555px）", () => {
    // 注释里的数字是下一次维护的唯一依据，改了 gap 却不改它就会按错的数字调。
    const css = readPanelsCss();
    expect(css).toContain("615px");
    expect(css).toContain("555px");
  });
});

describe("底栏层级：只有「导出」是实心主按钮（问题 3）", () => {
  it("整条底栏只有一个 primary，且就是「导出」", () => {
    const { container } = renderFooter();
    const primaries = [...container.querySelectorAll(".ant-btn-primary")];
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toContain("导出");
  });

  it("有待确认改动时：确认动作与导出并排，primary 仍然只有导出", () => {
    const { container } = render(
      <ResumeDetailFooter
        resumeId={42}
        layout={LAYOUT}
        pdfDirectAvailable
        extraActions={<button type="button">保存修改</button>}
        showRevise={false}
        suggestionsGenerated={false}
        jobId={7}
        onOpenZoom={vi.fn()}
        onOpenRevise={vi.fn()}
        onOpenSuggestions={vi.fn()}
        onOpenJob={vi.fn()}
        onOpenAssistant={vi.fn()}
        onOpenQuality={vi.fn()}
        onOpenSharePackage={vi.fn()}
        onOpenExportOptions={vi.fn()}
      />,
    );
    const primaries = [...container.querySelectorAll(".ant-btn-primary")];
    expect(primaries).toHaveLength(1);
    expect(primaries[0].textContent).toContain("导出");
  });

  it("Tab 顺序与视觉顺序一致：辅助动作 → 尾行次动作 → 导出", () => {
    const { container } = renderFooter();
    const footer = container.querySelector(".resume-detail-footer") as HTMLElement;
    const order = [...footer.querySelectorAll("button")].map((button) =>
      (button.textContent ?? "").trim(),
    );
    expect(order).toEqual([
      "简历制作台",
      "AI 修改 / 重新生成",
      "生成岗位优化建议",
      "查看对应岗位",
      "咨询求职助手",
      "质量检测",
      "离线分享",
      "导出",
    ]);
    // 视觉顺序由 DOM 顺序决定，所以"能 Tab 到"的顺序天然一致；这里再确认没有 tabIndex
    // 把某个按钮提前（`tabIndex` 正数会改写 Tab 顺序）。
    expect([...footer.querySelectorAll("button")].every((b) => !b.hasAttribute("tabindex"))).toBe(
      true,
    );
  });

  it("没有关联岗位时「查看对应岗位」禁用，但仍在 Tab 顺序里（可见位置不跳）", () => {
    renderFooter({ jobId: null });
    expect(screen.getByRole("button", { name: /查看对应岗位/ })).toBeDisabled();
  });
});
