// SPDX-License-Identifier: Apache-2.0
/**
 * 投投小贴士（`.tt-tip`）不吃指针事件。
 *
 * 2026-10-27（QA 第一轮拖拽失败的口径）：提示卡浮在页面右侧内容之上，卡片本体是
 * `pointer-events: auto`，于是卡下面的条目卡拖拽把手 `pointerdown` 被卡片接走——
 * 用户看到的是"把手偶尔拖不动"，而且只有在提示冒出来的那几秒才复现。
 *
 * 视觉上卡片必须留在原地（它没有多余的位置可让），所以做法是：卡片本体
 * `pointer-events: none` 让指针穿透，卡内真正要点的元素（关闭按钮）单独收回
 * `pointer-events: auto`。jsdom 不求值层叠与命中测试，这里直接读样式原文断言这两条。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "tou-tou-cards.css"].join("/"), "utf8");
}

/** 取某条选择器的规则块（第一个 `{ ... }`），找不到返回空串。 */
function block(selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  );
  return pattern.exec(css())?.[1] ?? "";
}

describe("投投小贴士的指针事件", () => {
  it("卡片本体不吃指针事件（否则会接走下面条目的拖拽 pointerdown）", () => {
    const tip = block(".tt-tip");
    expect(tip).not.toBe("");
    expect(tip).toContain("pointer-events: none");
    // 不能再退回 auto：那正是缺陷本身。
    expect(tip).not.toContain("pointer-events: auto");
  });

  it("关闭按钮把指针收回来，卡片穿透后仍然点得动", () => {
    const close = block(".tt-tip-close");
    expect(close).not.toBe("");
    expect(close).toContain("pointer-events: auto");
  });

  it("没有别处把 .tt-tip 的指针事件改回 auto（贴边定位只改位置）", () => {
    // 贴边形态（is-edge-*）与响应式/无障碍文件只管定位与动效，不该重置指针事件。
    const others = [
      ["src", "styles", "tou-tou-orb.css"],
      ["src", "features", "tou-tou", "tou-tou-accessibility.css"],
    ]
      .map((segments) => readFileSync([process.cwd(), ...segments].join("/"), "utf8"))
      .join("\n");
    expect(others).not.toMatch(/\.tt-tip\b[^{]*\{[^}]*pointer-events\s*:\s*auto/u);
  });
});
