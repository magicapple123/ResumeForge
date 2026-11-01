// SPDX-License-Identifier: Apache-2.0
/**
 * F1-b：编辑器顶部通知条必须**排在内容尾部、留在正常布局流里**。
 *
 * 它原先参与 `.document-editor` 的 flex 布局、坐在页签之上：一出现/一消失就把整块
 * 字段区顶动（真机实测 52.3px）。而第一次点击 chip 恰好会 `setNotice(null)`——
 * "刚加完字段就快速双击"的第二下因此落到空处，双击看起来没反应（F1-b）。
 *
 * 也试过把它做成 `position: absolute` 的浮层（"不占布局"）：位移确实归零，但浮层钉在
 * 编辑器左上角，实测与 `.document-tabs` **整条相交 412×28**，页签文字被盖住（F1-c）。
 * 流内尾部同时满足"零位移"与"零覆盖"，所以口径回到流内。
 *
 * jsdom 不求值布局（`getBoundingClientRect()` 恒为 0），所以这里照
 * `input-focus-ring.test.ts` 的手法**直接读样式原文**断言：谁把它改回 absolute/fixed
 * 浮层，这里就变红。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

function css(): string {
  return readFileSync(
    [process.cwd(), "src", "components", "resume-editor", "document-editor.css"].join("/"),
    "utf8",
  );
}

/** 取某个选择器的规则块正文（`${selector} {` 起、到本块 `}` 止）。 */
function ruleBody(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  const end = source.indexOf("}", start);
  return end < 0 ? "" : source.slice(start, end);
}

describe("编辑器通知条（F1-b / F1-c）", () => {
  it("留在正常布局流里：不是 absolute/fixed 浮层", () => {
    const body = ruleBody(css(), ".document-editor-notice");
    expect(body).not.toBe("");
    // 与字段区之间只靠间距分隔（没有"贴顶定位"的语义了）。
    expect(body).toContain("margin-top");
    // 浮层化会让它压住页签条（实测相交 412×28）；这里锁死"不脱离文档流"。
    expect(body).not.toContain("position: absolute");
    expect(body).not.toContain("position: fixed");
    // 脱离文档流才会用到这几个定位/层级属性，出现即说明有人把它改回了浮层。
    // （按"行首属性名"匹配，避免 `margin-top` 这种包含 top 的属性误伤。）
    expect(body).not.toMatch(/(^|\n)\s*z-index\s*:/);
    expect(body).not.toMatch(/(^|\n)\s*(top|left|right)\s*:/);
  });

  it("不再是「不吃指针」的浮层，所以不需要关闭按钮的 pointer-events 特例", () => {
    const source = css();
    // 容器本身留在流里，鼠标事件天然可达；残留的 pointer-events 规则说明浮层口径没撤干净。
    expect(source).not.toContain(".document-editor-notice button");
    expect(ruleBody(source, ".document-editor-notice")).not.toContain("pointer-events");
  });
});
