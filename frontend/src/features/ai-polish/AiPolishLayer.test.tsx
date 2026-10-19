import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import AiPolishLayer from "./AiPolishLayer";
import { getLLMConfig } from "../../api/settings";
import { polishSelection } from "../../api/writing";

vi.mock("../../api/settings", () => ({ getLLMConfig: vi.fn() }));
vi.mock("../../api/writing", () => ({ polishSelection: vi.fn() }));

const getLLMConfigMock = vi.mocked(getLLMConfig);
const polishSelectionMock = vi.mocked(polishSelection);

const ORIGINAL = "负责后端接口开发";
const REWRITTEN = "主导后端接口开发，接口可用性提升到 99.9%";
const PLAIN_TEXT = "这是一段不能被润色的普通段落文字";
/** 指针位置：只影响菜单坐标，任何不为 0 的值都能验证"贴在指针旁"。 */
const POINT = { clientX: 40, clientY: 60 };

function configuredModel() {
  return { base_url: "http://fake", model: "fake-model" } as Awaited<
    ReturnType<typeof getLLMConfig>
  >;
}

function mountTextarea(value: string): HTMLTextAreaElement {
  const element = document.createElement("textarea");
  element.value = value;
  element.setAttribute("aria-label", "简历片段");
  document.body.append(element);
  return element;
}

/** 普通（不可编辑）段落：能选中、能复制，但没有可写回的目标。 */
function mountPlainText(value: string): HTMLDivElement {
  const element = document.createElement("div");
  element.textContent = value;
  document.body.append(element);
  return element;
}

/** 选中 `field` 的 [start, end)，模拟鼠标拖选的结果。 */
function selectField(field: HTMLTextAreaElement | HTMLInputElement, start: number, end: number) {
  field.focus();
  field.setSelectionRange(start, end);
  fireEvent.mouseUp(field);
}

function selectPlainText(host: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(host);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return selection;
}

/** 右键。返回值是 `dispatchEvent` 的结果：`false` 表示原生菜单被拦掉了。 */
function openMenuOn(element: Element, point = POINT): boolean {
  return fireEvent.contextMenu(element, point);
}

function menuItem(name: string): HTMLElement {
  return screen.getByRole("menuitem", { name });
}

function renderLayer() {
  return render(
    <MemoryRouter>
      <AiPolishLayer />
    </MemoryRouter>,
  );
}

function stubClipboard(stub: {
  writeText?: () => Promise<void>;
  readText?: () => Promise<string>;
}) {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: stub });
}

function stubExecCommand(impl: (command: string, showUI?: boolean, value?: string) => boolean) {
  Object.defineProperty(document, "execCommand", {
    configurable: true,
    writable: true,
    value: impl,
  });
}

beforeEach(() => {
  getLLMConfigMock.mockResolvedValue(configuredModel());
  polishSelectionMock.mockResolvedValue({ result: REWRITTEN });
});

afterEach(() => {
  act(() => {
    window.getSelection()?.removeAllRanges();
  });
  cleanup();
  document.body.innerHTML = "";
  Reflect.deleteProperty(navigator, "clipboard");
  Reflect.deleteProperty(document, "execCommand");
});

