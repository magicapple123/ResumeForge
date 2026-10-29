// SPDX-License-Identifier: Apache-2.0
/**
 * QA 独立验收（本轮新写，未复用工程师的用例）：**空要点字段占位行的端到端** + **原地确认的负向证明**
 * + **占位行的渲染边界**。
 *
 * 真机形状：拖动中整棵树 `pointer-events:none`，`drop` 的目标恒为**树容器**
 * `.resume-outline-tree`，所以这里所有 `dragover` / `drop` 都打在**树容器**上并带 `clientY`，
 * 行矩形由用例手动量好（jsdom 没有布局）——与真机同一条几何路径（`collectRowBoxes` →
 * `bandHitRow`），而不是靠 `data-tree-key` 走捷径。
 *
 * 纯函数侧的边界与拒绝矩阵在 `outlineEmptyTarget.guards.qa.test.ts`。
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
import { blankResumeContent } from "../../../utils/profileToResume";
import OutlinePanel from "./OutlinePanel";
import { dragData } from "./outlineDragDomKit";

const SCHOOL_A = "上海大学";
const SCHOOL_B = "复旦大学";
const AWARD_A = "奖学金";
const AWARD_B = "优秀学生";
const AWARD_B1 = "辩论赛冠军";
const AWARD_B2 = "三好学生";
const TECH = "React";
const DESC_1 = "重构大纲";
const DESC_2 = "补齐拖拽";
const HIGHLIGHT = "上线";

interface EduSpec {
  school: string;
  courses: string[];
  achievements: string[];
  lockLayout?: boolean;
}

function baseDraft(): ResumeContent {
  // 空白内容用仓库现成的工厂（`profileToResume.blankResumeContent`）：字段清单只有一处定义。
  return blankResumeContent();
}

function educationContent(specs: EduSpec[]): ResumeContent {
  return ensureIds({
    ...baseDraft(),
    education: specs.map((spec) => ({
      school: spec.school,
      major: "市场营销",
      degree: "本科",
      gpa: "",
      start_date: "",
      end_date: "",
      courses: spec.courses,
      achievements: spec.achievements,
      ...(spec.lockLayout ? { lock_layout: true } : {}),
    })),
  });
}

/** 三个要点字段（`tech_stack` / `description` / `highlights`）都非空的项目经历。 */
function projectContent(): ResumeContent {
  return ensureIds({
    ...baseDraft(),
    projects: [
      {
        name: "简历工具",
        role: "",
        start_date: "",
        end_date: "",
        tech_stack: [TECH],
        description: [DESC_1, DESC_2],
        highlights: [HIGHLIGHT],
      },
    ],
  });
}

// ── DOM 读取助手 ───────────────────────────────────────────────
function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error("treeitem missing: " + key);
  return element;
}

function treeEl(): HTMLElement {
  const element = document.querySelector<HTMLElement>(".resume-outline-tree");
  if (!element) throw new Error("tree missing");
  return element;
}

function emptyTargets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="point-empty:"]'));
}

function pointRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point"));
}

/** 按文本找要点行（数据里每条要点文本唯一）。 */
function rowByText(text: string): HTMLElement {
  const row = pointRows().find(
    (item) => item.querySelector(".resume-outline-point-text")?.textContent === text,
  );
  if (!row) throw new Error("point row missing: " + text);
  return row;
}

function pointHandles(): HTMLButtonElement[] {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button.resume-outline-handle.is-point"),
  );
}

/** 一行的视觉顺序写在它的 treeitem 上（CSS `order`，DOM 顺序保持稳定）。 */
function orderOf(row: HTMLElement): string {
  return row.closest<HTMLElement>("[data-tree-key]")?.style.order ?? "";
}

function dropTargetKeys(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".resume-outline-row.is-drop-target"),
  ).map((row) => row.closest<HTMLElement>("[data-tree-key]")?.dataset.treeKey ?? "");
}

function fieldTags(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-field-tag")).map(
    (tag) => tag.dataset.pointField ?? "",
  );
}

// ── 事件助手（jsdom 没有 DragEvent / 布局）────────────────────
/** RTL 的 fireEvent 会丢掉 `clientY`：几何判定必须有真实坐标，所以自建事件。 */
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

