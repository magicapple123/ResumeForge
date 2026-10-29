// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲拖拽的**落点容错**回归（用户反馈 #4："拖动大部分情况下无法实现"）。
 *
 * 真机复现出的失败形态（旧实现只有 `.resume-outline-row` 上的行级 drop）：
 * 1. **缝隙/板块标题/分组容器上松手** → 没有 drop 事件（只有 dragend）→ 顺序静默不变；
 * 2. **快速一甩**：dragstart 后没有 dragover 落到目标行就松手 → 同样没有 drop；
 * 3. **拖行/标题（不是 18px 手柄）**根本不会开始拖动。
 *
 * 现在 drop 收在树容器上，落点按 data-tree-key / 行矩形（band）解析；整行可拖。
 * 这里用 dataTransfer 桩手动派发事件（jsdom 没有真实拖放），断言：
 * - 没有 dragOver 的"快速 drop"也能提交（落点由 drop 自己解析）；
 * - 松在板块标题 / 分组容器 / 空白处**不猜落点**：提交拖动中看到的那一版（没预览就不动）；
 * - 拖行标题也能起拖；松到别的板块上不提交；
 * - 要点行同样支持快速 drop；命令/历史仍是一条。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";
import { dragData, entryOrder, pointOrder } from "./outlineDragDomKit";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";
const SCHOOL_A = "学校甲";
const SCHOOL_B = "学校乙";

/** 项目要点的正文（与 `projectContent` 的生成规则一致）。 */
function pointText(projectName: string, index: number): string {
  return `${projectName}-要点${index + 1}`;
}

const POINT_B1 = pointText(PROJECT_B, 0);
const POINT_B2 = pointText(PROJECT_B, 1);

/**
 * 条目内容：`points` 决定每个项目有几条要点（展开态里要点越多，外层 treeitem 越高——
 * 这正是"拖动判定量错元素"的真机形状）。
 */
function projectContent(points: readonly number[]): ResumeContent {
  const names = [PROJECT_A, PROJECT_B, PROJECT_C];
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
    // 第二部分板块：跨板块拖动的落点（真机复现"拖到别的板块上"用的目标）。
    education: [SCHOOL_A, SCHOOL_B].map((school) => ({
      school,
      major: "",
      degree: "",
      start_date: "",
      end_date: "",
      gpa: "",
      courses: [],
      achievements: [],
    })),
    experience: [],
    campus_experience: [],
    projects: names.map((name, index) => ({
      name,
      role: "",
      start_date: "",
      end_date: "",
      tech_stack: [],
      description: Array.from({ length: points[index] ?? 0 }, (_, pointIndex) =>
        pointText(name, pointIndex),
      ),
      highlights: [],
    })),
    skills: [],
    awards: [],
  });
}

function makeContent(): ResumeContent {
  return projectContent([1, 2, 1]);
}

function projectId(content: ResumeContent, name: string): string {
  return entryIdOf(entriesOf(content, "projects").find((entry) => entry.name === name));
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`找不到树节点：${key}`);
  return element;
}

function entryRow(content: ResumeContent, name: string): HTMLElement {
  const row = treeitem(`entry:projects:${projectId(content, name)}`).querySelector<HTMLElement>(
    ".resume-outline-row",
  );
  if (!row) throw new Error(`找不到条目行：${name}`);
  return row;
}

/** 最小 dataTransfer 桩 / 视觉顺序读数：两个组件用例文件共用（见 outlineDragDomKit）。 */

function entryHandle(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
}

function renderPanel(initial: ResumeContent = makeContent()) {
  const commands: OutlineCommand[] = [];
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
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  return { initial, commands };
}

/** 展开某条目的要点（键盘等价物：→）。 */
function expandPoints(initial: ResumeContent, name: string): void {
  fireEvent.keyDown(treeitem(`entry:projects:${projectId(initial, name)}`), { key: "ArrowRight" });
}

