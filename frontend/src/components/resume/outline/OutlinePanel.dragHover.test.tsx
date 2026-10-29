// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动中的**悬停几何 / 落点一致性**回归（用户反馈：拖动时被拖条目反复跳动、松手落错位置）。
 *
 * 真机形态（Chrome）：拖动中整棵树 `pointer-events:none`，dragover 的目标是树容器，
 * 悬停目标由 `useOutlineDragDrop` 按**行矩形（band）**判定：
 * 1. 被拖行自己不产生目标——否则预览把被拖行挪到指针下之后，它成为"最近行"并被映射回
 *    **起始下标**，每次 dragover 都在"预览到目标位置 → 弹回起始位置"之间循环
 *    （真机 2.4s 内实测约 30 次来回）；
 * 2. 压的还是当前目标行 → 不产生状态变化（高频 dragover 不重复 setState）；
 * 3. **没压住任何行（缝隙）→ 维持现状**，不猜"最近行"（2026-10-29 修：条目高度不一致时
 *    换位会让指针停进空白，按中心距离硬猜就会连锁跳位）；
 * 4. drop 与悬停共用同一套 band：缝隙处提交"拖动中看到的那一版"。
 *
 * jsdom 没有布局，这里给树行装一个**随 CSS order 变化**的 getBoundingClientRect，
 * 用同一套行高/行距模拟"预览换位 → 几何变化"的真实反馈链。
 *
 * 2026-10-28 修「拖不动」时补了两件事：
 * 1. 几何桩必须同时装在**行元素**上：落点判定现在量行（`.resume-outline-row`），
 *    不再量包着子树的外层 treeitem；桩里故意让 treeitem 比行高得多（真机展开态的形状），
 *    实现若退回量 treeitem，这里的期望值就不成立；
 * 2. `dragover` 只记坐标，解析被合并到一帧一次（`useOutlineDragDrop.scheduleHover`），
 *    所以每次 dragover 之后要 `settleHover()` 让出一帧再断言。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";
import { dragData, entryOrder } from "./outlineDragDomKit";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";

/** 与 outline.css 的条目行一致：28px 高、行距 28px。 */
const ROW_HEIGHT = 28;
const ROW_TOP = 500;
/** 展开态里外层 treeitem 的高度：行 + 4 条要点（真机上 treeitem 包着整个要点子树）。 */
const EXPANDED_HEIGHT = ROW_HEIGHT + 4 * 24;

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

/** treeitem 自己的那一行：条目/要点是 `.resume-outline-row`，板块头是 `.resume-outline-section`。 */
function rowOf(treeitem: HTMLElement): HTMLElement | null {
  for (const child of Array.from(treeitem.children)) {
    const element = child as HTMLElement;
    if (
      element.classList?.contains("resume-outline-row") ||
      element.classList?.contains("resume-outline-section")
    ) {
      return element;
    }
  }
  return null;
}

/**
 * 给树行装上"模拟浏览器布局"的 getBoundingClientRect：
 * 项目条目按 `style.order`（视觉槽位）定位，其余行放到视口外（落点解析只按同类行算距离）。
 * 元素节点在拖动中稳定（DOM 不重排），实例方法装上后跨 re-render 一直有效。
 *
 * **行** = 28px 的槽位（用户看到的位置）；**treeitem** = 行 + 要点子树（比行高得多）。
 * 落点判定只允许读前者。
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
    const slot = slotOf.get(element.dataset.treeKey ?? "");
    const row = rowOf(element);
    if (!slot) {
      element.getBoundingClientRect = () => domRect(3000, EXPANDED_HEIGHT);
      if (row) row.getBoundingClientRect = () => domRect(3000, ROW_HEIGHT);
      continue;
    }
    element.getBoundingClientRect = () => domRect(ROW_TOP + slot() * ROW_HEIGHT, EXPANDED_HEIGHT);
    if (row) row.getBoundingClientRect = () => domRect(ROW_TOP + slot() * ROW_HEIGHT, ROW_HEIGHT);
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

/**
 * 悬停解析被合并到**一帧一次**（`useOutlineDragDrop.scheduleHover`）：dragover 之后要让出
 * 一帧再断言，否则看到的是"还没解析"的中间态。两帧 + 一个宏任务，兼容没有 rAF 的退化路径。
 */
async function settleHover(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 2; pass += 1) {
      if (typeof window.requestAnimationFrame === "function") {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 0));
    }
  });
}

