// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲**拖拽排序**测试（W06 / 2026-10-25 用户反馈：拖动时树与右栏简历都要实时换位）。
 *
 * jsdom 没有真实拖放，所以用 dataTransfer 桩手动派发 dragstart → dragOver → dragend / drop。
 * 断言的是三条用户可见性质：
 * 1. dragOver 到目标行后，树（previewTree）**立即**按新顺序渲染；同目标重复 dragOver 不再换位；
 * 2. `onStructurePreview` 收到与"松手提交"同一条命令算出来的内容（不派发命令），
 *    dragend / drop 结束后回调 null（预览收起）；
 * 3. 条目手柄与要点手柄的 class / 图标 / aria-label 都不同（不再是一个六点手柄走天下）。
 *
 * 中文只出现在夹具常量里；断言用 `t()` 或常量。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { applyOutlineCommand } from "../../../features/resume-outline/commands";
import { entriesOf, entryIdOf, pointIdsOf } from "../../../features/resume-outline/model";
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

/** 条目顺序（读标题而不是整行文本：徽标/要点计数会混进 textContent）。 */
function entryOrder(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
  ).map((element) => element.querySelector(".resume-outline-title")?.textContent ?? "");
}

/** 要点顺序（只取条目内可见的要点行）。 */
function pointOrder(): string[] {
  return Array.from(document.querySelectorAll<HTMLElement>(".resume-outline-row.is-point")).map(
    (element) => element.querySelector(".resume-outline-point-text")?.textContent ?? "",
  );
}

/** 最小 dataTransfer 桩：dragstart 里 setData、dragOver 里只读事件，不涉及真实剪贴板。 */
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

interface HarnessProps {
  initial: ResumeContent;
  commands: OutlineCommand[];
  previews: (ResumeContent | null)[];
}

function Harness({ initial, commands, previews }: HarnessProps) {
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

function renderPanel() {
  const initial = makeContent();
  const commands: OutlineCommand[] = [];
  const previews: (ResumeContent | null)[] = [];
  render(<Harness initial={initial} commands={commands} previews={previews} />);
  return { initial, commands, previews };
}

function entryHandle(name: string): HTMLElement {
  return screen.getByRole("button", { name: t("outline.sort.handle", { name }) });
}

/** 展开某条目的要点（键盘等价物：→ 在已展开/未展开两态都能看到要点行）。 */
function expandPoints(initial: ResumeContent, name: string): void {
  fireEvent.keyDown(treeitem(`entry:projects:${projectId(initial, name)}`), { key: "ArrowRight" });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("条目拖拽：实时换位 + 实时结构预览", () => {
  it("dragOver 到目标行 → 树立即换位、onStructurePreview 收到同序内容、拖动中不派发命令", () => {
    const { initial, commands, previews } = renderPanel();
    const dataTransfer = dragData();
    const ids = entriesOf(initial, "projects").map((entry) => entryIdOf(entry));

    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    // 起拖不换位：会话的 currentIndex 还是原下标。
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);

    fireEvent.dragOver(entryRow(initial, PROJECT_C), { dataTransfer });
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);

    const preview = previews[previews.length - 1];
    expect(preview).not.toBeNull();
    expect(entriesOf(preview as ResumeContent, "projects").map((entry) => entry.name)).toEqual([
      PROJECT_A,
      PROJECT_C,
      PROJECT_B,
    ]);
    // 身份跟着条目走（排序不换 id）。
    expect(
      entriesOf(preview as ResumeContent, "projects").map((entry) => entryIdOf(entry)),
    ).toEqual([ids[0], ids[2], ids[1]]);
    // 拖动过程不提交：历史/保存链路上一条命令都没有。
    expect(commands).toHaveLength(0);
  });

  it("同一目标重复 dragOver 不重复回调；dragend（拖到条目外/取消）恢复原序并回调 null", () => {
    const { initial, commands, previews } = renderPanel();
    const dataTransfer = dragData();
    const handle = entryHandle(PROJECT_B);
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(entryRow(initial, PROJECT_C), { dataTransfer });
    const callsAfterFirstTarget = previews.length;

    fireEvent.dragOver(entryRow(initial, PROJECT_C), { dataTransfer });
    expect(previews.length).toBe(callsAfterFirstTarget);

    fireEvent.dragEnd(handle);
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    expect(previews[previews.length - 1]).toBeNull();
    expect(commands).toHaveLength(0);
  });

  it("drop 到目标行 → 只派发一条 reorder 命令（toIndex = 目标行下标），提交后树保持新序", () => {
    const { initial, commands, previews } = renderPanel();
    const dataTransfer = dragData();
    fireEvent.dragStart(entryHandle(PROJECT_B), { dataTransfer });
    fireEvent.dragOver(entryRow(initial, PROJECT_C), { dataTransfer });
    fireEvent.drop(entryRow(initial, PROJECT_C), { dataTransfer });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-entry",
      field: "projects",
      objectId: projectId(initial, PROJECT_B),
      toIndex: 2,
    });
    // 松手后预览收起，树显示的是**真正提交**的那份内容。
    expect(previews[previews.length - 1]).toBeNull();
    expect(entryOrder()).toEqual([PROJECT_A, PROJECT_C, PROJECT_B]);
  });
});

