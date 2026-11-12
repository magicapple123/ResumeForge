// SPDX-License-Identifier: Apache-2.0
/**
 * 「草稿模式编辑」：点纸面字段 → 把那条 `data-resume-path` 交给宿主。
 *
 * 这一层的三处风险都只在"点了之后"才看得见，而且都不会报错：
 *
 * 1. **点一次跳 N 次**：`onLoad` 会因为重渲染与"下一帧补测"反复触发同一个文档，
 *    监听器挂了几次就触发几次（用户看到的是"跳到了第三个字段"）；
 * 2. **点空白也有反应**：没做命中判断时，任何一次点击都会带着 `undefined` 往下走；
 * 3. **反馈看不见**：纸面是后端 HTML，父页面样式进不去——不往那个文档里注入样式，
 *    用户就完全不知道"哪里能点"。
 *
 * 断言里不出现中文：`cjkRatchet` 的 tests 口径按文件卡中文 `*ByText` 断言，新文件基线为 0。
 *
 * 覆盖面同时包含两半：纯函数（`./clickToEdit`：持久化 / 命中判定 / 样式注入）与状态机
 * （`./useClickToEditPreview`：勾选、判重、开关联动）。两半共用同一份"纸面文档"夹具。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import {
  CLICK_TO_EDIT_CLASS,
  CLICK_TO_EDIT_CSS,
  CLICK_TO_EDIT_PATH_ATTR,
  CLICK_TO_EDIT_STORAGE_KEY,
  CLICK_TO_EDIT_STYLE_ID,
  hasTextSelection,
  paintClickToEdit,
  readStoredClickToEdit,
  resolvePickPath,
} from "./clickToEdit";
import { useClickToEditPreview } from "./useClickToEditPreview";

/**
 * 造一份"纸面文档"。
 *
 * 用 `createHTMLDocument` 而不是真 iframe：jsdom 里 iframe 的 `contentDocument` 与加载
 * 时序都不稳，而这里要证的是**逻辑**（命中判定、判重、注入），不是浏览器的加载行为。
 * 一个独立的 Document 与 iframe 里那个文档在 API 上是同一套。
 */
function paperDocument(): Document {
  const doc = document.implementation.createHTMLDocument("resume");
  doc.body.innerHTML = [
    "<div class='header'>",
    `  <h1 ${CLICK_TO_EDIT_PATH_ATTR}='name'>Alex</h1>`,
    `  <p ${CLICK_TO_EDIT_PATH_ATTR}='job_intent'>Backend</p>`,
    "  <p class='plain'>not a field</p>",
    "</div>",
  ].join("");
  return doc;
}

/** 取一块"空的"容器 ref（`containerRef` 只用于切换勾选时刷已加载的文档）。 */
function emptyContainer(): RefObject<HTMLDivElement | null> {
  return { current: null };
}