/** 悬停解析合并到一帧一次（rAF）：让出几帧再断言。 */
async function settle(): Promise<void> {
  await act(async () => {
    for (let pass = 0; pass < 3; pass += 1) {
      if (typeof window.requestAnimationFrame === "function") {
        await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));
      }
      await new Promise<void>((resolve) => setTimeout(() => resolve(undefined), 0));
    }
  });
}

/** 给行元素一个固定矩形（jsdom 的 `getBoundingClientRect` 全是 0）。 */
function stubRect(element: HTMLElement, top: number, height: number): void {
  const rect = { top, bottom: top + height, height, left: 0, right: 0, width: 0, x: 0, y: top };
  element.getBoundingClientRect = () => ({ ...rect, toJSON: () => ({}) }) as DOMRect;
}

function foldCommands(initial: ResumeContent, commands: readonly OutlineCommand[]): ResumeContent {
  return commands.reduce<ResumeContent>((current, command) => {
    const result = applyOutlineCommand(current, command);
    return result.ok ? result.content : current;
  }, initial);
}

// ── 面板宿主 ─────────────────────────────────────────────────
interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
  latestRef: { current: ResumeContent };
  readOnly?: boolean;
}

function Harness({ initial, commands, latestRef, readOnly = false }: HarnessProps) {
  const [content, setContent] = useState<ResumeContent>(initial);
  const onCommand = (command: OutlineCommand, baseContent: ResumeContent) => {
    commands.push(command);
    const result = applyOutlineCommand(baseContent, command);
    if (result.ok) {
      latestRef.current = result.content;
      setContent(result.content);
    }
  };
  return (
    <AntdApp>
      <OutlinePanel content={content} readOnly={readOnly} onCommand={onCommand} />
    </AntdApp>
  );
}

function renderPanel(
  initial: ResumeContent,
  expandEntries: readonly string[] = [],
  options: { readOnly?: boolean } = {},
) {
  const commands: OutlineCommand[] = [];
  const latestRef = { current: initial };
  render(
    <AntdApp>
      <Harness
        initial={initial}
        commands={commands}
        latestRef={latestRef}
        readOnly={options.readOnly}
      />
    </AntdApp>,
  );
  fireEvent.keyDown(treeitem("section:education"), { key: "ArrowRight" });
  for (const key of expandEntries) fireEvent.keyDown(treeitem(key), { key: "ArrowRight" });
  return { commands, latestRef };
}

/** 条目族名（与 `entriesOf` 的第二参数同型：education / projects / …）。 */
type EntryField = Parameters<typeof entriesOf>[1];

function entryKeyOfContent(
  content: ResumeContent,
  index: number,
  field: EntryField = "education",
): string {
  return `entry:${field}:${entryIdOf(entriesOf(content, field)[index])}`;
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("A. 搬空 → 拖回去（占位行端到端）", () => {
  it("悬停占位行 → 预览复位、松手一条 move-point、课程拿回那一条且身份不串位", async () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
    ]);
    const { commands, latestRef } = renderPanel(content, [entryKeyOfContent(content, 0)]);
    const entryId = entryIdOf(entriesOf(content, "education")[0]);
    const idOfA = pointIdsOf(entriesOf(content, "education")[0], "achievements")[0];
    const dataTransfer = dragData();
    const tree = treeEl();

    // 起点：只有两条成果行，没有课程行（这就是"单向门"的终点状态）。
    const rowA = rowByText(AWARD_A);
    const rowB = rowByText(AWARD_B);
    expect(pointRows()).toHaveLength(2);
    expect(orderOf(rowA)).toBe("1");

    fireEvent.dragStart(rowA, { dataTransfer });

    // ① 占位行存在、键与文案正确、且不可键盘选中。
    const placeholders = emptyTargets();
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0].dataset.treeKey).toBe(`point-empty:education:${entryId}:courses`);
    expect(placeholders[0].textContent).toContain(t("outline.point.emptyTarget"));
    expect(placeholders[0].getAttribute("tabindex")).toBe("-1");
    const targetRow = placeholders[0].querySelector<HTMLElement>(".resume-outline-row");
    if (!targetRow) throw new Error("placeholder row missing");

    // 先制造一次真实的预览位移（悬停到另一条成果行），证明后面的"复位"不是默认值。
    fireEvent.dragOver(rowB, { dataTransfer });
    expect(orderOf(rowA)).toBe("3");

    // ② 悬停占位行：事件打在**树容器**上（真机形状），行矩形手动量好。
    stubRect(targetRow, 490, 28);
    fireDragAt("dragover", tree, dataTransfer, 500);
    await settle();
    expect(orderOf(rowA)).toBe("1");
    expect(dropTargetKeys()).toEqual([`point-empty:education:${entryId}:courses`]);

    // ③ 松手：落点同样按几何算（与悬停共用 band 判定），恰好一条 move-point。
    fireDragAt("drop", tree, dataTransfer, 500);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "move-point",
      field: "education",
      fromPointField: "achievements",
      toPointField: "courses",
      toIndex: 0,
    });

    // ④ 应用后：两字段文本、point_ids 与数组等长、身份跟着走。
    const applied = entriesOf(latestRef.current, "education")[0];
    expect(applied.courses).toEqual([AWARD_A]);
    expect(applied.achievements).toEqual([AWARD_B]);
    expect(pointIdsOf(applied, "courses")).toHaveLength(1);
    expect(pointIdsOf(applied, "achievements")).toHaveLength(1);
    expect(pointIdsOf(applied, "courses")[0]).toBe(idOfA);
    // 拖动收尾：占位行、高亮、拖动态全部收起。
    expect(emptyTargets()).toEqual([]);
    expect(tree.className).not.toContain("is-dragging");
    // 跨层校验（后端 validate_document_ids）用：这是真实应用后的整份内容。
    console.log("QA_APPLIED_JSON=" + JSON.stringify(latestRef.current));
  });
});

