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

describe("设置页权限卡 2×2（11-1）", () => {
  /** 去掉注释后的样式表：注释里会提到"不要写 display: contents"，不能被断言误伤。 */
  function bare(): string {
    return css().replace(/\/\*[\s\S]*?\*\//g, "");
  }

  /** 网格主体：`.assistant-permission-grid`（TSX 里挂在 `Radio.Group` 上的类名）。 */
  function gridRule(): string {
    return (
      /\.assistant-permission-stack \.assistant-permission-grid \{([\s\S]*?)\}/.exec(bare())?.[1] ??
      ""
    );
  }

  it("选项区是两列等宽网格，列间距 24 / 行间距 8", () => {
    const block = gridRule();
    expect(block).toContain("display: grid");
    expect(block).toContain("grid-template-columns: repeat(2, minmax(0, 1fr))");
    expect(block).toContain("gap: 8px 24px");
    expect(block).toContain("align-items: start");
  });

  it("四个选项占满轨道：网格内撤掉 280px 上限（否则两列里仍只用左侧一小块）", () => {
    const style = bare();
    expect(style).toMatch(
      /\.assistant-permission-grid \.assistant-permission-option \{\s*max-width: none;/,
    );
    expect(style).toMatch(
      /\.assistant-permission-grid > \.ant-radio-wrapper \{[\s\S]*?margin-inline-end: 0;/,
    );
    // 容器那层 Space 是 `inline-flex`（按内容收缩）：不撑满的话网格只有内容宽（实测 514px），
    // 两列轨道各 245px，右侧依旧空 475px——等于把"一列窄"换成"两列都窄"。
    expect(style).toMatch(/\.assistant-permission-stack \{[\s\S]*?width: 100%;/);
  });

  it("不做宽选择器：不用 `display: contents` 摊平 antd 的 Space，也不靠 `:has()` 定位", () => {
    // 这两条是 11-1 收口时改掉的实现方式：`display: contents` / `.settings-card ... :has()`
    // 都会顺手影响 `.settings-card` 里其它卡的 Space（副作用面远超这张卡）。
    const style = bare();
    expect(style).not.toContain("display: contents");
    expect(style).not.toContain(":has(");
  });

  it("按容器宽度分档：卡片内容区 ≤620px 塌单列（不用视口媒体查询）", () => {
    const style = bare();
    expect(style).toMatch(/\.assistant-permission-stack \{[\s\S]*?container-type: inline-size;/);
    expect(style).toContain("container-name: rf-permission");
    const narrow =
      /@container rf-permission \(max-width: 620px\) \{([\s\S]*?)\n\}/.exec(style)?.[1] ?? "";
    expect(narrow).toContain("grid-template-columns: minmax(0, 1fr)");
  });
});