// ── 真机形态的几何桩（jsdom 没有布局，展开态要自己搭） ───────────────────
/** 与 outline.css 一致：条目行 28px、要点行 24px。 */
const ROW_HEIGHT = 28;
const POINT_HEIGHT = 24;
/** 树的第一行在视口里的 y（具体值不重要，"相对关系"才是被测对象）。 */
const TREE_TOP = 200;

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
function rowOf(treeitemElement: HTMLElement): HTMLElement {
  for (const child of Array.from(treeitemElement.children)) {
    const element = child as HTMLElement;
    if (
      element.classList?.contains("resume-outline-row") ||
      element.classList?.contains("resume-outline-section")
    ) {
      return element;
    }
  }
  throw new Error(`树节点里找不到行元素：${treeitemElement.dataset.treeKey ?? "?"}`);
}

function rowRect(key: string): DOMRect {
  return rowOf(treeitem(key)).getBoundingClientRect();
}

/**
 * 给整棵树装上**展开态**的布局（真机"拖不动"的形状）：
 * 行 28px，但 `[data-tree-key]` 那层 treeitem 是**包含展开的要点子树**的——
 * 每条要点再加 24px。于是 treeitem 的中心比它自己的行中心低几十到上百像素，
 * 落点判定若量 treeitem（旧实现）就会算出与用户看到的位置完全不同的答案。
 */
function stubExpandedLayout(): void {
  const tree = document.querySelector<HTMLElement>(".resume-outline-tree");
  if (!tree) throw new Error("找不到树容器");
  const layout = (item: HTMLElement, top: number): number => {
    const row = rowOf(item);
    const height = row.classList.contains("is-point") ? POINT_HEIGHT : ROW_HEIGHT;
    const rowBox = domRect(top, height);
    row.getBoundingClientRect = () => rowBox;
    let bottom = top + height;
    for (const child of Array.from(item.children)) {
      const group = child as HTMLElement;
      if (!group.classList?.contains("resume-outline-group")) continue;
      for (const nested of Array.from(group.children)) {
        bottom = layout(nested as HTMLElement, bottom);
      }
    }
    const itemBox = domRect(top, bottom - top);
    item.getBoundingClientRect = () => itemBox;
    return bottom;
  };
  let y = TREE_TOP;
  for (const section of Array.from(tree.children)) {
    y = layout(section as HTMLElement, y);
  }
}

/**
 * jsdom 没有 DragEvent，RTL 会退化成普通 Event 而丢掉 clientY——几何悬停必须拿到真实坐标，
 * 所以这里自己建事件并把 clientY / dataTransfer 挂上去。派发目标是**树容器**：真机上拖动中
 * 整棵树 `pointer-events:none`，行级 dragover 根本不会触发（"测试全绿、真机坏"的根源）。
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

/** 悬停解析被合并到一帧一次（`useOutlineDragDrop.scheduleHover`）：让出一帧再断言。 */
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

function treeElement(): HTMLElement {
  return screen.getByRole("tree", { name: t("outline.tree.label") });
}

function educationId(content: ResumeContent, school: string): string {
  const found = entriesOf(content, "education").find((entry) => entry.school === school);
  return entryIdOf(found);
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("快速 drop（没有 dragOver）也要生效", () => {
  it("条目：dragStart 后直接 drop 到目标行的子元素上 → 提交一条命令", () => {
    const { initial, commands } = renderPanel();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_A), { dataTransfer });
    // 松在标题文本上（真机常见落点），且**没有**任何 dragOver：旧实现这里会静默取消。
    const title = entryRow(initial, PROJECT_C).querySelector(
      ".resume-outline-title",
    ) as HTMLElement;
    fireEvent.drop(title, { dataTransfer });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      objectId: projectId(initial, PROJECT_A),
      toIndex: 2,
    });
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);
  });

  it("要点：dragStart 后直接 drop 到另一条要点行 → 提交一条 reorder-point", () => {
    const { initial, commands } = renderPanel();
    expandPoints(initial, PROJECT_B);
    const dataTransfer = dragData();
    const handles = screen.getAllByRole("button", { name: t("outline.sort.pointHandle") });
    fireEvent.dragStart(handles[0], { dataTransfer });
    fireEvent.drop(handles[1].closest(".resume-outline-row") as HTMLElement, { dataTransfer });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "reorder-point", toIndex: 1 });
    expect(pointOrder()).toEqual([POINT_B2, POINT_B1]);
  });
});

