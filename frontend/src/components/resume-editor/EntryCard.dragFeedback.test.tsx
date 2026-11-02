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
import { t } from "../../i18n";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import type { ResumeDocument } from "../../types/resumeDocument";
import DocumentEditor from "./DocumentEditor";

/** chip 的无障碍名：目录标签 + 全角冒号 + 值。 */
function chipName(labelKey: Parameters<typeof t>[0], value: string): string {
  return `${t(labelKey)}\uFF1A${value}`;
}

/** 渲染并切到教育页签（三区卡 + 拖拽的用例都在这个板块上）。 */
function renderEducation(document: ResumeDocument = makeDocument()) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  render(<DocumentEditor document={document} onChange={onChange} onSelectPath={onSelectPath} />);
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return { onChange, onSelectPath };
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
  type: "dragstart" | "dragover" | "drop" | "dragend",
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

/** 当前画出来的插入线（`.is-drop-before` / `.is-drop-after`）数量。 */
function insertionLines(): number {
  return document.querySelectorAll(
    ".document-chip-slot.is-drop-before, .document-chip-slot.is-drop-after",
  ).length;
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