describe("要点拖拽：同一 pointField 分组内实时换位", () => {
  it("dragOver 另一条要点 → 要点实时换位、预览内容同步；dragend 恢复原序", () => {
    const { initial, commands, previews } = renderPanel();
    expandPoints(initial, PROJECT_B);
    expect(pointOrder()).toEqual([POINT_B1, POINT_B2]);

    const dataTransfer = dragData();
    const [firstPointHandle, secondPointHandle] = screen.getAllByRole("button", {
      name: t("outline.sort.pointHandle"),
    });
    fireEvent.dragStart(firstPointHandle, { dataTransfer });
    fireEvent.dragOver(secondPointHandle.closest(".resume-outline-row") as HTMLElement, {
      dataTransfer,
    });

    expect(pointOrder()).toEqual([POINT_B2, POINT_B1]);
    const preview = previews[previews.length - 1] as ResumeContent;
    const previewEntry = entriesOf(preview, "projects").find((entry) => entry.name === PROJECT_B);
    expect(previewEntry?.description).toEqual([POINT_B2, POINT_B1]);
    expect(commands).toHaveLength(0);

    fireEvent.dragEnd(firstPointHandle);
    expect(pointOrder()).toEqual([POINT_B1, POINT_B2]);
    expect(previews[previews.length - 1]).toBeNull();
  });

  it("drop 到另一条要点 → 一条 reorder-point 命令（要点 id 与 toIndex 正确）", () => {
    const { initial, commands } = renderPanel();
    expandPoints(initial, PROJECT_B);
    const entry = entriesOf(initial, "projects").find((item) => item.name === PROJECT_B);
    const pointId = pointIdsOf(entry, "description")[0];

    const dataTransfer = dragData();
    const [firstPointHandle, secondPointHandle] = screen.getAllByRole("button", {
      name: t("outline.sort.pointHandle"),
    });
    fireEvent.dragStart(firstPointHandle, { dataTransfer });
    fireEvent.dragOver(secondPointHandle.closest(".resume-outline-row") as HTMLElement, {
      dataTransfer,
    });
    fireEvent.drop(secondPointHandle.closest(".resume-outline-row") as HTMLElement, {
      dataTransfer,
    });

    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({
      type: "reorder-point",
      field: "projects",
      objectId: projectId(initial, PROJECT_B),
      pointField: "description",
      pointId,
      toIndex: 1,
    });
    expect(pointOrder()).toEqual([POINT_B2, POINT_B1]);
  });
});

describe("两类排序手柄必须一眼可分", () => {
  it("条目手柄（六点 / 18px 语义类）与要点手柄（三横线 / 14px 语义类）的 class、图标、aria 文案都不同", () => {
    const { initial } = renderPanel();
    expandPoints(initial, PROJECT_B);

    const entry = entryHandle(PROJECT_B);
    const point = screen.getAllByRole("button", { name: t("outline.sort.pointHandle") })[0];

    expect(entry).toHaveClass("resume-outline-handle", "is-entry");
    expect(entry).not.toHaveClass("is-point");
    expect(point).toHaveClass("resume-outline-handle", "is-point");
    expect(point).not.toHaveClass("is-entry");

    // 图标不同：条目 = 六点（HolderOutlined），要点 = 三横线（MenuOutlined）。
    expect(entry.querySelector(".anticon-holder")).not.toBeNull();
    expect(entry.querySelector(".anticon-menu")).toBeNull();
    expect(point.querySelector(".anticon-menu")).not.toBeNull();
    expect(point.querySelector(".anticon-holder")).toBeNull();

    // 可访问名各有各的文案（要点不带条目名，避免读屏把整棵树念一遍）。
    expect(entry).toHaveAttribute("aria-label", t("outline.sort.handle", { name: PROJECT_B }));
    expect(point).toHaveAttribute("aria-label", t("outline.sort.pointHandle"));
  });
});