describe("B. 原地确认不再静默改字段", () => {
  it("手柄上 Enter → Enter（不按方向键）：内容一字不改，且不产生 move-point", () => {
    const content = projectContent();
    const snapshot = JSON.stringify(content);
    const { commands, latestRef } = renderPanel(content, [
      entryKeyOfContent(content, 0, "projects"),
    ]);
    expect(
      Array.from(document.querySelectorAll(".resume-outline-field-tag")).length,
    ).toBeGreaterThan(0);

    const handle = pointHandles()[0];
    // 第一条要点 = `tech_stack`（"React"）：它的下一条属于另一个字段，正是缺陷命中的形态。
    expect(
      handle.closest(".resume-outline-row")?.querySelector(".resume-outline-point-text")
        ?.textContent,
    ).toBe(TECH);

    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(handle, { key: "Enter" });
    expect(handle).toHaveAttribute("aria-pressed", "false");

    expect(commands.filter((command) => command.type === "move-point")).toHaveLength(0);
    expect(commands.length).toBeLessThanOrEqual(1);
    // 把命令全部回放一遍：内容必须与初始逐字节相同（含 point_ids）。
    expect(JSON.stringify(foldCommands(content, commands))).toBe(snapshot);
    expect(JSON.stringify(latestRef.current)).toBe(snapshot);
    // 纸面上三个字段的标签行都还在（"技术栈"那行没有凭空消失）。
    expect(fieldTags()).toEqual(["tech_stack", "description", "highlights"]);
  });

  it("对照：ArrowDown → Enter 仍然是一条跨字段 move-point（短路没杀掉正常搬移）", () => {
    const content = projectContent();
    const { commands, latestRef } = renderPanel(content, [
      entryKeyOfContent(content, 0, "projects"),
    ]);

    const handle = pointHandles()[0];
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowDown" });
    fireEvent.keyDown(handle, { key: "Enter" });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "move-point",
      fromPointField: "tech_stack",
      toPointField: "description",
      toIndex: 1,
    });
    const applied = entriesOf(latestRef.current, "projects")[0];
    expect(applied.tech_stack).toEqual([]);
    expect(applied.description).toEqual([DESC_1, TECH, DESC_2]);
    expect(applied.highlights).toEqual([HIGHLIGHT]);
  });
});