function clickOn(node: Element): MouseEvent {
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  act(() => {
    node.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("resolvePickPath · 命中判定", () => {
  it("找到最近的带路径祖先，返回它的属性值", () => {
    const doc = paperDocument();
    const inner = doc.createElement("strong");
    const name = doc.querySelector(`[${CLICK_TO_EDIT_PATH_ATTR}]`) as HTMLElement;
    name.appendChild(inner);

    // 点在**子节点**上也要命中：模板里标题常被 `<strong>` 包一层。
    expect(resolvePickPath(inner)).toBe("name");
    expect(resolvePickPath(name)).toBe("name");
  });

  it("点在普通文字上返回 null（不该把一次误点变成跳转）", () => {
    const doc = paperDocument();
    expect(resolvePickPath(doc.querySelector(".plain"))).toBeNull();
    expect(resolvePickPath(doc.body)).toBeNull();
    expect(resolvePickPath(null)).toBeNull();
  });

  it("hasTextSelection：拖选之后为真，折叠/空串/没有视图都为假", () => {
    const withSelection = (isCollapsed: boolean, text: string) =>
      ({
        defaultView: { getSelection: () => ({ isCollapsed, toString: () => text }) },
      }) as unknown as Document;
    expect(hasTextSelection(withSelection(false, "selected text"))).toBe(true);
    // 折叠的光标不算"用户选中了文字"。
    expect(hasTextSelection(withSelection(true, ""))).toBe(false);
    // 只有空白也不算。
    expect(hasTextSelection(withSelection(false, "   "))).toBe(false);
    // createHTMLDocument() 造出来的文档 defaultView 是 null（真实 iframe 里不是）。
    expect(hasTextSelection(paperDocument())).toBe(false);
    expect(hasTextSelection(null)).toBe(false);
  });

  it("属性为空串时也算没命中", () => {
    const doc = paperDocument();
    const node = doc.createElement("span");
    node.setAttribute(CLICK_TO_EDIT_PATH_ATTR, "   ");
    doc.body.appendChild(node);
    expect(resolvePickPath(node)).toBeNull();
  });
});

describe("paintClickToEdit · 视觉反馈注入 iframe 内部", () => {
  it("注入样式表并把开关 class 打在文档根上；关掉时只摘 class、不留空壳", () => {
    const doc = paperDocument();

    paintClickToEdit(doc, true);
    const style = doc.getElementById(CLICK_TO_EDIT_STYLE_ID);
    expect(style).not.toBeNull();
    expect(style?.textContent).toBe(CLICK_TO_EDIT_CSS);
    expect(doc.documentElement.classList.contains(CLICK_TO_EDIT_CLASS)).toBe(true);

    paintClickToEdit(doc, false);
    expect(doc.documentElement.classList.contains(CLICK_TO_EDIT_CLASS)).toBe(false);
    // 样式表留着（规则全挂在开关 class 底下，留着是空转）：反复开关不该反复增删节点。
    expect(doc.querySelectorAll(`#${CLICK_TO_EDIT_STYLE_ID}`)).toHaveLength(1);
  });

  it("样式选择器作用在纸面字段上，且只在开关打开时生效", () => {
    expect(CLICK_TO_EDIT_CSS).toContain(`.${CLICK_TO_EDIT_CLASS} [${CLICK_TO_EDIT_PATH_ATTR}]`);
    expect(CLICK_TO_EDIT_CSS).toContain("cursor:pointer");
    expect(CLICK_TO_EDIT_CSS).toContain(":hover");
  });

  it("文档没有 documentElement 时安全返回（iframe 还没解析完）", () => {
    expect(() => paintClickToEdit(null, true)).not.toThrow();
  });
});

describe("useClickToEditPreview · 绑定与去重", () => {
  function mount(options: { draftMode?: boolean; onPickField?: (path: string) => void } = {}) {
    const onPickField = options.onPickField ?? vi.fn();
    const view = renderHook(
      (props: { draftMode: boolean }) =>
        useClickToEditPreview({
          containerRef: emptyContainer(),
          draftMode: props.draftMode,
          onPickField: options.onPickField ?? onPickField,
        }),
      { initialProps: { draftMode: options.draftMode ?? true } },
    );
    // 复选框默认**不勾**（纸面突然能点会被当成误触），所以这些用例先替用户勾一下：
    // `active` = 勾选 + 草稿模式 + 宿主可用，三样缺一不可。
    act(() => view.result.current.setChecked(true));
    return { ...view, onPickField };
  }

  it("点命中字段：回调一次，并 preventDefault（但不吞掉冒泡）", () => {
    const { result, onPickField } = mount();
    const doc = paperDocument();
    const name = doc.querySelector(`[${CLICK_TO_EDIT_PATH_ATTR}]`) as HTMLElement;

    // 父节点上的监听仍要收到：文档里其它交互（文本选择等）不该被这一层拦掉。
    const bubbleProbe = vi.fn();
    doc.addEventListener("click", bubbleProbe);

    act(() => result.current.bindDocument(doc));
    const event = clickOn(name);

    expect(onPickField).toHaveBeenCalledWith("name");
    expect(event.defaultPrevented).toBe(true);
    expect(bubbleProbe).toHaveBeenCalledTimes(1);
  });

  it("同一个文档绑定 N 次只触发一次（onLoad 会反复触发）", () => {
    const { result, onPickField } = mount();
    const doc = paperDocument();
    const name = doc.querySelector(`[${CLICK_TO_EDIT_PATH_ATTR}]`) as HTMLElement;

    act(() => {
      result.current.bindDocument(doc);
      result.current.bindDocument(doc);
      result.current.bindDocument(doc);
    });
    clickOn(name);

    expect(onPickField).toHaveBeenCalledTimes(1);
  });

  it("点空白处不回调", () => {
    const { result, onPickField } = mount();
    const doc = paperDocument();
    act(() => result.current.bindDocument(doc));

    clickOn(doc.querySelector(".plain") as Element);
    clickOn(doc.body);

    expect(onPickField).not.toHaveBeenCalled();
  });

  it("没勾选 / 切到精确模式：监听还在，但不再回调", () => {
    const { result, onPickField, rerender } = mount({ draftMode: false });
    const doc = paperDocument();
    act(() => result.current.bindDocument(doc));

    clickOn(doc.querySelector(`[${CLICK_TO_EDIT_PATH_ATTR}]`) as Element);
    expect(onPickField).not.toHaveBeenCalled();
    // 生效值要为假，容器上的标记 class 才不会亮起来。
    expect(result.current.active).toBe(false);

    // 切回草稿后同一个文档立刻可用（不需要重新绑定）。
    rerender({ draftMode: true });
    clickOn(doc.querySelector(`[${CLICK_TO_EDIT_PATH_ATTR}]`) as Element);
    expect(onPickField).toHaveBeenCalledWith("name");
  });

  it("宿主没给 onPickField：整条链路不可用（复选框也不该出现）", () => {
    const { result } = renderHook(() =>
      useClickToEditPreview({ containerRef: emptyContainer(), draftMode: true }),
    );

    expect(result.current.available).toBe(false);
    expect(result.current.active).toBe(false);
  });

  it("绑定时就按当前勾选状态刷好样式与 class", () => {
    const { result } = mount();
    const doc = paperDocument();

    act(() => result.current.bindDocument(doc));

    expect(doc.documentElement.classList.contains(CLICK_TO_EDIT_CLASS)).toBe(true);
    expect(doc.getElementById(CLICK_TO_EDIT_STYLE_ID)).not.toBeNull();
  });
});

describe("useClickToEditPreview · 持久化", () => {
  it("记住勾选值：写到 localStorage 的那一条，重新挂载读回来", () => {
    const first = renderHook(() =>
      useClickToEditPreview({ containerRef: emptyContainer(), draftMode: true }),
    );
    expect(first.result.current.checked).toBe(false);

    act(() => first.result.current.setChecked(true));
    expect(first.result.current.checked).toBe(true);
    expect(localStorage.getItem(CLICK_TO_EDIT_STORAGE_KEY)).toBe("1");
    first.unmount();

    // 刷新页面 = 重新挂载：勾选值必须还在（默认不勾，但勾过的要留住）。
    const second = renderHook(() =>
      useClickToEditPreview({ containerRef: emptyContainer(), draftMode: true }),
    );
    expect(second.result.current.checked).toBe(true);

    act(() => second.result.current.setChecked(false));
    expect(localStorage.getItem(CLICK_TO_EDIT_STORAGE_KEY)).toBe("0");
  });

  it("坏值 / 读不到时一律当没勾（默认关闭）", () => {
    expect(readStoredClickToEdit()).toBe(false);

    localStorage.setItem(CLICK_TO_EDIT_STORAGE_KEY, "yes");
    expect(readStoredClickToEdit()).toBe(false);
  });

  it("挂文档时同时挂 click 与 wheel（收指针的副作用：滚轮也跟着落进 iframe）", () => {
    const onPickField = vi.fn();
    const view = renderHook(() =>
      useClickToEditPreview({ containerRef: emptyContainer(), draftMode: true, onPickField }),
    );
    act(() => view.result.current.setChecked(true));

    const doc = paperDocument();
    const spy = vi.spyOn(doc, "addEventListener");
    act(() => view.result.current.bindDocument(doc));

    expect(spy).toHaveBeenCalledWith("click", expect.any(Function));
    // 漏了 wheel 的后果：勾上编辑模式后，在纸面上滚滚轮整页纹丝不动
    // （原来 iframe 是 pointer-events:none，滚轮落在父容器上，能滚）。
    expect(spy).toHaveBeenCalledWith("wheel", expect.any(Function), { passive: false });
  });
});
