// SPDX-License-Identifier: Apache-2.0
/**
 * 自绘标题栏的样式守卫（问题清单 §19.8「样式守卫」）。
 *
 * 这几条规则漏了都不会报错，只会"UI 看起来怪 / 点不动"：拖拽区里忘了 no-drag 会让
 * 整条标题栏收不到点击；高度与主进程 titleBarOverlay 不一致会出现 1–2px 的错位；
 * 深浅两套悬停底色不同源会变成两种高亮。直接读 CSS 原文断言，成本最低。
 */
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

declare const process: { cwd(): string };

const CSS = readFileSync(`${process.cwd()}/src/styles/desktop-titlebar.css`, "utf8");

/** 取某个选择器的声明块原文；找不到直接抛错（改名/删规则时立刻红）。 */
function ruleBlock(selector: string): string {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`CSS 中找不到规则：${selector}`);
  const end = CSS.indexOf("}", start);
  return CSS.slice(start, end);
}

describe("桌面标题栏样式", () => {
  it("高度 token 是 32px，主进程覆盖层与此同值", () => {
    expect(CSS).toContain("--rf-titlebar-height: 32px;");
    expect(ruleBlock(".app-titlebar")).toContain("height: var(--rf-titlebar-height);");
  });

  it("拖拽区可拖，菜单容器与下拉必须 no-drag", () => {
    expect(ruleBlock(".app-titlebar-drag")).toContain("-webkit-app-region: drag;");
    expect(ruleBlock(".app-titlebar-menus")).toContain("-webkit-app-region: no-drag;");
    expect(ruleBlock(".app-titlebar-menu-dropdown")).toContain("-webkit-app-region: no-drag;");
  });

  it("菜单 12px 字 / 左右 10px / 圆角 4px，悬停底色深浅各一份且同源", () => {
    const trigger = ruleBlock(".app-titlebar-menu-trigger");
    expect(trigger).toContain("font-size: 12px;");
    expect(trigger).toContain("padding: 0 10px;");
    expect(trigger).toContain("border-radius: 4px;");
    expect(CSS).toContain("--rf-titlebar-hover: #e8edf4;");
    expect(CSS).toContain("--rf-titlebar-hover: #232b36;");
    const hoverStart = CSS.indexOf(".app-titlebar-menu-trigger:hover");
    const hoverBlock = CSS.slice(hoverStart, CSS.indexOf("}", hoverStart));
    expect(hoverBlock).toContain("background: var(--rf-titlebar-hover);");
    expect(hoverBlock).not.toContain("#");
  });

  it("净增 0px：纵向 flex 落在 antd App 包裹层，app-shell / 侧栏让出标题栏高度", () => {
    // 真机实测：React 根是 #root > .ant-app，标题栏与 app-shell 不是 #root 的直接子节点，
    // 所以承载 100vh 的 flex 容器必须指向包裹层（否则 app-shell 保持内容高度、被裁切）。
    const wrapper = ruleBlock("html:has(.app-titlebar) #root > .ant-app");
    expect(wrapper).toContain("display: flex;");
    expect(wrapper).toContain("flex-direction: column;");
    expect(wrapper).toContain("height: 100vh;");
    const shellBlock = ruleBlock("html:has(.app-titlebar) .app-shell");
    expect(shellBlock).toContain("flex: 1 1 auto;");
    expect(shellBlock).toContain("height: auto;");
    const siderBlock = ruleBlock("html:has(.app-titlebar) .app-sider");
    expect(siderBlock).toContain("top: var(--rf-titlebar-height);");
    expect(siderBlock).toContain("calc(100vh - var(--rf-titlebar-height))");
  });

  it("32px 高度与主进程覆盖层对齐：盒高包含 1px 下边框", () => {
    expect(ruleBlock(".app-titlebar")).toContain("box-sizing: border-box;");
  });

  it("标题栏背景色与主进程 TITLEBAR_THEME 逐值一致（浅/深）", () => {
    expect(CSS).toContain("--rf-titlebar-bg: #f5f7fa;");
    expect(CSS).toContain("--rf-titlebar-bg: #151b23;");
    expect(CSS).toContain("--rf-titlebar-border: #e6eaf0;");
    expect(CSS).toContain("--rf-titlebar-border: #232b36;");
  });

  it("全屏时只隐藏不卸载（退出全屏还要收推送）", () => {
    expect(ruleBlock('.app-titlebar[data-hidden="true"]')).toContain("display: none;");
  });
});
