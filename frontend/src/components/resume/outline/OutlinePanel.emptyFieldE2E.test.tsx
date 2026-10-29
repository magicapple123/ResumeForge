// SPDX-License-Identifier: Apache-2.0
/**
 * 「搬空 → 拖回空字段」的端到端取证（QA 独立编写，不复用工程师的用例）。
 *
 * 起点是单向门的**终点状态**：`courses: []` / `achievements: [A, B]`。此时扁平列表里没有课程行，
 * `flatInsertionOf` 的任何 `(from, to)` 都推不出 `targetField = courses`；能不能搬回来，完全取决于
 * 「占位行」这条新通路。
 *
 * 这里不逐行 hand-stub 一个矩形，而是按 **CSS `order`** 把整棵树的每一行依次铺成首尾相接的矩形
 * （占位行 `order = 0`、要点行 `order = 2i + 1`），再在**树容器**上派发带 `clientY` 的
 * `dragover` / `drop` —— 与真机同一形状（拖动中行 `pointer-events:none`，事件只到树容器）。
 *
 * 断言四件事：占位行身份 → 悬停后预览**复位**成真实顺序 → 松手**恰好一条** `move-point`
 * (`toPointField=courses`, `toIndex=0`) → 应用后两个字段的文本与 `point_ids` 都满足保存契约。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";
import { dragData } from "./outlineDragDomKit";

const AWARD_A = "奖学金";
const AWARD_B = "优秀学生";
const SCHOOL = "上海大学";

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
      {
        school: SCHOOL,
        major: "市场营销",
        degree: "本科",
        gpa: "",
        start_date: "",
        end_date: "",
        // 单向门的终点状态：课程已被搬空。
        courses: [],
        achievements: [AWARD_A, AWARD_B],
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

interface Rendered {
  initial: ResumeContent;
  commands: OutlineCommand[];
  latest: { current: ResumeContent };
}

function renderPanel(initial: ResumeContent): Rendered {
  const commands: OutlineCommand[] = [];
  const latest = { current: initial };
  function Harness() {
    const [content, setContent] = useState<ResumeContent>(initial);
    latest.current = content;
    return (
      <AntdApp>
        <OutlinePanel
          content={content}
          onCommand={(command, baseContent) => {
            commands.push(command);
            const result = applyOutlineCommand(baseContent, command);
            if (result.ok) {
              latest.current = result.content;
              setContent(result.content);
            }
          }}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  // 板块默认展开，只需展开条目。
  fireEvent.keyDown(treeitem(entryTreeKey(initial)), { key: "ArrowRight" });
  return { initial, commands, latest };
}

function entryTreeKey(source: ResumeContent): string {
  return `entry:education:${entryIdOf(entriesOf(source, "education")[0])}`;
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`treeitem missing: ${key}`);
  return element;
}

function placeholderKey(source: ResumeContent, pointField: string): string {
  return `point-empty:education:${entryIdOf(entriesOf(source, "education")[0])}:${pointField}`;
}

function pointRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point"));
}

function placeholderRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-tree-key^="point-empty:"] .resume-outline-row'),
  );
}

/** 一行的视觉顺序写在它的 treeitem 上（CSS `order`，DOM 顺序保持稳定）。 */
function orderOf(row: HTMLElement): string {
  return row.closest<HTMLElement>("[data-tree-key]")?.style.order ?? "";
}

// ── 几何：按 CSS order 把整棵树铺成首尾相接的行矩形 ─────────────────────────
const TREE_TOP = 200;
const SECTION_H = 32;
const ENTRY_H = 28;
const POINT_H = 24;

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
  throw new Error(`行元素缺失：${(item as HTMLElement).dataset.treeKey ?? "?"}`);
}

