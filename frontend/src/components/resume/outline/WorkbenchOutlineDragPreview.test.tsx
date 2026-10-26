// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲拖拽 → 右栏画布实时预览的**外壳接线**测试（2026-10-25 用户反馈 ①②）。
 *
 * 覆盖组件单测覆盖不到的三根线：
 * 1. 拖动中 `useWorkbenchOutline.preview` 经 `content=` 传到画布（右栏按新顺序重排）；
 * 2. 拖动中**不**走保存 / 历史提交（onSaveContent 一次都不许被调）；
 * 3. 松手取消 → 画布回到原内容；松手落点 → 只提交一条命令，且**树保持新序**
 *    （大纲的基准内容换成含未保存编辑的草稿版，不再回弹到服务端顺序）。
 *
 * 画布用桩（这里只断言"它收到的正文"，不渲染 iframe），目录用桩（与本用例无关）。
 */
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { ResumeContent } from "../../../types/resume";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { renderModal } from "../ResumeZoomModal.testkit";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";
const PROJECT_C = "项目丙";

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布桩：把收到的 content 原样挂到 data 属性上，供断言"右栏此刻按什么顺序画"。
vi.mock("../ResumeWorkbenchLiveCanvas", () => ({
  default: ({ content }: { content?: ResumeContent | null }) => (
    <div data-testid="canvas-content" data-content={content ? JSON.stringify(content) : ""} />
  ),
}));

function content(): ResumeContent {
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

const CONTENT = content();
const PROJECT_IDS = entriesOf(CONTENT, "projects").map((entry) => entryIdOf(entry));

function button(label: string): HTMLElement {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(escaped.split("").join("\\s*")) });
}

function treeitem(key: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-tree-key="${key}"]`);
  if (!element) throw new Error(`找不到树节点：${key}`);
  return element;
}

function entryKey(name: string): string {
  const index = [PROJECT_A, PROJECT_B, PROJECT_C].indexOf(name);
  return `entry:projects:${PROJECT_IDS[index]}`;
}

function rowOf(name: string): HTMLElement {
  return treeitem(entryKey(name)).querySelector(".resume-outline-row") as HTMLElement;
}

function treeOrder(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
  ).map((element) => element.querySelector(".resume-outline-title")?.textContent ?? "");
}

/** 画布桩收到的正文里，项目条目的顺序（名字）。 */
function canvasOrder(): string[] {
  const raw = screen.getByTestId("canvas-content").dataset.content ?? "";
  const parsed = raw ? (JSON.parse(raw) as ResumeContent) : null;
  return entriesOf(parsed, "projects").map((entry) => String(entry.name ?? ""));
}

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

function openOutline(): void {
  fireEvent.click(screen.getByText(t("outline.panel.title")));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("拖动中：右栏画布实时换位、不提交", () => {
  it("dragOver 目标行 → 画布收到重排内容、树同时换位；dragend 取消后两者都回原序", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    renderModal({ content: CONTENT, onSaveContent });
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });

    expect(treeOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    expect(canvasOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);

    const dataTransfer = dragData();
    const handle = button(t("outline.sort.handle", { name: PROJECT_A }));
    fireEvent.dragStart(handle, { dataTransfer });
    fireEvent.dragOver(rowOf(PROJECT_C), { dataTransfer });

    expect(treeOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);
    expect(canvasOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);
    // 拖动中只有预览：不写库、不提交。
    expect(onSaveContent).not.toHaveBeenCalled();

    fireEvent.dragEnd(handle);
    expect(treeOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    expect(canvasOrder()).toEqual([PROJECT_A, PROJECT_B, PROJECT_C]);
    expect(onSaveContent).not.toHaveBeenCalled();
  });
});

describe("松手落点：提交一条命令，树与保存 payload 都是新序", () => {
  it("drop 后树保持新序（不再回弹），保存 payload 顺序变化且 id 不变", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    renderModal({ content: CONTENT, onSaveContent });
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });

    const dataTransfer = dragData();
    fireEvent.dragStart(button(t("outline.sort.handle", { name: PROJECT_A })), { dataTransfer });
    fireEvent.dragOver(rowOf(PROJECT_C), { dataTransfer });
    fireEvent.drop(rowOf(PROJECT_C), { dataTransfer });

    // 提交已经把新内容写回工作草稿：树不再退回服务端顺序（回弹是本轮要修的现象之一）。
    expect(treeOrder()).toEqual([PROJECT_B, PROJECT_C, PROJECT_A]);
    expect(onSaveContent).not.toHaveBeenCalled();

    fireEvent.click(button(t("workbench.action.save-changes")));
    await waitFor(() => expect(onSaveContent).toHaveBeenCalled());
    const saved = onSaveContent.mock.calls[0][0];
    expect(entriesOf(saved, "projects").map((entry) => entry.name)).toEqual([
      PROJECT_B,
      PROJECT_C,
      PROJECT_A,
    ]);
    expect(entriesOf(saved, "projects").map((entry) => entryIdOf(entry))).toEqual([
      PROJECT_IDS[1],
      PROJECT_IDS[2],
      PROJECT_IDS[0],
    ]);
  });
});
