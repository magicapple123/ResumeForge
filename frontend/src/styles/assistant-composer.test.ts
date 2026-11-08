// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区窄栏与只读模型 chip 的样式契约（T11）。
 *
 * jsdom 不求值布局，所以直接读 CSS 原文断言：判窄必须按**容器**宽度（左栏可拖到 380，
 * 视口媒体查询看不见左栏变窄），工具栏允许换行（窄栏不出现横向滚动），语音槽位有样式锚点。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "assistant-composer.css"].join("/"), "utf8");
}

describe("输入区窄栏", () => {
  it("输入区是容器查询容器（按实际宽度判窄，而不是视口）", () => {
    const source = css();
    expect(source).toContain("container-type: inline-size");
  });

  it("< 480px 时模型名让位：chip 只留推理等级（左栏拖到 380 时右侧仍放得下三个控件）", () => {
    const rule = /@container \(max-width: 479px\) \{([\s\S]*?)\n\}/.exec(css())?.[1] ?? "";
    // R06-B 之前这条规则把整枚只读模型 chip 隐藏掉。合并成「模型 · 推理等级」之后
    // 它可点了，整枚隐藏等于窄栏里改不了推理等级——所以改成只收掉模型名，
    // chip / 麦克风 / 发送三个控件并排放得下（验收项 9）。
    expect(rule).toContain(".assistant-reasoning-chip-model");
    expect(rule).toContain(".assistant-reasoning-chip-sep");
    expect(rule).toContain("display: none");
  });

  it("工具栏可换行，窄栏不出现横向滚动", () => {
    const block = /\.assistant-composer-utility \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(block).toContain("flex-wrap: wrap");
  });

  it("语音槽位有样式锚点（W4 只往槽位里填按钮，不改结构）", () => {
    expect(css()).toContain(".composer-voice-slot");
  });

  it("发送键外层包裹是 inline-flex（否则 span 带来基线间隙把工具栏顶高）", () => {
    const block = /\.assistant-composer-send-wrap \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(block).toContain("display: inline-flex");
  });
});
