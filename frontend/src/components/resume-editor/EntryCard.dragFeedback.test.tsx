// SPDX-License-Identifier: Apache-2.0
/**
 * 拖拽的**可读反馈**（任务 9 / 第二轮返工缺陷 D2 / 问题 13 改为「禁止光标 + dragend 兜底」）。
 *
 * 问题 13 之前：所有落点都 `preventDefault` + `dropEffect="move"`，于是 no-op 落点也画一条
 * 蓝色插入线，松手却什么都没发生；非法落点还显示"可放"的光标。
 *
 * 现在：
 * 1. 位置非法 / 插完不动 → `dropEffect="none"`（禁止光标）+ 不画线，浏览器**不派发 `drop`**；
 * 2. 因此拒绝文案由拖拽源的 `dragend` 给，判据是目标位记下的原因，不是 `dataTransfer.dropEffect`；
 * 3. 合法落点照旧 `drop` 换位，且 `toIndex` 只有一份实现（`resolveDropIndex`）。
 *
 * 夹具自己建（不 import `DocumentEditor.test.tsx`：那会把别人的用例重复注册一遍）。
 * 断言里的界面文案一律走 `t()`（cjkRatchet 的 tests 口径统计中文 ByText）。
 */
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { t } from "../../i18n";
import { makeDocument, textItem } from "../../features/resume-document/documentFixtures";
import type { ResumeDocument } from "../../types/resumeDocument";
import DocumentEditor from "./DocumentEditor";

declare const process: { cwd(): string };

/** chip 的无障碍名：目录标签 + 全角冒号 + 值。 */
function chipName(labelKey: Parameters<typeof t>[0], value: string): string {
  return `${t(labelKey)}\uFF1A${value}`;
}

/** 渲染并切到教育页签（三区卡 + 拖拽的用例都在这个板块上）。 */
function renderEducation(document: ResumeDocument = makeDocument()) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const view = render(
    <DocumentEditor document={document} onChange={onChange} onSelectPath={onSelectPath} />,
  );
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return { onChange, onSelectPath, container: view.container };
}

/** 极简 DataTransfer 替身：jsdom 没有真实现，事件里手工塞一个就够（handler 只读写这几项）。 */
function makeDataTransfer() {
  const store: Record<string, string> = {};
  return {
    dropEffect: "none",
    effectAllowed: "none",
    setData: (type: string, value: string) => {
      store[type] = value;
    },
    getData: (type: string) => store[type] ?? "",
    setDragImage: () => undefined,
  };
}

/**
 * 派发一次拖拽事件，返回"默认行为是否**没有**被取消"。
 *
 * 不用 `fireEvent.dragOver` 的两个原因：jsdom 没有 `DragEvent`，RTL 退回 `Event` 构造，
 * `clientX` 会被丢掉（左右半边就判不出来）；而且这里需要读 `defaultPrevented` 本身
 * ——它正是"浏览器会不会派发 drop"的判据。
 */
function dispatchDrag(
  node: Element,
  type: "dragstart" | "dragover" | "drop" | "dragend" | "dragleave",
  dataTransfer: ReturnType<typeof makeDataTransfer>,
  clientX = 0,
): boolean {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: clientX });
  Object.defineProperty(event, "clientY", { value: 8 });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  let notCancelled = true;
  act(() => {
    notCancelled = node.dispatchEvent(event);
  });
  return notCancelled;
}

/** chip 主体按钮（真实拖拽里 `draggable` 的那个元素）。 */
function chipMain(labelKey: Parameters<typeof t>[0], value: string): HTMLElement {
  const group = screen.getByRole("group", { name: chipName(labelKey, value) });
  return within(group).getAllByRole("button")[0];
}

/** 某个 item 的落点槽（`onDragOver` / `onDrop` 挂在它身上）。 */
function slot(path: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(
    `.document-chip-slot[data-document-path="${path}"]`,
  );
  if (!element) throw new Error(`找不到 chip 槽：${path}`);
  return element;
}

/** 给槽位一个确定的矩形，让"左半边 / 右半边"可判（jsdom 里 rect 全是 0）。 */
function mockRect(element: HTMLElement, width = 100): void {
  element.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width, height: 20, right: width, bottom: 20, x: 0, y: 0 }) as DOMRect;
}

