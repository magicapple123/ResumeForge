// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动中的**悬停几何反馈环**回归（用户反馈：拖动时被拖条目反复跳动、松手落错位置）。
 *
 * 真机形态（Chrome）：拖动中整棵树 `pointer-events:none`，dragover 的目标是树容器，
 * 悬停目标由 `useOutlineDragDrop` 按行中心与指针的纵向距离计算。旧实现把"离指针最近的行"
 * 直接当目标——预览把被拖行挪到指针下之后，被拖行自己成为最近行，而它被映射回**起始下标**，
 * 于是每次 dragover 都在
 *   预览到目标位置 → 自己成为最近行 → 弹回起始位置 → 目标行又成为最近行
 * 之间循环（真机 2.4s 内实测到约 30 次来回）。修法：被拖行自己不产生目标；
 * 目标行没换不更新；切换目标要越过滞回带。
 *
 * jsdom 没有布局，这里给树行装一个**随 CSS order 变化**的 getBoundingClientRect，
 * 用同一套行高/行距模拟"预览换位 → 几何变化"的真实反馈链。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";

/** 与 outline.css 的条目行一致：28px 高、行距 28px。 */
const ROW_HEIGHT = 28;
const ROW_TOP = 500;

/** 第 slot 个可视槽位的行中心（预览换位靠 CSS order，槽位几何只由 order 决定）。 */
function slotCenterY(slot: number): number {
  return ROW_TOP + slot * ROW_HEIGHT + ROW_HEIGHT / 2;
}

function domRect(top: number, height: number): DOMRect {
  return {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 320,
    width: 320,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

/**
 * 给树行装上"模拟浏览器布局"的 getBoundingClientRect：
 * 项目条目按 `style.order`（视觉槽位）定位，其余行放到视口外（落点解析只按同类行算距离）。
 * 元素节点在拖动中稳定（DOM 不重排），实例方法装上后跨 re-render 一直有效。
 */
function stubProjectLayout(): void {
  const projectEntries = Array.from(
    document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
  );
  const slotOf = new Map<string, () => number>();
  projectEntries.forEach((element, domIndex) => {
    slotOf.set(element.dataset.treeKey ?? "", () => {
      const raw = element.style.order;
      return raw === "" ? domIndex : Number(raw);
    });
  });
  for (const element of document.querySelectorAll<HTMLElement>("[data-tree-key]")) {
    element.getBoundingClientRect = () => {
      const slot = slotOf.get(element.dataset.treeKey ?? "");
      if (!slot) return domRect(3000, ROW_HEIGHT);
      return domRect(ROW_TOP + slot() * ROW_HEIGHT, ROW_HEIGHT);
    };
  }
}

function makeContent(): ResumeContent {
  return ensureIds({
    photo: "",
    name: "张三",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [],
    campus_experience: [],
    projects: [
      {
        name: PROJECT_A,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["甲一"],
        highlights: [],
      },
      {
        name: PROJECT_B,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["乙一"],
        highlights: [],
      },
      {
        name: PROJECT_C,
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: ["丙一"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function byVisualOrder(elements: HTMLElement[]): HTMLElement[] {
  return elements
    .map((element, index) => ({
      element,
      index,
      order: element.style.order === "" ? index : Number(element.style.order),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.element);
}

/** 条目顺序（读视觉顺序：拖动中 DOM 稳定、换位靠 CSS order）。 */
function entryOrder(): string[] {
  return byVisualOrder(
    Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]')),
  ).map((element) => element.querySelector(".resume-outline-title")?.textContent ?? "");
}

function entryHandle(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
}

/**
 * jsdom 没有 DragEvent，RTL 会退化成普通 Event 而丢掉 clientY——几何悬停必须拿到真实坐标，
 * 所以这里自己建事件并把 clientY / dataTransfer 挂上去。
 */
function fireDragAt(
  type: "dragover" | "drop",
  element: Element,
  dataTransfer: DataTransfer,
  clientY: number,
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientY", { value: clientY });
  Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
  fireEvent(element, event);
}

/** 最小 dataTransfer 桩（与 OutlinePanel.drag.test.tsx 同一份）。 */
function dragData(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    clearData: () => store.clear(),
    dropEffect: "move",
    effectAllowed: "move",
    files: [],
    items: [],
    types: [],
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

function renderPanel() {
  const initial = makeContent();
  const commands: OutlineCommand[] = [];
  const previews: (ResumeContent | null)[] = [];
  function Harness() {
    const [content, setContent] = useState<ResumeContent>(initial);
    return (
      <AntdApp>
        <OutlinePanel
          content={content}
          onCommand={(command, baseContent) => {
            commands.push(command);
            const result = applyOutlineCommand(baseContent, command);
            if (result.ok) setContent(result.content);
          }}
          onStructurePreview={(next) => previews.push(next)}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  stubProjectLayout();
  return { initial, commands, previews };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("拖动悬停：预览不能自己驱动自己", () => {
  it("指针停在目标行上：连续 dragover 不再把被拖行弹回原位，预览只换一次", () => {
    const { commands, previews } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    // 指针停在"项目丙"原本的行中心：预览把项目乙换到第 3 个槽位。
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    const previewCalls = previews.length;

    const seen = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(2) + (index % 2 === 0 ? 0 : 1));
      seen.add(entryOrder().join("|"));
    }

    expect([...seen]).toEqual([[PROJECT_A, PROJECT_C, PROJECT_B].join("|")]);
    // 稳定后不再产生新的结构预览（旧实现每次 dragover 都会重算一次）。
    expect(previews.length).toBe(previewCalls);
    expect(commands).toHaveLength(0);
  });

  it("指针在行边界附近 ±1px 抖动：目标不来回切换", () => {
    const { previews } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    const previewCalls = previews.length;

    // 第 2/3 槽位的边界：指针停在中线上再做 ±1px 手抖。
    const boundaryY = slotCenterY(2) - ROW_HEIGHT / 2;
    for (let index = 0; index < 10; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, boundaryY + (index % 2 === 0 ? 0 : 1));
    }

    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    expect(previews.length).toBe(previewCalls);
  });

  it("指针明显移到另一行时仍会切换目标（排序能力不变）", () => {
    renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);

    fireDragAt("dragover", tree, dataTransfer, slotCenterY(0));
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 停在新的目标位置后同样稳定。
    for (let index = 0; index < 6; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(0));
    }
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);
  });

  it("松手只落最后预览顺序：抖动结束后 drop 提交到目标下标", () => {
    const { commands } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    for (let index = 0; index < 8; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    }
    fireDragAt("drop", tree, dataTransfer, slotCenterY(2));

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      toIndex: 2,
    });
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
  });
});
