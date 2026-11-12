// SPDX-License-Identifier: Apache-2.0
/**
 * v2 三区卡编辑器（DocumentEditor）的交互测试：
 * 三区渲染 / head 布局切换 / 隐藏 / 键盘等价拖拽 / 非法位置提示 / 选中展开编辑 /
 * 自建板块与 inline、text 两种 kind / 仅素材标注 / 页眉编辑 / 添加字段与条目。
 *
 * 断言里的界面文案一律走 `t()`（cjkRatchet 的 tests 口径统计中文 ByText：新增中文断言会变红）。
 */
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ResumeDocument, ResumeSection } from "../../../types/resumeDocument";
import { defaultSectionLayout, emptyDocument } from "../document";
import { dropRejectReason, locatePath } from "../document";
import { makeDocument } from "../document/documentFixtures";
import DocumentEditor from "./DocumentEditor";
import { DRAG_REJECT_COPY } from "./dragRejectCopy";

/** chip 的无障碍名：目录标签 + 全角冒号 + 值。 */
export function chipName(labelKey: Parameters<typeof t>[0], value: string): string {
  return `${t(labelKey)}\uFF1A${value}`;
}

export function renderEditor(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const onChange = vi.fn();
  const onSelectPath = vi.fn();
  const utils = render(
    <DocumentEditor
      document={document}
      onChange={onChange}
      onSelectPath={onSelectPath}
      {...props}
    />,
  );
  return { ...utils, onChange, onSelectPath };
}

/** 渲染后切到教育页签（默认停在「基本信息」；三区卡的断言都在教育板块上）。 */
export function renderEducation(
  document: ResumeDocument = makeDocument(),
  props: Partial<Parameters<typeof DocumentEditor>[0]> = {},
) {
  const result = renderEditor(document, props);
  fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
  return result;
}

export function lastDocument(onChange: ReturnType<typeof vi.fn>): ResumeDocument {
  const calls = onChange.mock.calls;
  return calls[calls.length - 1][0] as ResumeDocument;
}

function dropPayload(path: string) {
  return { dataTransfer: { getData: () => path, dropEffect: "move" } };
}

/** 极简 field item fixture（两处 ob_ 字面量共用；字段值与原内联字面量一致）。 */
export function plainField(
  id: string,
  key: string,
  value: string,
  placement: "body" | "hidden" = "body",
) {
  return {
    kind: "field" as const,
    id,
    key,
    label: "",
    value,
    placement,
    format: "text" as const,
    wrap: "none" as const,
    show_label: false,
    solo: false,
    source: null,
    body_style: "bullet" as const,
  };
}

export function makeSection(overrides: Partial<ResumeSection>): ResumeSection {
  return {
    key: "custom:abc",
    title: "",
    kind: "entries",
    layout: defaultSectionLayout(),
    entries: [],
    ...overrides,
  };
}

/** 行内板块的一条技能：name/level 是正文，category 是灰字（与公开目录默认位置一致）。 */
function skillEntry(id: string, name: string, level: string, category: string) {
  const field = (key: string, value: string, placement: "body" | "trail") => ({
    kind: "field" as const,
    id: `${id}-${key}`,
    key,
    label: "",
    value,
    placement,
    format: "text" as const,
    wrap: "none" as const,
    show_label: placement === "trail",
    solo: false,
    source: null,
    body_style: "bullet" as const,
  });
  return {
    id,
    hidden: false,
    lock_content: false,
    lock_layout: false,
    layout: { head: "split" as const },
    items: [
      field("name", name, "body"),
      field("level", level, "body"),
      field("category", category, "trail"),
    ],
  };
}

export function makeInlineSkillsDocument(): ResumeDocument {
  const document = makeDocument();
  document.sections.push(
    makeSection({
      key: "skills",
      kind: "inline",
      entries: [
        skillEntry("sk1", "TypeScript", "Advanced", "Language"),
        skillEntry("sk2", "Rust", "Beginner", "Language"),
        skillEntry("sk3", "SQL", "Advanced", "Tooling"),
      ],
    }),
  );
  return document;
}

