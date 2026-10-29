// SPDX-License-Identifier: Apache-2.0
/**
 * **空要点字段占位行**的端到端回归（F1）：拖动中给"已声明但为空"的要点字段一行虚线槽位，
 * 松手就把这条搬回去。
 *
 * 为什么必须有这一条：跨字段搬移把 `courses` 搬空之后，大纲里没有课程行，落点再也推不出
 * `targetField = courses`——用户视角就是"**拖走就拖不回来**"（单向门）。这个测试直接证明
 * 反向搬移成立：`courses` 拿到那一条、`achievements` 少一条、且两份 `point_ids` 与数组等长。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import { useState } from "react";
import OutlinePanel from "./OutlinePanel";

const [AWARD_A, AWARD_B] = ["奖学金", "优秀学生"];

function makeContent(courses: string[] = [], achievements: string[] = [AWARD_A, AWARD_B]) {
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
        school: "上海大学",
        major: "市场营销",
        degree: "本科",
        gpa: "",
        start_date: "",
        end_date: "",
        courses,
        achievements,
      },
    ],
    experience: [],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  });
}

function entryTreeKey(source: ResumeContent): string {
  return `entry:education:${entryIdOf(entriesOf(source, "education")[0])}`;
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error("treeitem missing: " + key);
  return element;
}

function emptyTargets(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="point-empty:"]'));
}

function pointRows(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point"));
}

/** jsdom 没有真 DataTransfer：只要 dragstart 能拿到对象、dragover/drop 能带上它即可。 */
function dragData(): DataTransfer {
  return {
    setData: () => undefined,
    getData: () => "",
    effectAllowed: "move",
    dropEffect: "move",
    files: [],
    items: [],
    types: [],
    clearData: () => undefined,
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
  latestRef: { current: ResumeContent };
}

function Harness({ initial, commands, latestRef }: HarnessProps) {
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
      <OutlinePanel content={content} onCommand={onCommand} />
    </AntdApp>
  );
}

