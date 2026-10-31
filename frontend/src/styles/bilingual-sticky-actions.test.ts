// SPDX-License-Identifier: Apache-2.0
/**
 * 翻译候选的「采纳选中」条吸附在滚动视口底部。
 *
 * 2026-11 反馈：候选几十条时按钮跟在列表末尾，要一路滚到底才点得到。
 * 这是**定位型视觉约定**——类名测不出来，jsdom 也不求值层叠与滚动：读样式原文断言。
 *
 * 特别钉住 `sticky` 而不是 `fixed`：吸附对象是制作台左栏自己的滚动视口
 * （`.resume-wb-col` 是 `overflow-y: auto`，宽度可拖、窄屏挂进抽屉），
 * `fixed` 会钉到窗口上跑到面板外面。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "bilingual.css"].join("/"), "utf8");
}

/** 取某条选择器的规则块（第一个 `{ ... }`），找不到返回空串。 */
function block(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  );
  return pattern.exec(css())?.[1] ?? "";
}

describe("翻译候选的动作条", () => {
  it("吸附在滚动视口底部（position: sticky + bottom: 0）", () => {
    const actions = block(".translation-candidates__actions");
    expect(actions).not.toBe("");
    expect(actions).toContain("position: sticky");
    expect(actions).toContain("bottom: 0");
    // 不能用 fixed：那会钉到窗口上、跑到制作台左栏外面。
    expect(actions).not.toContain("position: fixed");
  });

  it("有底色与上边框，滚到底下的候选不会从按钮条里透出来", () => {
    const actions = block(".translation-candidates__actions");
    expect(actions).toContain("background:");
    expect(actions).toContain("border-top:");
    // 仍然允许换行（窄栏里按钮要能折行，否则会横向溢出）。
    expect(actions).toContain("flex-wrap: wrap");
  });

  it("对照视图的「还没翻译」提示条与表格留出间距", () => {
    const notice = block(".bilingual-compare-notice");
    expect(notice).not.toBe("");
    expect(notice).toContain("margin-bottom:");
  });

  it("宽布局只在表头显示语种列名，行内语种标签由容器查询隐藏（Q24）", () => {
    const source = css();
    const at = source.indexOf("@container (min-width: 620px)");
    expect(at).toBeGreaterThan(-1);
    const scoped = source.slice(at);
    // 宽栏（≥620px 容器）里隐藏行内语种标签：表头已经写明「当前简历 / 英文版」。
    const langAt = scoped.indexOf(".bilingual-compare__lang");
    expect(langAt).toBeGreaterThan(-1);
    expect(scoped.slice(langAt, langAt + 200)).toContain("display: none");
    // 窄栏（默认堆叠布局）必须保留行内标签：没有表头就没有别的语种提示。
    const lang = block(".bilingual-compare__lang");
    expect(lang).not.toBe("");
    expect(lang).not.toContain("display: none");
  });
});