function stubRect(element: HTMLElement, top: number, height: number): void {
  const rect = {
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
  element.getBoundingClientRect = () => rect;
}

function orderNum(element: HTMLElement, fallback: number): number {
  const raw = element.style.order;
  return raw === "" ? fallback : Number(raw);
}

/**
 * 按视觉顺序铺满整棵树：每个容器内按 `style.order` 排序（这正是拖动中 CSS 换位后的布局），
 * 行高与 `outline.css` 一致，行矩形首尾相接不重叠（band 语义的前提）。
 */
function stubVisualLayout(): void {
  const tree = document.querySelector<HTMLElement>(".resume-outline-tree");
  if (!tree) throw new Error("tree missing");
  let y = TREE_TOP;
  const emit = (item: HTMLElement): void => {
    const row = rowOf(item);
    const height = row.classList.contains("is-point")
      ? POINT_H
      : row.classList.contains("resume-outline-section")
        ? SECTION_H
        : ENTRY_H;
    stubRect(row, y, height);
    y += height;
    for (const child of Array.from(item.children)) {
      const group = child as HTMLElement;
      if (!group.classList?.contains("resume-outline-group")) continue;
      const kids = (Array.from(group.children) as HTMLElement[])
        .map((element, index) => ({ element, index, order: orderNum(element, index) }))
        .sort((left, right) => left.order - right.order || left.index - right.index)
        .map((item2) => item2.element);
      for (const kid of kids) emit(kid);
    }
  };
  for (const section of Array.from(tree.children) as HTMLElement[]) emit(section);
}

function rectOf(element: HTMLElement): DOMRect {
  return element.getBoundingClientRect();
}

/** jsdom 没有 DragEvent：RTL 会退化成普通 Event 丢掉 clientY，这里自己建事件并挂上。 */
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

describe("搬空 → 拖回空字段（占位行端到端）", () => {
  it("悬停占位行复位预览、松手一条 move-point、课程拿回那一条且保存契约成立", async () => {
    const initial = makeContent();
    const { commands, latest } = renderPanel(initial);
    const awardAId = pointIdsOf(entriesOf(initial, "education")[0], "achievements")[0];

    // ① 拖动中才出现，且键是「条目 id + 空字段」。
    expect(placeholderRows()).toEqual([]);
    const dataTransfer = dragData();
    const rows = pointRows();
    expect(rows).toHaveLength(2);
    fireEvent.dragStart(rows[0], { dataTransfer });
    expect(placeholderRows()).toHaveLength(1);
    expect(treeitem(placeholderKey(initial, "courses")).dataset.treeKey).toBe(
      placeholderKey(initial, "courses"),
    );
    // 占位行在视觉最前（courses 声明在 achievements 之前）。
    expect(orderOf(placeholderRows()[0])).toBe("0");
    expect(orderOf(rows[0])).toBe("1");

    // 布局铺好，再在树容器上把指针压到占位行中心。
    stubVisualLayout();
    const targetRect = rectOf(placeholderRows()[0]);
    const pointerY = targetRect.top + targetRect.height / 2;

    // 先悬停到另一条普通要点行：预览确实位移（order 变成 3），证明下面不是"本来就复位"。
    const otherRect = rectOf(rows[1]);
    fireDragAt("dragover", treeElement(), dataTransfer, otherRect.top + otherRect.height / 2);
    await settleHover();
    expect(orderOf(rows[0])).toBe("3");

    // ② 再悬停占位行 → 预览复位成真实顺序，且高亮落在占位行上。
    fireDragAt("dragover", treeElement(), dataTransfer, pointerY);
    await settleHover();
    expect(orderOf(rows[0])).toBe("1");
    expect(placeholderRows()[0].className).toContain("is-drop-target");

    // ③ 松手：恰好一条 move-point，搬进 courses 的第 0 位。
    fireDragAt("drop", treeElement(), dataTransfer, pointerY);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toEqual({
      type: "move-point",
      field: "education",
      objectId: entryIdOf(entriesOf(initial, "education")[0]),
      fromPointField: "achievements",
      toPointField: "courses",
      pointId: awardAId,
      toIndex: 0,
    });

    // ④ 应用后的内容 + point_ids 形状（后端 validate_document_ids 的硬要求）。
    const entry = entriesOf(latest.current, "education")[0];
    expect(entry.courses).toEqual([AWARD_A]);
    expect(entry.achievements).toEqual([AWARD_B]);
    for (const pointField of ["courses", "achievements"] as const) {
      const values = entry[pointField];
      const ids = pointIdsOf(entry, pointField);
      expect(Array.isArray(values) ? values.length : -1).toBe(ids.length);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(pointIdsOf(entry, "courses")[0]).toBe(awardAId);
    expect(pointIdsOf(entry, "achievements")).toEqual([
      pointIdsOf(entriesOf(initial, "education")[0], "achievements")[1],
    ]);

    // 拖动结束 → 占位行消失（课程字段已非空，本来也不该再出现）。
    expect(placeholderRows()).toEqual([]);
    expect(document.querySelectorAll('[data-tree-key^="point-empty:"]')).toHaveLength(0);
  });

  it("缝隙松手：预览已复位成真实顺序 → 不产生任何改动（不能拿复位前的 currentIndex 误提交）", async () => {
    const initial = makeContent();
    const { commands, latest } = renderPanel(initial);
    const dataTransfer = dragData();
    const rows = pointRows();
    fireEvent.dragStart(rows[0], { dataTransfer });
    stubVisualLayout();

    // 先悬停普通要点行 → 预览位移。
    const otherRect = rectOf(rows[1]);
    fireDragAt("dragover", treeElement(), dataTransfer, otherRect.top + otherRect.height / 2);
    await settleHover();
    expect(orderOf(rows[0])).toBe("3");

    // 再悬停占位行 → 复位。
    const targetRect = rectOf(placeholderRows()[0]);
    fireDragAt("dragover", treeElement(), dataTransfer, targetRect.top + targetRect.height / 2);
    await settleHover();
    expect(orderOf(rows[0])).toBe("1");

    // 最后把指针挪到所有行下方的空白（band 不命中 → resolveDropPoint 返回 commit）后松手。
    const lastRect = rectOf(rows[1]);
    fireDragAt("drop", treeElement(), dataTransfer, lastRect.bottom + 400);

    // 复位之后 currentIndex === startIndex → commitDrag 是 no-op：内容逐字不变。
    expect(JSON.stringify(latest.current)).toBe(JSON.stringify(initial));
    const moveCommands = commands.filter((command) => command.type === "move-point");
    expect(moveCommands).toEqual([]);
  });
});