describe("AiPolishLayer 右键菜单", () => {
  it("选中文字右键 → 菜单 → AI 润色 → 卡片 → 改写 → 替换，输入框里留下结果", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, ORIGINAL.length);

    // 拦掉原生菜单，否则用户看到的还是系统那一份。
    expect(openMenuOn(field)).toBe(false);
    expect(await screen.findByRole("menu", { name: "文本操作" })).toBeInTheDocument();
    expect(menuItem("剪切")).toBeEnabled();
    expect(menuItem("复制")).toBeEnabled();
    expect(menuItem("粘贴")).toBeEnabled();
    expect(menuItem("全选")).toBeEnabled();
    expect(menuItem("AI 润色")).toBeEnabled();

    fireEvent.click(menuItem("AI 润色"));

    // 打开卡片后菜单收起：两张浮层不该同时挂着。
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());

    const card = await screen.findByRole("dialog", { name: "AI 润色" });
    // 卡片里既要有选中的原文，也要说清楚只发这一段。
    expect(card).toHaveTextContent(ORIGINAL);
    expect(card).toHaveTextContent("只发送选中的这段文字，不发送整份简历");

    fireEvent.click(screen.getByRole("button", { name: "开始改写" }));

    expect(await screen.findByLabelText("改写结果")).toHaveValue(REWRITTEN);
    // 只把选中的这一段发出去，且没写要求时 instruction 为空。
    expect(polishSelectionMock).toHaveBeenCalledTimes(1);
    expect(polishSelectionMock.mock.calls[0][0]).toBe(ORIGINAL);
    expect(polishSelectionMock.mock.calls[0][1]).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "替换选中" }));

    // await 一次再断言：确认替换不是"刚写进去又被 React 重渲染回滚"。
    await waitFor(() => expect(field.value).toBe(REWRITTEN));
    expect(screen.queryByRole("dialog", { name: "AI 润色" })).toBeNull();
  });

  it("点「取消」不替换原文", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, ORIGINAL.length);

    openMenuOn(field);
    fireEvent.click(menuItem("AI 润色"));
    await screen.findByRole("dialog", { name: "AI 润色" });
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "AI 润色" })).toBeNull());
    expect(field.value).toBe(ORIGINAL);
    expect(polishSelectionMock).not.toHaveBeenCalled();
  });

  it("非可编辑的普通文字：菜单有复制/全选，但没有 AI 润色，剪切与粘贴不可用", async () => {
    const host = mountPlainText(PLAIN_TEXT);
    renderLayer();
    selectPlainText(host);

    expect(openMenuOn(host)).toBe(false);
    expect(await screen.findByRole("menu", { name: "文本操作" })).toBeInTheDocument();

    expect(menuItem("复制")).toBeEnabled();
    expect(menuItem("全选")).toBeEnabled();
    // 没有可写回的输入框：剪切与粘贴都会无处可去，直接禁用而不是点了没反应。
    expect(menuItem("剪切")).toBeDisabled();
    expect(menuItem("粘贴")).toBeDisabled();
    expect(screen.queryByRole("menuitem", { name: "AI 润色" })).toBeNull();
  });

  it("没有选中文字时右键交给浏览器原生菜单", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();

    // 未拦截：`dispatchEvent` 返回 true。
    expect(openMenuOn(field)).toBe(true);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("只选中文字（不右键）不会自动冒出 AI 润色按钮", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 4);

    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.queryByRole("button", { name: "AI 润色" })).toBeNull();
    expect(document.querySelector(".rf-ai-polish-trigger")).toBeNull();

    // 容器里也不该有残留：选区变化后不会有任何浮层。
    await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
  });

  it("密码框里选中文字右键不出「AI 润色」", async () => {
    const password = document.createElement("input");
    password.type = "password";
    password.value = "hunter2-value";
    password.setAttribute("aria-label", "密码");
    document.body.append(password);
    renderLayer();
    password.focus();
    password.setSelectionRange(0, 4);

    openMenuOn(password);

    // jsdom 不会把 input 的选区算进 `window.getSelection()`，所以这里连菜单都不该有。
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("AiPolishLayer 菜单动作", () => {
  it("复制把选中的文字写进剪贴板", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard({ writeText });
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);

    openMenuOn(field);
    fireEvent.click(menuItem("复制"));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("负责"));
    // 复制完菜单收起，字段本身不动。
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
    expect(field.value).toBe(ORIGINAL);
  });

  it("剪切先写剪贴板再把选中的文字删掉", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    stubClipboard({ writeText });
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);

    openMenuOn(field);
    fireEvent.click(menuItem("剪切"));

    await waitFor(() => expect(field.value).toBe("后端接口开发"));
    expect(writeText).toHaveBeenCalledWith("负责");
  });

  it("粘贴优先走浏览器原生的 insertText", async () => {
    const readText = vi.fn(() => Promise.resolve("（贴上的）"));
    const execCommand = vi.fn(() => true);
    stubClipboard({ readText });
    stubExecCommand(execCommand);
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);

    openMenuOn(field);
    fireEvent.click(menuItem("粘贴"));

    await waitFor(() =>
      expect(execCommand).toHaveBeenCalledWith("insertText", false, "（贴上的）"),
    );
  });

  it("原生插入不可用时按光标偏移自己写回", async () => {
    const readText = vi.fn(() => Promise.resolve("贴上的"));
    stubClipboard({ readText });
    stubExecCommand(() => false);
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);

    openMenuOn(field);
    fireEvent.click(menuItem("粘贴"));

    await waitFor(() => expect(field.value).toBe("贴上的后端接口开发"));
  });

  it("全选把输入框里的文字整段选中", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);

    openMenuOn(field);
    fireEvent.click(menuItem("全选"));

    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(ORIGINAL.length);
    // 菜单仍然收起，用户接着就能复制或改写。
    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});

describe("AiPolishLayer 菜单关闭", () => {
  it("按 Esc 关闭菜单", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);
    openMenuOn(field);
    await screen.findByRole("menu");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });

  it("点击菜单外部关闭菜单", async () => {
    const field = mountTextarea(ORIGINAL);
    renderLayer();
    selectField(field, 0, 2);
    openMenuOn(field);
    await screen.findByRole("menu");

    fireEvent.pointerDown(document.body);

    await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
  });
});
