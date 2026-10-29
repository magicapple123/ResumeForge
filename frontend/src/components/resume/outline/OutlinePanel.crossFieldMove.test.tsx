// SPDX-License-Identifier: Apache-2.0
/**
 * 要点**跨字段搬移**的端到端取证（QA 独立编写，不改并行会话的测试文件）。
 *
 * ## 为什么不能只看 `pointMove.test.ts` 绿
 *
 * 那个文件测的是纯函数。真实链路上还有三处可能把结果改坏：树容器的 `dragOver`/`drop`
 * （落点解析）、`useOutlineSort` 的会话下标口径（组内 → 扁平）、`useOutlineDragDrop` 派发的
 * 命令构造。这里从**组件**出发，按真机形状抛事件（拖动中行 `pointer-events:none`，事件落在
 * 树容器上），断言：
 *
 * 1. 派发出去的确实是 `move-point`，且三个字段参数都对；
 * 2. 应用后的条目内容与 `point_ids` 都正确（与后端 `document_identity.py` 的形状要求一致：
 *    每个 point 数组与它的 id 数组等长、源字段搬空留 `[]`）；
 * 3. 原地松手是 no-op（不产生命令、不记历史）；
 * 4. 拖到「别的条目」或「别的板块」上仍然一动不动（既有语义，本次不许放宽）。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";
import { dragData } from "./outlineDragDomKit";

const SCHOOL = "学校甲";
const OTHER_SCHOOL = "学校乙";
const COURSE = "数据结构";
const ACH_1 = "成果一";
const ACH_2 = "成果二";
const ACH_3 = "成果三";

// ── 夹具 ────────────────────────────────────────────────────────────────────
function education(school: string, courses: string[], achievements: string[]) {
  return {
    school,
    major: "计算机",
    degree: "本科",
    start_date: "",
    end_date: "",
    gpa: "",
    courses,
    achievements,
  };
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
    education: [
      education(SCHOOL, [COURSE], [ACH_1, ACH_2, ACH_3]),
      // 同板块的另一个条目：跨条目拖动必须被拒绝。
      education(OTHER_SCHOOL, [], []),
    ],
    experience: [],
    campus_experience: [],
    // 别的板块：跨板块拖动必须被拒绝。
    projects: [
      {
        name: "项目甲",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [],
        description: [],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

function educationEntry(content: ResumeContent, school: string) {
  const found = entriesOf(content, "education").find((entry) => entry.school === school);
  if (!found) throw new Error(`找不到教育经历：${school}`);
  return found;
}

function schoolAId(content: ResumeContent): string {
  return entryIdOf(educationEntry(content, SCHOOL));
}

function pointIdOf(content: ResumeContent, pointField: string, index: number): string {
  return pointIdsOf(educationEntry(content, SCHOOL), pointField)[index];
}

// ── 渲染 ────────────────────────────────────────────────────────────────────
function renderPanel(initial: ResumeContent) {
  const commands: OutlineCommand[] = [];
  const latest: { content: ResumeContent } = { content: initial };
  function Harness() {
    const [content, setContent] = useState<ResumeContent>(initial);
    latest.content = content;
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
  return { initial, commands, latest };
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`找不到树节点：${key}`);
  return element;
}

function pointTreeKey(content: ResumeContent, pointField: string, index: number): string {
  return `point:education:${schoolAId(content)}:${pointField}:${pointIdOf(content, pointField, index)}`;
}

/** 展开「学校甲」的要点（键盘等价物：→；板块默认是展开的）。 */
function expandPoints(content: ResumeContent): void {
  fireEvent.keyDown(treeitem(`entry:education:${schoolAId(content)}`), { key: "ArrowRight" });
}

function pointRow(content: ResumeContent, pointField: string, index: number): HTMLElement {
  const row = treeitem(pointTreeKey(content, pointField, index)).querySelector<HTMLElement>(
    ".resume-outline-row.is-point",
  );
  if (!row) throw new Error(`找不到要点行：${pointField}[${index}]`);
  return row;
}

/** 要点行的排序手柄（拖动从这里起手）。 */
function pointHandle(content: ResumeContent, pointField: string, index: number): HTMLElement {
  return within(pointRow(content, pointField, index)).getByRole("button", {
    name: t("outline.sort.pointHandle"),
  });
}

