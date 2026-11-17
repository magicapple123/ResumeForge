// SPDX-License-Identifier: Apache-2.0
/**
 * 投投悬浮球的光晕必须**跟手**（T10）。
 *
 * 2026-11 反馈：球被拖走/贴边收起时，那圈信号光晕留在原地——像两个东西。
 * 根因是 pulse 挂在 `.tt-hide`（负责位移的层）上，box-shadow 只画在那一层的瞬时位置。
 *
 * 这是**定位型视觉约定**：jsdom 不求值层叠，"环心与球心距离 < 2px"只能在真浏览器里量。
 * 这里守的是让它成立的结构：环是 `.tt-breathe` 的子元素、自己绝对定位铺满、
 * 动画挂在环上而不是位移层上。结构一改，真机就会重新出现"环不跟手"。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "tou-tou-orb.css"].join("/"), "utf8");
}

/** 取某条选择器的规则块（第一个 `{ ... }`），找不到返回空串。 */
function block(selector: string): string {
  // 必须从行首开始匹配：否则 `.tt-glow` 会先命中 `.tt.is-dragging .tt-glow`。
  const pattern = new RegExp(
    `(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  );
  return pattern.exec(css())?.[1] ?? "";
}

describe("投投光晕（T10）", () => {
  it("环自己绝对定位铺满 .tt-breathe，并带圆角", () => {
    const rule = block(".tt-glow");
    expect(rule).toContain("position: absolute");
    expect(rule).toContain("inset: 0");
    expect(rule).toContain("border-radius: 50%");
    expect(rule).toContain("pointer-events: none");
    // `.tt-breathe` 有多条规则（布局、动画、这里的定位），按"某一条里有 relative"断言。
    expect(css()).toMatch(/\.tt-breathe\s*\{[^}]*position:\s*relative/u);
  });

  it("pulse 只挂在环上，位移层不再画环", () => {
    expect(block(".tt-shell.has-signals .tt-glow")).toContain("tt-signal-pulse");
    // 反证点：动画挪回 .tt-hide 就会重新"环不跟手"。
    expect(block(".tt-shell.has-signals .tt-hide")).not.toContain("tt-signal-pulse");
  });

  it("拖拽时环也暂停（否则球停了环还在呼吸）", () => {
    const rule = block(".tt.is-dragging .tt-glow");
    expect(rule).toContain("animation-play-state: paused");
  });

  it("reduced-motion 的静态环也落在环上", () => {
    // 媒体查询里的规则块不在 block() 的取法范围内，直接看整份文本的顺序关系。
    const text = css();
    const reduced = text.slice(text.indexOf("prefers-reduced-motion"));
    expect(reduced).toContain(".tt-shell.has-signals .tt-glow");
    expect(reduced).toContain("outline: 2px dashed");
  });

  it("组件源码：环挂在 .tt-breathe 里，且在 .tt-turn 之前", () => {
    // 渲染整颗球要一长串 props/上下文；这里守的是**结构顺序**，读源码原文更直接。
    const source = readFileSync(
      [process.cwd(), "src", "features", "tou-tou", "TouTouOrbButton.tsx"].join("/"),
      "utf8",
    );
    const breathe = source.indexOf('className="tt-breathe"');
    const glow = source.indexOf('className="tt-glow"');
    const turn = source.indexOf('className="tt-turn"');
    expect(breathe).toBeGreaterThan(-1);
    expect(glow).toBeGreaterThan(breathe);
    expect(turn).toBeGreaterThan(glow);
  });
});