function renderPanel(initial: ResumeContent) {
  const commands: OutlineCommand[] = [];
  const latestRef = { current: initial };
  render(
    <AntdApp>
      <Harness initial={initial} commands={commands} latestRef={latestRef} />
    </AntdApp>,
  );
  // 展开教育经历板块与第一个条目。
  fireEvent.keyDown(treeitem("section:education"), { key: "ArrowRight" });
  fireEvent.keyDown(treeitem(entryTreeKey(initial)), { key: "ArrowRight" });
  return { commands, latestRef };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("空要点字段的占位行", () => {
  it("非拖动时不出现（不增日常噪音）", () => {
    const content = makeContent();
    renderPanel(content);
    expect(pointRows()).toHaveLength(2);
    expect(emptyTargets()).toEqual([]);
  });

  it("拖动同条目要点时出现：文案 + 字段归属标签 + point-empty 键", () => {
    const content = makeContent();
    renderPanel(content);
    const dataTransfer = dragData();
    fireEvent.dragStart(pointRows()[0], { dataTransfer });

    const targets = emptyTargets();
    expect(targets).toHaveLength(1);
    const target = targets[0];
    expect(target.dataset.treeKey).toBe(
      `point-empty:education:${entryIdOf(entriesOf(content, "education")[0])}:courses`,
    );
    expect(target.textContent).toContain(t("outline.point.emptyTarget"));
    // 标签复用编辑器字段名（核心课程），不是机器键名。
    const tag = target.querySelector<HTMLElement>(".resume-outline-field-tag");
    expect(tag?.dataset.pointField).toBe("courses");
    expect(tag?.textContent).toBe(t("editor.field.courses"));
    // 不是要点：没有 id、不可拖、不参与键盘导航。
    expect(target.getAttribute("tabindex")).toBe("-1");
    expect(target.querySelector("[draggable='true']")).toBeNull();
    expect(target.getAttribute("aria-selected")).toBe("false");

    fireEvent.dragEnd(pointRows()[0]);
    expect(emptyTargets()).toEqual([]);
  });

  it("字段非空时不给该字段出占位行（只有真的空了才需要槽位）", () => {
    const content = makeContent(["市场营销学"]);
    renderPanel(content);
    fireEvent.dragStart(pointRows()[0], { dataTransfer: dragData() });
    // 课程已有一条要点 → 没有占位行；成果字段也非空。
    expect(emptyTargets()).toEqual([]);
  });

  it("松在占位行上 → 一条 move-point（toIndex 0），课程拿回那一条且两份 id 与数组等长", () => {
    const content = makeContent();
    const { commands, latestRef } = renderPanel(content);
    const dataTransfer = dragData();
    const row = pointRows()[0];
    fireEvent.dragStart(row, { dataTransfer });
    fireEvent.drop(emptyTargets()[0], { dataTransfer });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "move-point",
      field: "education",
      fromPointField: "achievements",
      toPointField: "courses",
      toIndex: 0,
    });

    const entry = entriesOf(latestRef.current, "education")[0];
    expect(entry.courses).toEqual([AWARD_A]);
    expect(entry.achievements).toEqual([AWARD_B]);
    // 保存契约：point_ids 与数组等长、同一数组内 id 唯一。
    for (const pointField of ["courses", "achievements"] as const) {
      const values = entry[pointField];
      const ids = pointIdsOf(entry, pointField);
      expect(ids).toHaveLength(Array.isArray(values) ? values.length : 0);
      expect(new Set(ids).size).toBe(ids.length);
    }
    // 搬回来之后课程字段非空 → 占位行消失（拖动已结束，本来也不该有）。
    expect(emptyTargets()).toEqual([]);
  });

  it("悬停占位行 → 预览复位成真实顺序（被拖行回到原来的 order）", async () => {
    const content = makeContent();
    renderPanel(content);
    const dataTransfer = dragData();
    const rows = pointRows();
    fireEvent.dragStart(rows[0], { dataTransfer });
    // 被拖要点是成果第一条：base order = 2 * 0 + 1 = 1（order 写在 treeitem 上，不是行上）。
    expect(orderOf(rows[0])).toBe("1");

    // 先悬停到另一条普通要点行 → 预览位移（order 变成 2 * 1 + 1 = 3）。
    fireEvent.dragOver(rows[1], { dataTransfer });
    expect(orderOf(rows[0])).toBe("3");

    // 再把指针移进空字段占位行（真机上 drop 目标恒为树容器，这里同样在树容器上派发）。
    const target = emptyTargets()[0];
    const targetRow = target.querySelector<HTMLElement>(".resume-outline-row");
    if (!targetRow) throw new Error("placeholder row missing");
    stubRect(targetRow, 490, 28);
    const tree = document.querySelector<HTMLElement>(".resume-outline-tree");
    if (!tree) throw new Error("tree missing");
    fireDragAt("dragover", tree, dataTransfer, 500);
    await settleHover();

    // 复位：列表回到真实顺序，只有占位行高亮。
    expect(orderOf(rows[0])).toBe("1");
    expect(targetRow.className).toContain("is-drop-target");
  });
});

/** 一行的视觉顺序写在它的 treeitem 上（CSS `order`，DOM 顺序保持稳定）。 */
function orderOf(row: HTMLElement): string {
  const treeitem = row.closest<HTMLElement>("[data-tree-key]");
  return treeitem ? treeitem.style.order : "";
}

/**
 * jsdom 没有 DragEvent：RTL 会退化成普通 Event 而丢掉 `clientY`（几何判定必须拿到真实坐标）。
 * 所以这里自己建事件并挂上 `clientY` / `dataTransfer`，派发目标是**树容器**。
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

/** 悬停解析合并到一帧一次（rAF）：让出两帧再断言。 */
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

/** 给行元素一个固定的行矩形（jsdom 没有布局，`collectRowBoxes` 量出来全是 0）。 */
function stubRect(element: HTMLElement, top: number, height: number): void {
  const rect = {
    top,
    bottom: top + height,
    height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
  element.getBoundingClientRect = () => rect;
}
