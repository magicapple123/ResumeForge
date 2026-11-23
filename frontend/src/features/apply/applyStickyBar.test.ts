// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台吸底条的**样式契约**（T5 / 台账第 9 条：P3 挪内边距 + M1 移动端 min-height）。
 *
 * jsdom 不求值布局（`getBoundingClientRect()` 恒为 0），"吸底条底下露出一条表格行"
 * 这种问题在单测里永远看不见——所以几何判据在真实浏览器里，由
 * `tests/smoke/apply-first-screen.spec.ts` 的「吸底条贴到窗口底」那三条量
 *（条下 2px 五点采样、三档内边距 16/24/32、375×720 的容器溢出与主 CTA）。
 *
 * 这里钉的是**另一件事**：那两条规则有没有被谁删掉。真实浏览器用例要跑起来需要
 * 一个活着的应用，CI 的默认作业不会跑它；样式表契约在 jsdom 里逐秒可查，
 * 有人删规则/回退成 `calc()` 时先红的是这里。
 *
 * 反证（本文件可自证）：删掉 `applyInformationHierarchy.css` 里的 P3 两条规则，
 * 前两个用例必须变红；把 `mobile.css` 的 `min-height: 0` 换回 `calc()`，第三个必须变红。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function read(...segments: string[]): string {
  return readFileSync([process.cwd(), ...segments].join("/"), "utf8");
}

/** 去掉块注释后再断言：注释里引用旧写法（本仓习惯保留"曾经怎么写"）不该被当成规则还在。 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

const hierarchy = stripComments(read("src", "features", "apply", "applyInformationHierarchy.css"));
const mobile = stripComments(read("src", "styles", "mobile.css"));

/** 取某个选择器的声明块正文（未命中返回空串，便于断言"规则不存在"）。 */
function blockOf(css: string, pattern: RegExp): string {
  return pattern.exec(css)?.[1] ?? "";
}

describe("P3：底部内边距从滚动容器挪到内容容器", () => {
  it("`.app-content` 只在投递页把 padding-bottom 归零（`:has()` 收窄，不是全站改）", () => {
    const block = blockOf(hierarchy, /\.app-content:has\(\s*>\s*\.apply-page\s*\)\s*\{([^}]*)\}/);
    expect(block, "缺少 `.app-content:has(> .apply-page)` 规则（P3 的核心）").not.toBe("");
    // 必须是 0：`position: sticky; bottom: 0` 贴的是滚动容器的 padding box 内侧，
    // 容器底部留 16/24/32px 内边距时，条下面必定漏一条同宽的缝。
    expect(block.replace(/\s+/g, " ")).toContain("padding-bottom: 0");
    // 不许顺手改其它轴（只挪底部内边距，横向/顶部由全站统一给）。
    expect(block).not.toMatch(/padding-(top|left|right|inline|block)\s*:/);
  });

  it("`.apply-page` 自己接手 `var(--rf-content-pad)`（三档 16/24/32 自动跟随）", () => {
    const blocks = [...hierarchy.matchAll(/\.apply-page\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(blocks.length, "`.apply-page` 的声明块不止一处，取全部再筛").toBeGreaterThan(0);
    const withPad = blocks.filter((block) =>
      /padding-bottom:\s*var\(--rf-content-pad\)/.test(block),
    );
    expect(
      withPad.length,
      "`.apply-page` 必须声明 padding-bottom: var(--rf-content-pad)（P3 的另一半）",
    ).toBe(1);
    // 不许写死像素：三档内边距跟着 token 走，写死只在一档对。
    for (const block of blocks) {
      expect(block).not.toMatch(/padding-bottom:\s*\d+px/);
    }
  });
});

describe("M1：手机档 `.app-content` 不再用 100dvh 减页头高度", () => {
  const phoneStart = mobile.indexOf("@media (max-width: 767px)");
  const phone = phoneStart >= 0 ? mobile.slice(phoneStart) : "";

  it("留在 `@media (max-width: 767px)` 里的 `.app-content` 上，且已改成 min-height: 0", () => {
    expect(phoneStart, "mobile.css 里必须有手机档媒体查询").toBeGreaterThan(-1);
    const block = blockOf(phone, /\.app-content\s*\{([^}]*)\}/);
    expect(block, "手机档里 `.app-content` 的声明块不该被整块删掉").not.toBe("");
    expect(block.replace(/\s+/g, " ")).toContain("min-height: 0");
  });

  it("整个文件不再出现 `calc(100dvh - var(--rf-header-height))`", () => {
    // 375 宽下那个变量是 120，而手机页头实际换行到 217.4px —— 用变量算出的 600
    // 塞进只剩 502.6px 的空间，容器底边被顶到 817.4，再被 `.app-main` 裁掉，
    // 吸底条与主 CTA 一起按不到。这条不许以任何形态回来（含注释）。
    const raw = read("src", "styles", "mobile.css");
    expect(raw).not.toMatch(/calc\(\s*100dvh\s*-\s*var\(\s*--rf-header-height\s*\)\s*\)/);
  });
});