describe("松在缝隙 / 板块标题上：不猜落点，提交拖动中看到的那一版", () => {
  it("先悬停到目标行、再把指针挪到板块标题上松手 → 提交预览过的下标（hover 与 drop 同源）", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    stubExpandedLayout();
    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_A), { dataTransfer });

    // 悬停到「项目乙」的行中心：预览把甲换到第 2 位。
    const rowB = rowRect(`entry:projects:${projectId(initial, PROJECT_B)}`);
    const pointerY = rowB.top + rowB.height / 2;
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 指针再挪到板块标题上（压不住任何行）松手：提交的必须是刚才看到的那一版，
    // 不能换一套算法重新猜一个落点（旧实现 drop 走"最近行"、hover 走另一套 → 分叉跳位）。
    fireDragAt("drop", treeitem("section:projects"), dataTransfer, 10);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "reorder-entry", toIndex: 1 });
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);
  });

  it("没有任何预览时直接在板块标题 / 分组容器上松手 → 顺序不变、不派发命令", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    stubExpandedLayout();

    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer: dragData() });
    fireEvent.drop(treeitem("section:projects"), { dataTransfer: dragData(), clientY: 10 });
    expect(commands).toHaveLength(0);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);

    fireEvent.dragStart(entryHandle(PROJECT_C), { dataTransfer: dragData() });
    // 取「项目经历」板块自己的分组容器（页面里还有其它板块的空分组）。
    const group = treeitem("section:projects").querySelector<HTMLElement>(".resume-outline-group");
    expect(group).not.toBeNull();
    fireEvent.drop(group as HTMLElement, { dataTransfer: dragData(), clientY: 12 });
    expect(commands).toHaveLength(0);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
  });
});

describe("整行可拖 + 跨板块拒绝", () => {
  it("拖行标题（不是手柄）也能起拖并提交", () => {
    const { initial, commands } = renderPanel();
    const title = entryRow(initial, PROJECT_A).querySelector(
      ".resume-outline-title",
    ) as HTMLElement;
    fireEvent.dragStart(title, { dataTransfer: dragData() });
    fireEvent.drop(entryRow(initial, PROJECT_C), { dataTransfer: dragData() });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      objectId: projectId(initial, PROJECT_A),
      toIndex: 2,
    });
  });

  it("松在别的板块上：不猜意图，不提交（顺序不变）", () => {
    renderPanel();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer: dragData() });
    fireEvent.drop(treeitem("section:education"), { dataTransfer: dragData(), clientY: 50 });
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
  });
});