/** 最小 dataTransfer 桩 / 视觉顺序读数：两个组件用例文件共用（见 outlineDragDomKit）。 */

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
  it("指针停在目标行上：连续 dragover 不再把被拖行弹回原位，预览只换一次", async () => {
    const { commands, previews } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    // 指针停在"项目丙"原本的行中心：预览把项目乙换到第 3 个槽位。
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    const previewCalls = previews.length;

    const seen = new Set<string>();
    for (let index = 0; index < 12; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(2) + (index % 2 === 0 ? 0 : 1));
      await settleHover();
      seen.add(entryOrder().join("|"));
    }

    expect([...seen]).toEqual([[PROJECT_A, PROJECT_C, PROJECT_B].join("|")]);
    // 稳定后不再产生新的结构预览（旧实现每次 dragover 都会重算一次）。
    expect(previews.length).toBe(previewCalls);
    expect(commands).toHaveLength(0);
  });

  it("指针在行边界附近 ±1px 抖动：目标不来回切换", async () => {
    const { previews } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    const previewCalls = previews.length;

    // 第 2/3 槽位的边界：指针停在中线上再做 ±1px 手抖。
    const boundaryY = slotCenterY(2) - ROW_HEIGHT / 2;
    for (let index = 0; index < 10; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, boundaryY + (index % 2 === 0 ? 0 : 1));
      await settleHover();
    }

    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
    expect(previews.length).toBe(previewCalls);
  });

  it("指针明显移到另一行时仍会切换目标（排序能力不变）", async () => {
    renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);

    fireDragAt("dragover", tree, dataTransfer, slotCenterY(0));
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 停在新的目标位置后同样稳定。
    for (let index = 0; index < 6; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(0));
      await settleHover();
    }
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);
  });

  it("松手只落最后预览顺序：抖动结束后 drop 提交到目标下标", async () => {
    const { commands } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    await settleHover();
    for (let index = 0; index < 8; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(2));
    }
    await settleHover();
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

describe("dragover 的成本：只记坐标，量测与 setState 合并到一帧一次", () => {
  it("同一帧 20 次 dragover → 行只量测一轮、结构预览最多推一次", async () => {
    const { previews } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    // 统计"读行矩形"的次数：这就是旧实现每次 dragover 都在做的事（与 React 的 DOM 写入
    // 同帧互相作废 → 布局抖动；真机实测 dragover 间隔 max 373ms、两个 longtask）。
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>(".resume-outline-row, .resume-outline-section"),
    );
    let reads = 0;
    const originals = rows.map((row) => row.getBoundingClientRect.bind(row));
    rows.forEach((row, index) => {
      row.getBoundingClientRect = () => {
        reads += 1;
        return originals[index]();
      };
    });
    const previewCalls = previews.length;

    for (let index = 0; index < 20; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(2) + (index % 2));
    }
    // 一帧都还没过：一次量测都没发生（dragover 只把 clientY 记进 ref）。
    expect(reads).toBe(0);
    expect(previews.length).toBe(previewCalls);

    await settleHover();
    // 一帧只量一轮；行数 = 条目行 + 板块头（本用例的树里就这些行）。
    expect(reads).toBe(rows.length);
    // 落点变了 → 结构预览推一次（不是 20 次）。
    expect(previews.length).toBe(previewCalls + 1);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
  });
});

describe("drop 与 hover 同一套落点语义", () => {
  it("缝隙处松手：提交的 index == 拖动中预览的最后 index（不许再跳一次）", async () => {
    const { commands } = renderPanel();
    const tree = screen.getByRole("tree", { name: t("outline.tree.label") });
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    // 逐帧往下拖再拖回来：记录用户每一帧看到的顺序。
    const seen: string[][] = [];
    for (const slot of [1, 2, 0]) {
      fireDragAt("dragover", tree, dataTransfer, slotCenterY(slot));
      await settleHover();
      seen.push(entryOrder());
    }
    const lastPreview = seen[seen.length - 1];
    expect(lastPreview).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 指针挪到所有行下方的空白（压不住任何行）再松手：drop 必须提交"最后看到的那一版"。
    fireDragAt("drop", tree, dataTransfer, slotCenterY(2) + 400);
    expect(entryOrder()).toEqual(lastPreview);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      toIndex: 0,
    });
  });
});