function zoneOf(placement: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-document-zone="${placement}"]`);
  if (!element) throw new Error(`找不到方框：${placement}`);
  return element;
}

/** 上次 onChange 收到的文档。 */
function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

const SCHOOL = "education.ob_entry001.ob_item0001";
const MAJOR = "education.ob_entry001.ob_item0002";
const GPA = "education.ob_entry001.ob_item0005";
const BODY = "education.ob_entry001.ob_item0006";

/** 当前画出来的插入线（`.is-drop-before` / `.is-drop-after`）数量。 */
function insertionLines(): number {
  return document.querySelectorAll(
    ".document-chip-slot.is-drop-before, .document-chip-slot.is-drop-after",
  ).length;
}

/** 当前带禁用色描边的槽数量（问题 21a）。 */
function rejectedSlots(): number {
  return document.querySelectorAll(".document-chip-slot.is-drop-rejected").length;
}

/**
 * 整框虚线的数量（问题 21a 的互斥判据）。
 *
 * 两个口径都要数：`title/meta/lead/trail` 是 `EntryZoneGroup` 的 `.document-group-block`，
 * `hidden/body` 是 `EntryCard` 自己的 `.document-zone`。
 */
function zoneHighlights(): number {
  return document.querySelectorAll(".document-zone.is-dragover, .document-group-block.is-dragover")
    .length;
}

/** 正文块 chip 的把手（唯一 `draggable` 的那枚按钮）。 */
function bodyHandle(): HTMLElement {
  const chip = document.querySelector<HTMLElement>('[data-item-kind="text"]');
  if (!chip) throw new Error("找不到正文块 chip");
  const handle = within(chip)
    .getAllByRole("button")
    .find((button) => button.getAttribute("draggable") === "true");
  if (!handle) throw new Error("正文块没有拖拽把手");
  return handle;
}

/** 正文块数量可控的文档（页签与条目沿用 `makeDocument` 的第一条教育经历）。 */
function documentWithBodyBlocks(count: number): ResumeDocument {
  const base = makeDocument();
  const first = base.sections[0].entries[0];
  const items = first.items.filter((item) => item.kind !== "text");
  const blocks = Array.from({ length: count }, (_, index) =>
    textItem({ id: `ob_text000${index + 1}`, text: `Body block ${index + 1}` }),
  );
  return {
    ...base,
    sections: [
      { ...base.sections[0], entries: [{ ...first, items: [...items, ...blocks] }] },
      base.sections[1],
    ],
  };
}

/** 组件的落点样式原文（jsdom 不求值，只能断言规则本身）。 */
function dropCss(): string {
  return readFileSync(
    [process.cwd(), "src", "components", "resume-editor", "document-item-editor.css"].join("/"),
    "utf8",
  );
}

/** 样式表里的另一份（`.document-chip-handle` 的基线与整框高亮都在这里）。 */
function editorCss(): string {
  return readFileSync(
    [process.cwd(), "src", "components", "resume-editor", "document-editor.css"].join("/"),
    "utf8",
  );
}

/** 取某条选择器的规则块（第一个 `{ ... }`），找不到返回空串。 */
function block(source: string, selector: string): string {
  const pattern = new RegExp(
    `${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`,
    "u",
  );
  return pattern.exec(source)?.[1] ?? "";
}

describe("EntryCard 拖拽落点反馈", () => {
  it("落在别的字段左半边（= 原槽位）：dragover 就拦住（禁止光标、不画线），dragend 给「已经在这个位置」", () => {
    const { onChange } = renderEducation();
    // 真实时序：先 dragstart 记下"被拿起的是学校"，再在专业槽上 dragover / dragend。
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    mockRect(slot(MAJOR));
    // 返回 false = 默认行为已被取消；dropEffect="none" = 浏览器显示禁止光标且**不派发 drop**。
    expect(dispatchDrag(slot(MAJOR), "dragover", dataTransfer, 10)).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    // 关键断言（问题 13 新增）：no-op 落点在 dragover 阶段就**不画插入线**。
    expect(insertionLines()).toBe(0);

    dispatchDrag(source, "dragend", dataTransfer);
    expect(screen.getByText(t("document.drag.samePosition"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("拖到自己身上（原槽位）：同样禁止光标 + dragend 给「已经在这个位置」，不静默", () => {
    const { onChange } = renderEducation();
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    mockRect(slot(SCHOOL));
    expect(dispatchDrag(slot(SCHOOL), "dragover", dataTransfer, 10)).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(insertionLines()).toBe(0);
    dispatchDrag(source, "dragend", dataTransfer);
    expect(screen.getByText(t("document.drag.samePosition"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("跨方框（标题行 → 正文前灰字段）：禁止光标，dragend 给「不能放到这里」", () => {
    const { onChange } = renderEducation();
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    mockRect(slot(GPA));
    expect(dispatchDrag(slot(GPA), "dragover", dataTransfer, 90)).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    expect(insertionLines()).toBe(0);
    dispatchDrag(source, "dragend", dataTransfer);
    expect(screen.getByText(t("document.drag.illegalTitle"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("跨方框（标题行 → 正文块区）：禁止光标，dragend 给「正文块区」那条文案", () => {
    const { onChange } = renderEducation();
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    // 字段本身允许 placement=body，拒绝原因是"跨方框"，所以文案是 illegalBody 而不是 invalid。
    expect(dispatchDrag(zoneOf("body"), "dragover", dataTransfer)).toBe(false);
    expect(dataTransfer.dropEffect).toBe("none");
    dispatchDrag(source, "dragend", dataTransfer);
    expect(screen.getByText(t("document.drag.illegalBody"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("拖到本位置组的空白处且已在末尾：方框高亮保持放行，drop 给「已经在这个位置」", () => {
    const { onChange } = renderEducation();
    // 专业是标题行里最后一个：落到标题组的空白处 = 追加到末尾 = 顺序不变。
    const dataTransfer = makeDataTransfer();
    dispatchDrag(chipMain("editor.field.major", "Computer Science"), "dragstart", dataTransfer);
    // 方框级落点不改成禁止（清单问题 13 方案 5）：它靠整组淡蓝底 + 虚线指示，够明确。
    dispatchDrag(zoneOf("title"), "dragover", dataTransfer);
    expect(dataTransfer.dropEffect).toBe("move");
    dispatchDrag(zoneOf("title"), "drop", dataTransfer);
    expect(screen.getByText(t("document.drag.samePosition"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("非法落点被拒绝后不会再补一条「字段位置已更新」（drop 与 dragend 不重复提示）", () => {
    const { onChange } = renderEducation();
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    mockRect(slot(GPA));
    dispatchDrag(slot(GPA), "dragover", dataTransfer, 90);
    dispatchDrag(source, "dragend", dataTransfer);
    expect(screen.queryByText(t("document.drag.moved"))).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("合法落点照旧换位：学校拖到专业右半边（dragend 不再补提示）", () => {
    const { onChange } = renderEducation();
    const dataTransfer = makeDataTransfer();
    const source = chipMain("editor.field.school", "Tsinghua University");
    dispatchDrag(source, "dragstart", dataTransfer);
    mockRect(slot(MAJOR));
    dispatchDrag(slot(MAJOR), "dragover", dataTransfer, 90);
    expect(dataTransfer.dropEffect).toBe("move");
    expect(insertionLines()).toBe(1);
    dispatchDrag(slot(MAJOR), "drop", dataTransfer, 90);
    dispatchDrag(source, "dragend", dataTransfer);
    const titles = lastDocument(onChange)
      .sections[0].entries[0].items.filter(
        (item) => (item as { placement?: string }).placement === "title",
      )
      .map((item) => (item as { key?: string }).key);
    expect(titles).toEqual(["major", "school"]);
    expect(screen.queryByText(t("document.drag.samePosition"))).toBeNull();
  });
});

/**
 * 问题 21a：三种落点指示必须**互斥且唯一**。
 *
 * 这些用例钉的是"状态"而不是像素：jsdom 量不出 3px 线宽，但"几处指示同时存在"完全可以数。
 */
describe("落点指示的唯一性（问题 21）", () => {
  it("非法落点：目标槽只有禁用色描边，没有蓝条、也没有整框虚线", () => {
    renderEducation();
    const dataTransfer = makeDataTransfer();
    dispatchDrag(chipMain("editor.field.school", "Tsinghua University"), "dragstart", dataTransfer);
    mockRect(slot(GPA));
    // 标题行 → 正文前灰字段：跨方框，必然被拒。
    dispatchDrag(slot(GPA), "dragover", dataTransfer, 90);
    expect(slot(GPA).className).toContain("is-drop-rejected");
    expect(slot(GPA).className).not.toMatch(/is-drop-(before|after)/);
    expect(insertionLines()).toBe(0);
    expect(zoneHighlights()).toBe(0);
    expect(rejectedSlots()).toBe(1);
  });

  it("移开被拒的槽就清掉描边（否则描边会留在原地）", () => {
    renderEducation();
    const dataTransfer = makeDataTransfer();
    dispatchDrag(chipMain("editor.field.school", "Tsinghua University"), "dragstart", dataTransfer);
    mockRect(slot(GPA));
    dispatchDrag(slot(GPA), "dragover", dataTransfer, 90);
    expect(rejectedSlots()).toBe(1);
    dispatchDrag(slot(GPA), "dragleave", dataTransfer);
    expect(rejectedSlots()).toBe(0);
  });

  it("合法落点：只有一条蓝条，整框虚线同时归零（钉住 21a 的复位）", () => {
    renderEducation();
    const dataTransfer = makeDataTransfer();
    dispatchDrag(chipMain("editor.field.school", "Tsinghua University"), "dragstart", dataTransfer);
    // 先落在标题组的空白处：整框虚线亮（这一步是"从空白进 chip"的前半段）。
    dispatchDrag(zoneOf("title"), "dragover", dataTransfer);
    expect(zoneHighlights()).toBe(1);
    // 再压到专业 chip 的右半边：蓝条出现，虚线必须**同时**消失。
    mockRect(slot(MAJOR));
    dispatchDrag(slot(MAJOR), "dragover", dataTransfer, 90);
    expect(slot(MAJOR).className).toContain("is-drop-after");
    expect(insertionLines()).toBe(1);
    expect(zoneHighlights()).toBe(0);
    expect(rejectedSlots()).toBe(0);
  });

  it("正文底层：空白 → chip → 空白，虚线与蓝条/描边轮流出现，没有一帧并存", () => {
    renderEducation();
    const dataTransfer = makeDataTransfer();
    // 正文块的唯一拖拽源是把手上（主体 `draggable=false`，见 DocumentEditor.test.tsx）。
    dispatchDrag(bodyHandle(), "dragstart", dataTransfer);

    dispatchDrag(zoneOf("body"), "dragover", dataTransfer);
    expect(zoneOf("body").className).toContain("is-dragover");
    expect(insertionLines()).toBe(0);
    expect(rejectedSlots()).toBe(0);

    // 压到自己的槽上 = no-op → 描边，虚线当帧消失。
    mockRect(slot(BODY));
    dispatchDrag(slot(BODY), "dragover", dataTransfer, 10);
    expect(slot(BODY).className).toContain("is-drop-rejected");
    expect(zoneOf("body").className).not.toContain("is-dragover");

    // 真的离开槽（浏览器会派发 dragleave）再回到空白处：描边清掉、虚线回来。
    dispatchDrag(slot(BODY), "dragleave", dataTransfer);
    expect(rejectedSlots()).toBe(0);
    dispatchDrag(zoneOf("body"), "dragover", dataTransfer);
    expect(zoneOf("body").className).toContain("is-dragover");
    expect(insertionLines()).toBe(0);
    expect(rejectedSlots()).toBe(0);
  });
});

/** 问题 21b：正文块的把手热区；以及落点样式的"只有一个来源"。 */
describe("落点样式与把手热区（问题 21）", () => {
  it("蓝条只有一处定义，且不吃指针事件（不挡命中）", () => {
    const bar = block(
      dropCss(),
      ".document-chip-slot.is-drop-before::before,\n.document-chip-slot.is-drop-after::after",
    );
    expect(bar).toContain("background: var(--rf-accent");
    expect(bar).toContain("pointer-events: none");
    // 另一份样式表不许再画第二套插入线（两套来源正是"时有时无"的土壤）。
    expect(editorCss()).not.toContain("is-drop-before");
    expect(editorCss()).not.toContain("is-drop-after");
  });

  it("被拒的槽用禁用色虚线描边，不做填充，也不用硬编码色值", () => {
    const rejected = block(dropCss(), ".document-chip-slot.is-drop-rejected > .document-chip");
    expect(rejected).toContain("outline: 1px dashed var(--rf-danger)");
    expect(rejected).toContain("outline-offset: 2px");
    // 红底填充/实线会被读成"选中"或"报错"，这里刻意都不用。
    expect(rejected).not.toContain("background");
    expect(rejected).not.toContain("box-shadow");
    expect(rejected).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  it("把手用 padding + 负 margin 把热区撑到 24×24 而排版不动", () => {
    const handle = block(dropCss(), ".document-chip > .document-chip-handle");
    expect(handle).toContain("padding: 5px");
    expect(handle).toContain("margin: -5px");
    // 基线规则必须还在（display/flex 决定它在 chip 里的位置，不能只留热区）。
    expect(block(editorCss(), ".document-chip-handle")).toContain("display: inline-flex");
  });

  it("正文块主体仍是不可拖的，把手才可拖（整块可拖会破坏拖选文字）", () => {
    const { container } = renderEducation();
    const chip = container.querySelector<HTMLElement>('[data-item-kind="text"]');
    if (!chip) throw new Error("找不到正文块 chip");
    const [handle, main] = within(chip).getAllByRole("button");
    expect(handle).toHaveAttribute("draggable", "true");
    expect(main).toHaveAttribute("draggable", "false");
  });
});

/** 问题 21b：正文块的可拖入口只有 14px，界面上必须说得出来。 */
describe("正文区的调整顺序提示（问题 21）", () => {
  it("正文只有 1 块时不显示（没有可调的顺序，提示只会制造疑问）", () => {
    renderEducation();
    expect(screen.queryByText(t("document.zone.bodyHint"))).toBeNull();
  });

  it("正文 ≥2 块时显示把手 / 方向键提示", () => {
    renderEducation(documentWithBodyBlocks(2));
    expect(screen.getByText(t("document.zone.bodyHint"))).toBeInTheDocument();
  });
});