describe("真机形态（展开态）：dragover 只打在树容器上", () => {
  it("落点按**行**几何判定：dragover 到目标行中心就能换位（旧实现量 treeitem，永远不动）", async () => {
    // 被拖的甲只有 1 条要点、目标是 6 条要点：treeitem 高度差 120px，这正是真机实测
    // "第 1 条 drag 到第 2 条的行上却判成离自己更近"的形状。
    const initial = projectContent([1, 6, 2]);
    const { commands } = renderPanel(initial);
    expandPoints(initial, PROJECT_A);
    expandPoints(initial, PROJECT_B);
    stubExpandedLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_A), { dataTransfer });

    // 几何自检：treeitem 包着展开的要点子树，中心比它自己的行中心低几十像素
    // （旧实现量的就是这个错位的中心，因此把"指针压在目标行上"判成"离自己更近"）。
    const entryBKey = `entry:projects:${projectId(initial, PROJECT_B)}`;
    const itemA = treeitem(
      `entry:projects:${projectId(initial, PROJECT_A)}`,
    ).getBoundingClientRect();
    expect(itemA.height).toBeGreaterThan(
      rowRect(`entry:projects:${projectId(initial, PROJECT_A)}`).height,
    );
    const itemB = treeitem(entryBKey).getBoundingClientRect();
    const rowB = rowRect(entryBKey);
    expect(itemB.top + itemB.height / 2 - (rowB.top + rowB.height / 2)).toBeGreaterThan(60);

    // 指针停在「项目乙」这一行的中心（真机：行 pointer-events:none，事件落在树容器上）。
    const targetRow = rowRect(entryBKey);
    const pointerY = targetRow.top + targetRow.height / 2;
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 同一位置再抖几帧：目标没换就不要再改顺序（滞回不变）。
    for (let index = 0; index < 4; index += 1) {
      fireDragAt("dragover", tree, dataTransfer, pointerY + (index % 2 === 0 ? 0 : 1));
    }
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);

    // 松手：一条命令、落到下标 1（"一次拖动只派发一条命令"不变）。
    fireDragAt("drop", tree, dataTransfer, pointerY);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      objectId: projectId(initial, PROJECT_A),
      toIndex: 1,
    });
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);
  });

  it("跨板块：dragover/drop 都落在别的板块的行上 → 不提交、顺序回到原样", async () => {
    const initial = projectContent([2, 3, 2]);
    const { commands } = renderPanel(initial);
    expandPoints(initial, PROJECT_B);
    stubExpandedLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });

    // 真机复现的形态：把项目条目拖到「教育经历」的条目行上（跨板块）。
    const educationRow = rowRect(`entry:education:${educationId(initial, SCHOOL_B)}`);
    const pointerY = educationRow.top + educationRow.height / 2;
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    fireDragAt("drop", tree, dataTransfer, pointerY);

    // 跨板块不是这个功能的语义：不猜意图、不派发命令、顺序回到原样。
    expect(commands).toHaveLength(0);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    expect(entryOrder()).toEqual(
      entriesOf(initial, "projects").map((entry) => String(entry.name ?? "")),
    );
  });
});

describe("真机形态：拖到本组末尾 / 空白处松手", () => {
  it("指针压在本组最后一行上 → 落到最后一位（band 命中，不靠空白区猜）", async () => {
    const initial = projectContent([1, 1, 1]);
    const { commands } = renderPanel(initial);
    stubExpandedLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_A), { dataTransfer });

    const rowC = rowRect(`entry:projects:${projectId(initial, PROJECT_C)}`);
    const pointerY = rowC.top + rowC.height / 2;
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);

    fireDragAt("drop", tree, dataTransfer, pointerY);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      objectId: projectId(initial, PROJECT_A),
      toIndex: 2,
    });
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);
  });

  it("所有行下方的空白区（压不住任何行）→ 不猜落点：顺序不变、不派发命令", async () => {
    const initial = projectContent([1, 1, 1]);
    const { commands } = renderPanel(initial);
    stubExpandedLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_A), { dataTransfer });

    const bottoms = Array.from(document.querySelectorAll<HTMLElement>("[data-tree-key]")).map(
      (element) => rowOf(element).getBoundingClientRect().bottom,
    );
    const emptyY = Math.max(...bottoms) + 40;
    fireDragAt("dragover", tree, dataTransfer, emptyY);
    await settleHover();
    // 空白处 band 什么都没压住 → 维持现状（旧实现会按"最近行"把条目甩到末尾）。
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);

    fireDragAt("drop", tree, dataTransfer, emptyY);
    expect(commands).toHaveLength(0);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
  });
});
