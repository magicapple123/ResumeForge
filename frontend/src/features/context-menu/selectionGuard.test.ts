// SPDX-License-Identifier: Apache-2.0
/**
 * 「这次右键归谁」——选中文字时行/字段菜单要让位给选区菜单。
 *
 * 用户实测（2026-11-04）：正文块里选中一句话后右键，两张卡片叠在一起。根因是两套
 * 监听都在处理同一个 `contextmenu`：选区菜单（全局单例浮层）+ 字段菜单（antd Dropdown）。
 * 这个纯函数就是唯一判据，`useDropdownContextMenu` 在打开前问一次。
 */
import { describe, expect, it } from "vitest";
import { hasActiveTextSelection } from "./selectionGuard";

function field(value: string, start: number, end: number): HTMLTextAreaElement {
  const el = document.createElement("textarea");
  el.value = value;
  document.body.append(el);
  el.focus();
  el.setSelectionRange(start, end);
  return el;
}

describe("hasActiveTextSelection", () => {
  it("输入框里有选区：算，行菜单该让位", () => {
    field("\u6b63\u6587\u5185\u5bb9", 0, 2);
    expect(hasActiveTextSelection()).toBe(true);
    document.body.innerHTML = "";
  });

  it("输入框里只有光标（没选中）：不算，右键仍是整块操作", () => {
    field("\u6b63\u6587\u5185\u5bb9", 2, 2);
    expect(hasActiveTextSelection()).toBe(false);
    document.body.innerHTML = "";
  });

  it("只选中空白：不算——复制一段空格没有意义", () => {
    field("    ", 0, 4);
    expect(hasActiveTextSelection()).toBe(false);
    document.body.innerHTML = "";
  });

  it("文档级选区（普通段落 / contenteditable）：算", () => {
    const para = document.createElement("p");
    para.textContent = "\u6bb5\u843d\u6587\u5b57";
    document.body.append(para);
    const range = document.createRange();
    range.selectNodeContents(para);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    expect(hasActiveTextSelection()).toBe(true);
    selection?.removeAllRanges();
    document.body.innerHTML = "";
  });

  it("什么选区都没有：不算", () => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = "";
    expect(hasActiveTextSelection()).toBe(false);
  });
});
