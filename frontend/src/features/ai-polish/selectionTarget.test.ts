// SPDX-License-Identifier: Apache-2.0
import { cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { getSelectionTarget, isEditableElement } from "./selectionTarget";

function mount<T extends HTMLElement>(element: T): T {
  document.body.append(element);
  return element;
}

function makeTextarea(value: string): HTMLTextAreaElement {
  const area = mount(document.createElement("textarea"));
  area.value = value;
  return area;
}

afterEach(() => {
  window.getSelection()?.removeAllRanges();
  cleanup();
  document.body.innerHTML = "";
});

describe("isEditableElement", () => {
  it("接受普通文本输入框与 textarea", () => {
    const input = mount(document.createElement("input"));
    input.type = "text";
    const area = makeTextarea("负责后端接口开发");

    expect(isEditableElement(input)).toBe(true);
    expect(isEditableElement(area)).toBe(true);
  });

  it("拒绝密码框与敏感命名的字段", () => {
    const password = mount(document.createElement("input"));
    password.type = "password";
    // 名字里带 key/token/secret 的普通输入框同样不该被送去模型。
    const apiKey = mount(document.createElement("input"));
    apiKey.type = "text";
    apiKey.name = "api_key";

    expect(isEditableElement(password)).toBe(false);
    expect(isEditableElement(apiKey)).toBe(false);
  });

  it("拒绝只读、禁用、combobox 与显式声明忽略的区域", () => {
    const readOnly = makeTextarea("负责后端接口开发");
    readOnly.readOnly = true;

    const disabled = makeTextarea("负责后端接口开发");
    disabled.disabled = true;

    const combobox = mount(document.createElement("input"));
    combobox.setAttribute("role", "combobox");

    const ignored = mount(document.createElement("div"));
    ignored.setAttribute("data-ai-polish-ignore", "");
    const nested = document.createElement("textarea");
    nested.value = "负责后端接口开发";
    ignored.append(nested);

    expect(isEditableElement(readOnly)).toBe(false);
    expect(isEditableElement(disabled)).toBe(false);
    expect(isEditableElement(combobox)).toBe(false);
    expect(isEditableElement(nested)).toBe(false);
  });

  it("接受 contenteditable 容器，拒绝普通 div", () => {
    const editable = mount(document.createElement("div"));
    editable.setAttribute("contenteditable", "true");
    editable.textContent = "负责后端接口开发";

    const plain = mount(document.createElement("div"));
    plain.textContent = "负责后端接口开发";

    expect(isEditableElement(editable)).toBe(true);
    expect(isEditableElement(plain)).toBe(false);
  });
});

describe("getSelectionTarget", () => {
  it("返回 textarea 的选区、类型与文本", () => {
    const area = makeTextarea("负责后端接口开发");
    area.focus();
    area.setSelectionRange(0, 2);

    const target = getSelectionTarget();

    expect(target).not.toBeNull();
    expect(target?.kind).toBe("textarea");
    expect(target?.element).toBe(area);
    expect(target?.start).toBe(0);
    expect(target?.end).toBe(2);
    expect(target?.text).toBe("负责");
  });

  it("折叠选区与纯空白选区都不出按钮", () => {
    const area = makeTextarea("负责后端接口开发");
    area.focus();
    area.setSelectionRange(3, 3);
    expect(getSelectionTarget()).toBeNull();

    const padded = makeTextarea("   \n  ");
    padded.focus();
    padded.setSelectionRange(0, 5);
    expect(getSelectionTarget()).toBeNull();
  });

  it("密码框即使有选区也不返回目标", () => {
    const password = mount(document.createElement("input"));
    password.type = "password";
    password.value = "hunter2-value";
    password.focus();
    password.setSelectionRange(0, 4);

    expect(getSelectionTarget()).toBeNull();
  });

  it("返回 contenteditable 里的选区", () => {
    const host = mount(document.createElement("div"));
    host.setAttribute("contenteditable", "true");
    host.textContent = "负责后端接口开发";

    const range = document.createRange();
    range.setStart(host.firstChild!, 0);
    range.setEnd(host.firstChild!, 2);
    const selection = window.getSelection()!;
    selection.removeAllRanges();
    selection.addRange(range);

    const target = getSelectionTarget();

    expect(target).not.toBeNull();
    expect(target?.kind).toBe("contenteditable");
    expect(target?.element).toBe(host);
    expect(target?.text).toBe("负责");
    expect(target?.start).toBe(0);
    expect(target?.end).toBe(2);
  });
});