export function inlineEntryIds(document: ResumeDocument): (string | null | undefined)[] {
  return (
    document.sections
      .find((section) => section.key === "skills")
      ?.entries.map((entry) => entry.id) ?? []
  );
}

describe("DocumentEditor 三区卡", () => {
  it("渲染基础信息页签 + 三个区 + 标题/元信息 chip", () => {
    renderEducation();
    expect(screen.getByRole("tab", { name: t("document.basic.title") })).toBeInTheDocument();
    expect(screen.getAllByText(t("document.zone.head")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("document.zone.detail")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("document.zone.body")).length).toBeGreaterThan(0);
    expect(
      screen.getByRole("group", {
        name: chipName("editor.field.school", "Tsinghua University"),
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("group", {
        name: chipName("editor.field.major", "Computer Science"),
      }),
    ).toBeInTheDocument();
  });

  it("head 布局图标按钮切换为「上下」并写回文档", () => {
    const { onChange } = renderEducation();
    // R-05 ⑤：三选一从 Segmented 改成三个图标按钮，可访问名仍是那三个词。
    fireEvent.click(
      screen.getAllByRole("button", { name: t("document.entry.headLayout.stacked") })[0],
    );
    expect(lastDocument(onChange).sections[0].entries[0].layout.head).toBe("stacked");
  });

  it("键盘等价拖拽：Enter 拿起 → ArrowDown → Enter 确认，同组顺序换了", () => {
    const { onChange } = renderEducation();
    const chip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(chip).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.keyDown(main, { key: "ArrowDown" });
    fireEvent.keyDown(main, { key: "Enter" });
    const titles = lastDocument(onChange)
      .sections[0].entries[0].items.filter(
        (item) => (item as { placement?: string }).placement === "title",
      )
      .map((item) => (item as { key?: string }).key);
    expect(titles).toEqual(["major", "school"]);
  });

  it("键盘移动越界给可读提示（不静默失败）", () => {
    renderEducation();
    const courseChip = screen.getByRole("group", {
      name: new RegExp(t("editor.field.courses")),
    });
    const main = within(courseChip).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "Enter" });
    fireEvent.keyDown(main, { key: "ArrowUp" });
    expect(screen.getByText(t("document.drag.boundary"))).toBeInTheDocument();
  });

  it("跨方框拖放被拒绝：lead 的绩点拖进正文区给提示、不改文档", () => {
    // 2026-11-02 判定：正文只放正文块。字段进 body 会变成"中栏同时长出两套控件、纸面被静默
    // 丢弃"，所以直接拒绝（白名单里已没有 body），并给可读提示。
    //
    // 问题 13 之后拒绝原因拆成 4 种（`DRAG_REJECT_COPY` 是文案的唯一真源），这条用例原来
    // 钉的是"合并成一句"的旧 key `document.drag.invalid`，于是改文案就假红。现在断言
    // 「真实路径 → 实际原因（`dropRejectReason`）→ 那张表 → `t()`」这条链：
    // 文案改字、原因改归属，测试都不用跟着改；而"跨方框进正文块区 = illegalBody"这条
    // **语义**仍然被钉住（`expect(reason).toBe("illegalBody")`）。
    const doc = makeDocument();
    const { onChange } = renderEducation(doc);
    const located = locatePath(doc, "education.ob_entry001.ob_item0005");
    if (!located || located.kind !== "item") throw new Error("夹具里找不到 lead 的绩点条目");
    const reason = dropRejectReason(located.item, "body");
    if (!reason) throw new Error("正文块区本该被判为非法落点");
    expect(reason).toBe("illegalBody");
    // 真实路径：把 `drop` 事件真的打进正文块区（不是直接调函数）。
    const bodyZone = document.querySelector('[data-document-zone="body"]') as HTMLElement;
    fireEvent.drop(bodyZone, dropPayload("education.ob_entry001.ob_item0005"));
    expect(screen.getByText(t(DRAG_REJECT_COPY[reason]))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("可由鼠标拖动：非 text 的 item chip 带 draggable", () => {
    renderEducation();
    const chip = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(chip).getAllByRole("button")[0];
    expect(main).toHaveAttribute("draggable", "true");
  });

  it("正文块的 draggable 只挂把手，主按钮不拖（问题 12）", () => {
    const { container } = renderEducation();
    const chip = container.querySelector('[data-item-kind="text"]') as HTMLElement;
    const [handle, main] = within(chip).getAllByRole("button");
    expect(handle).toHaveAttribute("draggable", "true");
    expect(handle).toHaveAccessibleName(t("document.item.drag"));
    // 正文块的主体是可编辑文本的入口：整块可拖会把「拖选一句话里几个字」变成「拖走整块」。
    expect(main).toHaveAttribute("draggable", "false");
  });

  it("chip 里不许起选区，但字段值输入框照旧能选中文字", () => {
    // 「松开鼠标以搜索文本」只由选区触发：chip 上任何一段文字能选出选区，拖动就会被
    // 浏览器判成"拖动选中文字"。容器上的 selectstart 拦截必须生效，而且**只**在 chip 里；
    // 字段值 textarea 属于"要打字的地方"，必须放行（否则拖选几个字改都没法改）。
    const { container } = renderEducation(makeDocument());
    const chip = container.querySelector(".document-chip") as HTMLElement;
    expect(chip).not.toBeNull();

    const chipSelect = new Event("selectstart", { bubbles: true, cancelable: true });
    chip.dispatchEvent(chipSelect);
    expect(chipSelect.defaultPrevented).toBe(true);

    // F2 = 键盘展开字段编辑器（与双击同路），拿到 chip 下方的值输入框。
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    fireEvent.keyDown(within(school).getAllByRole("button")[0], { key: "F2" });
    const editor = screen.getByLabelText(t("document.field.value"));
    const inputSelect = new Event("selectstart", { bubbles: true, cancelable: true });
    editor.dispatchEvent(inputSelect);
    expect(inputSelect.defaultPrevented).toBe(false);
  });

  it("按住把手**不**拦 mousedown 默认行为，拖拽载荷仍是 move", () => {
    // 2026-11-04 用户实测「正文块拖不动」：上一版在把手 `mousedown` 里
    // `preventDefault()`，Chrome 连 HTML5 拖拽的起点一起吃掉——`dragstart` 根本不触发
    // （自动化实测 dragstart 计数 0）。防选区不能靠它：`user-select: none` 加容器上的
    // `selectstart` 拦截已经够了，且不碰默认拖拽。
    const { container } = renderEducation();
    const chip = container.querySelector('[data-item-kind="text"]') as HTMLElement;
    const [handle] = within(chip).getAllByRole("button");

    const down = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    handle.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);

    const setData = vi.fn();
    const dragStart = new Event("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(dragStart, "dataTransfer", {
      value: { setData, effectAllowed: "none" },
    });
    handle.dispatchEvent(dragStart);
    expect(setData).toHaveBeenCalledWith("text/plain", expect.any(String));
    expect(
      (dragStart as unknown as { dataTransfer: { effectAllowed: string } }).dataTransfer
        .effectAllowed,
    ).toBe("move");
  });

  it("只读模式下正文块没有拖拽把手（问题 12）", () => {
    const { container } = renderEducation(makeDocument(), { readOnly: true });
    const chip = container.querySelector('[data-item-kind="text"]') as HTMLElement;
    const buttons = within(chip).getAllByRole("button");
    expect(buttons.some((button) => button.getAttribute("draggable") === "true")).toBe(false);
  });

  it("拖到非法位置（list item → 标题行）给提示且不改文档", () => {
    const { onChange } = renderEducation();
    const titleZone = document.querySelector('[data-document-zone="title"]') as HTMLElement;
    fireEvent.drop(titleZone, dropPayload("education.ob_entry001.ob_item0004"));
    expect(screen.getByText(t("document.drag.invalid"))).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("点击 chip 上报选中路径", () => {
    const { onSelectPath } = renderEducation();
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const major = screen.getByRole("group", {
      name: chipName("editor.field.major", "Computer Science"),
    });
    fireEvent.click(within(school).getAllByRole("button")[0]);
    expect(onSelectPath).toHaveBeenCalledWith("education.ob_entry001.ob_item0001");
    fireEvent.click(within(major).getAllByRole("button")[0]);
    expect(onSelectPath).toHaveBeenCalledWith("education.ob_entry001.ob_item0002");
  });

  it("#8：单击只选中（不展开）；双击展开、再双击收起并保持选中", () => {
    const { onSelectPath } = renderEditor(makeDocument());
    fireEvent.click(screen.getByRole("tab", { name: t("editor.section.education") }));
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(school).getAllByRole("button")[0];
    // 单击只选中（上报 path、无编辑器）；双击展开；再双击收起且保持选中。
    fireEvent.click(main);
    expect(onSelectPath).toHaveBeenLastCalledWith("education.ob_entry001.ob_item0001");
    expect(screen.queryByLabelText(t("document.field.value"))).toBeNull();
    fireEvent.doubleClick(main);
    expect(main).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(t("document.field.value"))).toBeInTheDocument();
    // 再双击：收起编辑器，选中保持。
    fireEvent.doubleClick(main);
    expect(main).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByLabelText(t("document.field.value"))).toBeNull();
    expect(onSelectPath).toHaveBeenLastCalledWith("education.ob_entry001.ob_item0001");
  });

  it("#8：受控选中后 F2 展开编辑器（值输入框可用）", () => {
    const { onChange } = renderEditor(makeDocument(), {
      selectedPath: "education.ob_entry001.ob_item0001",
    });
    const school = screen.getByRole("group", {
      name: chipName("editor.field.school", "Tsinghua University"),
    });
    const main = within(school).getAllByRole("button")[0];
    fireEvent.keyDown(main, { key: "F2" });
    const input = screen.getByLabelText(t("document.field.value")) as HTMLInputElement;
    expect(input.value).toBe("Tsinghua University");
    fireEvent.change(input, { target: { value: "Peking University" } });
    const first = lastDocument(onChange).sections[0].entries[0].items[0] as { value: string };
    expect(first.value).toBe("Peking University");
  });

  it("条目动作：添加条目追加到板块末尾", () => {
    const { onChange } = renderEducation();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.entry.add")) }));
    expect(lastDocument(onChange).sections[0].entries).toHaveLength(3);
  });
});

describe("DocumentEditor 空文档与只读", () => {
  it("空文档显示基本信息与空页眉提示（不崩）", () => {
    renderEditor(emptyDocument());
    expect(screen.getByRole("tab", { name: t("document.basic.title") })).toBeInTheDocument();
    expect(screen.getByText(t("document.basic.empty"))).toBeInTheDocument();
  });

  it("readOnly 时不渲染隐藏/移除按钮与添加入口", () => {
    renderEditor(makeDocument(), { readOnly: true });
    expect(screen.queryByRole("button", { name: t("document.item.hide") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("document.entry.add") })).toBeNull();
  });

  // #3：选中定位只滚编辑器自己的容器，不再 scrollIntoView（会连带抬起整个工作台）。
  it("选中定位不调用 scrollIntoView", async () => {
    const { container } = renderEditor(makeDocument(), {
      selectedPath: "education.ent_edu1",
      revealNonce: 1,
    });
    const root = container.querySelector(".document-editor") as HTMLElement;
    const scrollIntoView = vi.fn();
    Object.defineProperty(root, "scrollHeight", { value: 5000, configurable: true });
    Object.defineProperty(root, "clientHeight", { value: 1000, configurable: true });
    const target = (container.querySelector('[data-document-entry="education.ent_edu1"]') ||
      container.querySelector('[data-document-path="education.ent_edu1"]')) as HTMLElement | null;
    if (target) target.scrollIntoView = scrollIntoView;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
