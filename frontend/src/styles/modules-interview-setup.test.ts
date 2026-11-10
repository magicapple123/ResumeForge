// SPDX-License-Identifier: Apache-2.0
/**
 * 面试设定卡布局契约（第 8 条，2026-11-10）。
 *
 * jsdom 不求值 antd 的 CSS-in-JS，也不会真的做布局；按项目惯例直接读样式文件原文，
 * 把"数值型视觉约定"钉在源码上：外层纵向 stack、4 字段 4 等列 + 容器查询分档、
 * 网格内 Form.Item 外边距归零、材料行 align-items: start。改了这些数就红，逼着同批
 * 重拍 1440/1280/1024/768/380 的验收截图。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function readStyle(name: string): string {
  return readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8");
}

/** 取某条规则（精确选择器）的声明块；找不到返回 null。 */
function ruleBody(css: string, selector: string): string | null {
  const marker = selector + " {";
  const at = css.indexOf(marker);
  if (at === -1) return null;
  const rest = css.slice(at + marker.length);
  const end = rest.indexOf("}");
  return end === -1 ? null : rest.slice(0, end);
}

const setupCss = readStyle("modules-interview-setup.css");
const interviewCss = readStyle("modules-interview.css");

describe("面试设定卡布局（第 8 条）", () => {
  it("外层是纵向 stack，并在这一层建容器查询上下文", () => {
    const body = ruleBody(setupCss, ".interview-setup-stack");
    expect(body, "样式表里找不到 .interview-setup-stack").not.toBeNull();
    expect(body ?? "").toMatch(/display:\s*flex/);
    expect(body ?? "").toMatch(/flex-direction:\s*column/);
    // 第 2 条：5 个块叠加时每段 16px 偏松，收成 12px（552 → ≤430 的一笔）。
    expect(body ?? "").toMatch(/gap:\s*12px/);
    expect(body ?? "").toMatch(/container-type:\s*inline-size/);
  });

  it("4 个字段的网格宽屏正好 4 等列，且 align-items: start", () => {
    const body = ruleBody(setupCss, ".interview-setup-fields");
    expect(body, "样式表里找不到 .interview-setup-fields").not.toBeNull();
    expect(body ?? "").toMatch(/grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
    expect(body ?? "").toMatch(/align-items:\s*start/);
  });

  it("容器宽度分档：760px 两列、440px 一列", () => {
    expect(setupCss).toMatch(/@container \(max-width: 760px\)/);
    expect(setupCss).toMatch(/@container \(max-width: 440px\)/);
    const twoColAt = setupCss.indexOf("@container (max-width: 760px)");
    const fourColAt = setupCss.indexOf("@container (max-width: 440px)");
    expect(twoColAt).toBeGreaterThan(-1);
    expect(fourColAt).toBeGreaterThan(twoColAt);
    const twoCol = setupCss.slice(twoColAt, fourColAt);
    expect(twoCol).toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(twoCol).toMatch(/row-gap:\s*16px/);
    const oneCol = setupCss.slice(fourColAt);
    expect(oneCol).toMatch(/grid-template-columns:\s*minmax\(0, 1fr\)/);
  });

  it("网格内 Form.Item 外边距归零（否则与 stack 的 gap 叠成双倍间距）", () => {
    const body = ruleBody(setupCss, ".interview-setup-fields .ant-form-item");
    expect(body, "样式表里找不到字段网格的 Form.Item 规则").not.toBeNull();
    expect(body ?? "").toMatch(/margin-bottom:\s*0/);
  });

  it("材料行两列各自按内容高度排，不再跨栅格行", () => {
    const body = ruleBody(setupCss, ".interview-setup-materials");
    expect(body, "样式表里找不到 .interview-setup-materials").not.toBeNull();
    expect(body ?? "").toMatch(/align-items:\s*start/);
    expect(body ?? "").not.toMatch(/grid-column/);
  });

  it("材料块的 Form.Item 下边距归零（漏了会与外层 gap 叠成 40px）", () => {
    const body = ruleBody(setupCss, ".interview-setup-materials .ant-form-item");
    expect(body, "样式表里找不到材料块的 Form.Item 规则").not.toBeNull();
    expect(body ?? "").toMatch(/margin-bottom:\s*0/);
  });

  it("风格与人设并列两列，窄容器塌成一列（第 2 条）", () => {
    const body = ruleBody(setupCss, ".interview-setup-persona");
    expect(body, "样式表里找不到 .interview-setup-persona").not.toBeNull();
    expect(body ?? "").toMatch(/display:\s*grid/);
    expect(body ?? "").toMatch(/grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
    expect(body ?? "").toMatch(/align-items:\s*start/);
    // 旧的纵向 flex 与两条 margin 规则必须消失，否则右列会被顶下去。
    expect(setupCss).not.toMatch(/\.interview-setup-persona \{[^}]*flex-direction:\s*column/);
    expect(setupCss).not.toMatch(/\.interview-setup-persona \.ant-form-item:last-child/);
    // 塌一列用容器查询，与字段网格同一档（760px），不另起媒体查询。
    expect(setupCss).toMatch(
      /@container \(max-width: 760px\)[^}]*\{[^}]*\.interview-setup-persona[^}]*minmax\(0, 1fr\)/s,
    );
  });

  it("旧主栅格规则已删除；提示语与轮数说明都是全宽块", () => {
    expect(interviewCss).not.toMatch(/\.interview-setup-grid\s*\{/);
    expect(interviewCss).not.toMatch(/\.interview-setup-hint\s*\{/);
    expect(ruleBody(setupCss, ".interview-setup-hint") ?? "").toMatch(/display:\s*block/);
    expect(ruleBody(setupCss, ".interview-setup-rounds-hint") ?? "").toMatch(/display:\s*block/);
  });
});