describe("C. 占位行的渲染边界", () => {
  it("非拖动时不存在（日常不增视觉噪音）", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0)]);
    expect(pointRows()).toHaveLength(2);
    expect(emptyTargets()).toEqual([]);
  });

  it("目标字段非空时不给该字段出占位行", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [TECH], achievements: [AWARD_A, AWARD_B] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0)]);
    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    expect(pointRows()).toHaveLength(3);
    expect(emptyTargets()).toEqual([]);
  });

  it("条目折叠时不存在（拖动中折叠也立刻收起）", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0)]);
    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    expect(emptyTargets()).toHaveLength(1);

    const caret = treeitem(entryKeyOfContent(content, 0)).querySelector(".resume-outline-caret");
    if (!caret) throw new Error("caret missing");
    fireEvent.click(caret);
    expect(emptyTargets()).toEqual([]);
    // 拖动会话本身还在（说明"没有占位行"是折叠造成的，不是拖动没开始）。
    expect(treeEl().className).toContain("is-dragging");
  });

  it("只给被拖的那个条目出占位行（同内容的另一条目一个都没有）", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
      { school: SCHOOL_B, courses: [], achievements: [AWARD_B1, AWARD_B2] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0), entryKeyOfContent(content, 1)]);
    const idOfA = entryIdOf(entriesOf(content, "education")[0]);
    const idOfB = entryIdOf(entriesOf(content, "education")[1]);

    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    const keys = emptyTargets().map((item) => item.dataset.treeKey);
    expect(keys).toEqual([`point-empty:education:${idOfA}:courses`]);
    expect(keys.some((key) => key?.includes(idOfB))).toBe(false);
  });

  it("拖 A 的要点压住 B 条目的行上：预览不动、松手 0 条命令、内容不变", async () => {
    // 真机上"压住 B 的占位行"与"压住 B 的要点行"走同一条几何拒绝分支
    // （`pointerOverForeignRow`）：占位行只给被拖条目渲染，所以这里用 B 的真实要点行取证。
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
      { school: SCHOOL_B, courses: [], achievements: [AWARD_B1, AWARD_B2] },
    ]);
    const { commands, latestRef } = renderPanel(content, [
      entryKeyOfContent(content, 0),
      entryKeyOfContent(content, 1),
    ]);
    const snapshot = JSON.stringify(content);
    const dataTransfer = dragData();
    const tree = treeEl();
    const rowA = rowByText(AWARD_A);

    fireEvent.dragStart(rowA, { dataTransfer });
    expect(orderOf(rowA)).toBe("1");
    stubRect(rowByText(AWARD_B1), 490, 28);
    fireDragAt("dragover", tree, dataTransfer, 500);
    await settle();
    // 压在别人的行上不是"本组内排序"：预览维持真实顺序，也没有高亮目标。
    expect(orderOf(rowA)).toBe("1");
    expect(dropTargetKeys()).toEqual([]);

    fireDragAt("drop", tree, dataTransfer, 500);
    expect(commands).toEqual([]);
    expect(JSON.stringify(latestRef.current)).toBe(snapshot);
    expect(tree.className).not.toContain("is-dragging");
  });

  it("readOnly 宿主：拖不起来，也没有占位行", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0)], { readOnly: true });
    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    expect(emptyTargets()).toEqual([]);
    expect(treeEl().className).not.toContain("is-dragging");
  });

  it("锁排版的条目没有占位行（同一份内容里没锁的条目照常有）", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B], lockLayout: true },
      { school: SCHOOL_B, courses: [], achievements: [AWARD_B1, AWARD_B2] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0), entryKeyOfContent(content, 1)]);
    const idOfB = entryIdOf(entriesOf(content, "education")[1]);

    // 锁排版：拖动被命令层拒绝（拿不到拖动载荷），占位行不出现。
    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    expect(emptyTargets()).toEqual([]);
    expect(treeEl().className).not.toContain("is-dragging");

    // 同内容的另一条（没锁）照常有占位行 → 上面的空不是因为整棵树不好使。
    fireEvent.dragStart(rowByText(AWARD_B1), { dataTransfer: dragData() });
    expect(emptyTargets().map((item) => item.dataset.treeKey)).toEqual([
      `point-empty:education:${idOfB}:courses`,
    ]);
  });

  it("搜索态不出现（结果列表里没有落点槽位，但要点行仍可拖起）", () => {
    const content = educationContent([
      { school: SCHOOL_A, courses: [], achievements: [AWARD_A, AWARD_B] },
    ]);
    renderPanel(content, [entryKeyOfContent(content, 0)]);
    fireEvent.change(screen.getByLabelText(t("outline.search.label")), {
      target: { value: SCHOOL_A },
    });
    fireEvent.dragStart(rowByText(AWARD_A), { dataTransfer: dragData() });
    expect(treeEl().className).toContain("is-dragging");
    expect(emptyTargets()).toEqual([]);
  });
});