/** 按 CSS `order`（视觉顺序）读要点文本：拖动中 DOM 顺序不变，只改 order。 */
function visualPointOrder(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="point:"]'))
    .map((element, index) => ({
      element,
      index,
      order: element.style.order === "" ? index : Number(element.style.order),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map(
      (item) => item.element.querySelector(".resume-outline-point-text")?.textContent?.trim() ?? "",
    );
}

function fieldTags(): { field: string; text: string }[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-field-tag")).map(
    (element) => ({
      field: element.dataset.pointField ?? "",
      text: element.textContent?.trim() ?? "",
    }),
  );
}

// ── 真机几何桩（jsdom 没有布局）─────────────────────────────────────────────
const ENTRY_ROW_HEIGHT = 28;
const POINT_ROW_HEIGHT = 24;
const SECTION_ROW_HEIGHT = 32;
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

function rowOf(item: Element): HTMLElement {
  for (const child of Array.from(item.children)) {
    const element = child as HTMLElement;
    if (
      element.classList?.contains("resume-outline-row") ||
      element.classList?.contains("resume-outline-section")
    ) {
      return element;
    }
  }
  throw new Error(`树节点里找不到行元素：${(item as HTMLElement).dataset.treeKey ?? "?"}`);
}

/** 给整棵树装上展开态的布局：行互不重叠、首尾相接（band 语义的前提）。 */
function stubLayout(): void {
  const tree = document.querySelector<HTMLElement>(".resume-outline-tree");
  if (!tree) throw new Error("找不到树容器");
  const layout = (item: HTMLElement, top: number): number => {
    const row = rowOf(item);
    const height = row.classList.contains("is-point")
      ? POINT_ROW_HEIGHT
      : row.classList.contains("resume-outline-section")
        ? SECTION_ROW_HEIGHT
        : ENTRY_ROW_HEIGHT;
    const box = domRect(top, height);
    row.getBoundingClientRect = () => box;
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
  for (const section of Array.from(tree.children)) y = layout(section as HTMLElement, y);
}

function rowCenterY(key: string): number {
  const row = rowOf(treeitem(key));
  const rect = row.getBoundingClientRect();
  return rect.top + rect.height / 2;
}

/**
 * jsdom 没有 DragEvent：RTL 会退化成普通 Event 丢掉 clientY。这里自己建事件并挂上
 * clientY / dataTransfer，派发目标是**树容器**（真机拖动中整棵树 pointer-events:none）。
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

function treeElement(): HTMLElement {
  return screen.getByRole("tree", { name: t("outline.tree.label") });
}

/** 悬停解析被合并到一帧一次：让出两帧再断言。 */
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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

// ── 用例 ────────────────────────────────────────────────────────────────────
describe("跨字段搬移：真实拖动路径（树容器 dragover/drop）", () => {
  it("课程行拖到成果行 → 派发一条 move-point，内容与 point_ids 都跟着搬", async () => {
    const initial = makeContent();
    const { commands, latest } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    const movedId = pointIdOf(initial, "courses", 0);

    // 起手：课程行（扁平第 0 条）的手柄。
    fireEvent.dragStart(pointHandle(initial, "courses", 0), { dataTransfer });

    // 指针压在「成果二」这一行上（achievements 组内下标 1）。
    const pointerY = rowCenterY(pointTreeKey(initial, "achievements", 1));
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    // 预览：被搬那条已经变成成果行（视觉顺序里跑到了成果二之后）。
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    fireDragAt("drop", tree, dataTransfer, pointerY);

    // ① 命令形状：跨字段，不是 reorder-point。
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      type: "move-point",
      field: "education",
      objectId: schoolAId(initial),
      fromPointField: "courses",
      toPointField: "achievements",
      pointId: movedId,
      toIndex: 2,
    });

    // ② 应用后的内容：文本搬过去了，源字段搬空但**保留空数组**。
    const entry = educationEntry(latest.content, SCHOOL);
    expect(entry.courses).toEqual([]);
    expect(entry.achievements).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    // ③ point_ids 与数组等长、id 跟着文本走（后端 validate_document_ids 的硬要求）。
    expect(pointIdsOf(entry, "courses")).toEqual([]);
    const achievementIds = pointIdsOf(entry, "achievements");
    expect(achievementIds).toHaveLength(4);
    expect(achievementIds[2]).toBe(movedId);
    expect((entry.courses as unknown[]).length).toBe(pointIdsOf(entry, "courses").length);
    expect((entry.achievements as unknown[]).length).toBe(achievementIds.length);
    // 其余要点的 id 没有被重排打乱。
    expect(achievementIds[0]).toBe(pointIdOf(initial, "achievements", 0));
    expect(achievementIds[1]).toBe(pointIdOf(initial, "achievements", 1));
    expect(achievementIds[3]).toBe(pointIdOf(initial, "achievements", 2));

    // ④ 树上看到的顺序与提交结果一致（预览 == 落地，不存在"松手又跳一格"）。
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);
  });

  it("搬空之后条目只剩 1 个非空要点字段 → 字段标签自动消失（不再有歧义）", async () => {
    const initial = makeContent();
    const { latest } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();
    // 搬之前：两个非空字段 → 每组第一条带标签。
    expect(fieldTags().map((tag) => tag.field)).toEqual(["courses", "achievements"]);

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(pointHandle(initial, "courses", 0), { dataTransfer });
    const pointerY = rowCenterY(pointTreeKey(initial, "achievements", 1));
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    fireDragAt("drop", tree, dataTransfer, pointerY);

    expect(educationEntry(latest.content, SCHOOL).courses).toEqual([]);
    expect(fieldTags()).toEqual([]);
  });

  it("原地松手（压在自己的行上）→ 不派发命令、不记历史", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(pointHandle(initial, "courses", 0), { dataTransfer });
    // 指针始终压在课程行自己身上（自己的行矩形内）。
    const pointerY = rowCenterY(pointTreeKey(initial, "courses", 0));
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    fireDragAt("drop", tree, dataTransfer, pointerY);

    expect(commands).toHaveLength(0);
    expect(visualPointOrder()).toEqual([COURSE, ACH_1, ACH_2, ACH_3]);
  });

  it("拖到**别的条目**（同一板块）的行上 → 一动不动，不派发命令", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(pointHandle(initial, "courses", 0), { dataTransfer });

    // 先悬停到合法目标（预览确实变了），再把指针移到别的条目上松手：
    // 这样能区分"跨条目被拒绝"与"根本没产生预览"。
    const validY = rowCenterY(pointTreeKey(initial, "achievements", 1));
    fireDragAt("dragover", tree, dataTransfer, validY);
    await settleHover();
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    const foreignY = rowCenterY(
      `entry:education:${entryIdOf(educationEntry(initial, OTHER_SCHOOL))}`,
    );
    fireDragAt("dragover", tree, dataTransfer, foreignY);
    await settleHover();
    // 压到别的条目上：预览维持现状（不回退、也不前进）。
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    fireDragAt("drop", tree, dataTransfer, foreignY);
    expect(commands).toHaveLength(0);
    // 松开后退回真实顺序：内容一个字没动。
    expect(visualPointOrder()).toEqual([COURSE, ACH_1, ACH_2, ACH_3]);
  });

  it("拖到**别的板块**（项目经历）的行上 → 一动不动，不派发命令", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(pointHandle(initial, "courses", 0), { dataTransfer });

    const validY = rowCenterY(pointTreeKey(initial, "achievements", 1));
    fireDragAt("dragover", tree, dataTransfer, validY);
    await settleHover();
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    const projectY = rowCenterY(`entry:projects:${entryIdOf(entriesOf(initial, "projects")[0])}`);
    fireDragAt("dragover", tree, dataTransfer, projectY);
    await settleHover();
    expect(visualPointOrder()).toEqual([ACH_1, ACH_2, COURSE, ACH_3]);

    fireDragAt("drop", tree, dataTransfer, projectY);
    expect(commands).toHaveLength(0);
    expect(visualPointOrder()).toEqual([COURSE, ACH_1, ACH_2, ACH_3]);
  });
});

describe("同字段重排没有退化：仍然派发 reorder-point", () => {
  it("成果一拖到成果二行上 → reorder-point（不是 move-point）", async () => {
    const initial = makeContent();
    const { commands } = renderPanel(initial);
    expandPoints(initial);
    stubLayout();

    const tree = treeElement();
    const dataTransfer = dragData();
    fireEvent.dragStart(pointHandle(initial, "achievements", 0), { dataTransfer });
    const pointerY = rowCenterY(pointTreeKey(initial, "achievements", 2));
    fireDragAt("dragover", tree, dataTransfer, pointerY);
    await settleHover();
    fireDragAt("drop", tree, dataTransfer, pointerY);

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-point",
      field: "education",
      objectId: schoolAId(initial),
      pointField: "achievements",
      pointId: pointIdOf(initial, "achievements", 0),
      toIndex: 2,
    });
    // 只有 achievements 组内变了，课程那条完全没被碰到（也没被搬进/搬出）。
    expect(visualPointOrder()).toEqual([COURSE, ACH_2, ACH_3, ACH_1]);
  });
});
