// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲拖拽的**落点容错**回归（用户反馈 #4："拖动大部分情况下无法实现"）。
 *
 * 真机复现出的失败形态（旧实现只有 `.resume-outline-row` 上的行级 drop）：
 * 1. **缝隙/板块标题/分组容器上松手** → 没有 drop 事件（只有 dragend）→ 顺序静默不变；
 * 2. **快速一甩**：dragstart 后没有 dragover 落到目标行就松手 → 同样没有 drop；
 * 3. **拖行/标题（不是 18px 手柄）**根本不会开始拖动。
 *
 * 现在 drop 收在树容器上，落点按 data-tree-key / 纵向最近行解析；整行可拖。
 * 这里用 dataTransfer 桩手动派发事件（jsdom 没有真实拖放），断言：
 * - 没有 dragOver 的"快速 drop"也能提交（落点由 drop 自己解析）；
 * - 松在板块标题 / 分组容器（缝隙）上按就近行提交；
 * - 拖行标题也能起拖；松到别的板块上不提交；
 * - 要点行同样支持快速 drop；命令/历史仍是一条。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import type { ResumeContent } from "../../../types/resume";
import OutlinePanel from "./OutlinePanel";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";
const POINT_B1 = "乙一";
const POINT_B2 = "乙二";

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
        description: [POINT_B1, POINT_B2],
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

/** 条目顺序（读**视觉**顺序：拖动中 DOM 稳定、换位靠 CSS order）。 */
function entryOrder(): string[] {
  return byVisualOrder(
    Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]')),
  ).map((element) => element.querySelector(".resume-outline-title")?.textContent ?? "");
}

/** 要点顺序（视觉顺序）。 */
function pointOrder(): string[] {
  return byVisualOrder(
    Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="point:"]')),
  ).map((element) => element.querySelector(".resume-outline-point-text")?.textContent ?? "");
}

function entryHandle(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
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

describe("松在缝隙 / 板块标题上：按纵向最近行提交", () => {
  it("松在板块标题上 → 落到该板块第一行（就近行）", () => {
    const { commands } = renderPanel();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer: dragData() });
    fireEvent.drop(treeitem("section:projects"), { dataTransfer: dragData(), clientY: 10 });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ type: "reorder-entry", toIndex: 0 });
    expect(entryOrder()).toEqual([PROJECT_B, PROJECT_A, PROJECT_C]);
  });

  it("松在分组容器（行间缝隙）上 → 同样按就近行提交", () => {
    const { commands } = renderPanel();
    fireEvent.dragStart(entryHandle(PROJECT_C), { dataTransfer: dragData() });
    // 取「项目经历」板块自己的分组容器（页面里还有其它板块的空分组）。
    const group = treeitem("section:projects").querySelector<HTMLElement>(".resume-outline-group");
    expect(group).not.toBeNull();
    fireEvent.drop(group as HTMLElement, { dataTransfer: dragData(), clientY: 12 });
    expect(commands).toHaveLength(1);
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
