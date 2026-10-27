// SPDX-License-Identifier: Apache-2.0
/**
 * #4 回归：**窄档（两栏 / 单栏）下大纲排序必须一路走到右栏预览，而且存得下去**。
 *
 * 现象（用户反馈 #4）：制作台窗口宽度 ≤1280px 时，中栏被收进抽屉；此时在大纲里上移/下移
 * 一条，左栏的树变了，但右栏预览不动、顶部也没有「保存修改」。原因是结构命令的正文只写进
 * 统一历史：中栏未挂载时 `editorRef.replaceContent` 是空操作，草稿 store（右栏唯一正文来源）
 * 与脏值都不会更新。
 *
 * 这条用例走**真实组件链路**（不 mock 掉接线层）：大纲面板 → OutlineCommand →
 * useWorkbenchOutline → history.commitContent → 草稿 store → ResumeWorkbenchLiveCanvas →
 * renderResume；保存再走「无编辑器时的正文保存出口」。只把「服务端重排」与「画布本体」换成替身。
 * 宽档对照组同时保留：宽档一直是对的，用它证明失败只来自窄档差异。
 */
import { App as AntdApp } from "antd";
import { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { entriesOf } from "../../../features/resume-outline/model";
import type { ResumeContent, ResumeLayout } from "../../../types";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../../ResumeLayoutControls.testkit";
import ResumeZoomModal from "../ResumeZoomModal";

const renderResume = vi.hoisted(() =>
  vi.fn<(content: ResumeContent, layout: ResumeLayout, signal?: AbortSignal) => Promise<string>>(
    async () => "<html></html>",
  ),
);
vi.mock("../../../api/resumeLayout", () => ({ renderResume }));
vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布本体（真 iframe + 量高）与本用例无关；这里只断言「喂给它的是哪一版内容」。
vi.mock("../ResumeWorkbenchCanvas", () => ({
  default: ({ html }: { html: string }) => <div data-testid="canvas-html" data-html={html} />,
}));

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";

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
    ],
    skills: [],
    awards: [],
  });
}

const CONTENT = content();
const OPENING_LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

/**
 * 模拟视口宽度对应的断点：`matches` 只对"断点值 ≥ 当前宽度"的查询为真，
 * 与真实 matchMedia 的语义一致（宽档传 1680 → 两条查询都不命中）。
 */
function stubViewport(width: number): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => {
      const limit = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? 0);
      return {
        matches: limit > 0 && width <= limit,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      };
    },
  });
}

interface HarnessProps {
  initialContent?: ResumeContent;
  onSaveContent?: (next: ResumeContent) => void;
  onCommitLayout?: () => Promise<boolean>;
}

/** 与 ResumeDetailModal 同形的最小宿主：保存成功后把正文回灌（setDetail 的那一拍）。 */
function Harness({ initialContent = CONTENT, onSaveContent, onCommitLayout }: HarnessProps) {
  const [layout, setLayout] = useState<ResumeLayout>(OPENING_LAYOUT);
  const [hostContent, setHostContent] = useState<ResumeContent>(initialContent);
  return (
    <AntdApp>
      <ResumeZoomModal
        open
        html="<html></html>"
        warnings={[]}
        pages={1}
        onClose={vi.fn()}
        layout={layout}
        resumeId={42}
        content={hostContent}
        onApplyLayout={(next) => setLayout(next)}
        onCommitLayout={onCommitLayout ?? (async () => true)}
        onSaveContent={async (next) => {
          setHostContent(next);
          onSaveContent?.(next);
        }}
      />
    </AntdApp>
  );
}

function sortHandle(name: string): HTMLElement {
  const escaped = t("outline.sort.handle", { name }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return screen.getByRole("button", { name: new RegExp(escaped.split("").join("\\s*")) });
}

function openOutline(): void {
  fireEvent.click(screen.getByText(t("outline.panel.title")));
}

function treeOrder(): string[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(
      '[data-tree-key^="entry:projects:"] .resume-outline-title',
    ),
  ).map((element) => element.textContent ?? "");
}

/** 预览侧收到的正文里，项目条目的顺序（最后一次 /resumes/render 入参）。 */
function previewOrder(): string[] {
  const calls = renderResume.mock.calls;
  if (calls.length === 0) return [];
  return entriesOf(calls[calls.length - 1][0], "projects").map((entry) => String(entry.name ?? ""));
}

function moveSecondProjectUp(): void {
  const handle = sortHandle(PROJECT_B);
  fireEvent.focus(handle);
  fireEvent.keyDown(handle, { key: "Enter" });
  fireEvent.keyDown(handle, { key: "ArrowUp" });
  fireEvent.keyDown(handle, { key: "Enter" });
}

function saveButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: new RegExp(t("workbench.action.save-changes")) });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe("窄档（两栏/单栏）下大纲排序 → 右栏预览", () => {
  it("宽档对照组：上移后预览拿到新顺序（既有行为，防止把宽档改坏）", async () => {
    stubViewport(1680);
    render(<Harness />);
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(treeOrder()).toEqual([PROJECT_A, PROJECT_B]);

    moveSecondProjectUp();
    expect(treeOrder()).toEqual([PROJECT_B, PROJECT_A]);
    await waitFor(() => expect(previewOrder()).toEqual([PROJECT_B, PROJECT_A]), { timeout: 4000 });
  }, 20000);

  it("窄档：上移后预览同样拿到新顺序，并出现「保存修改」入口（用户反馈 #4 的原形）", async () => {
    stubViewport(1180);
    render(<Harness />);
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(treeOrder()).toEqual([PROJECT_A, PROJECT_B]);
    expect(saveButton()).toBeNull();

    moveSecondProjectUp();
    expect(treeOrder()).toEqual([PROJECT_B, PROJECT_A]);
    // 树变了只是"界面变了"；预览必须一起变，否则用户看到的是两份互相矛盾的顺序。
    await waitFor(() => expect(previewOrder()).toEqual([PROJECT_B, PROJECT_A]), { timeout: 4000 });
    // 改动能被看见还不够：它必须被当成"改动"，否则存不下去也拦不住关闭。
    await waitFor(() => expect(saveButton()).not.toBeNull());
  }, 20000);

  it("窄档：有未保存的正文时关闭会先问一句（不再静默丢弃）", async () => {
    stubViewport(1180);
    render(<Harness />);
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    moveSecondProjectUp();
    await waitFor(() => expect(previewOrder()).toEqual([PROJECT_B, PROJECT_A]), { timeout: 4000 });

    fireEvent.click(screen.getByRole("button", { name: t("common.action.close") }));
    expect(await screen.findByText(t("workbench.close.title"))).toBeInTheDocument();
  }, 20000);

  it("窄档：保存把正文真正发出去；宿主回灌后脏值清空，重开仍是新顺序", async () => {
    stubViewport(1180);
    const onSaveContent = vi.fn<(next: ResumeContent) => void>();
    const onCommitLayout = vi.fn(async () => true);
    const { unmount } = render(
      <Harness onSaveContent={onSaveContent} onCommitLayout={onCommitLayout} />,
    );
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    moveSecondProjectUp();
    await waitFor(() => expect(previewOrder()).toEqual([PROJECT_B, PROJECT_A]), { timeout: 4000 });

    fireEvent.click(saveButton() as HTMLElement);
    await waitFor(() => expect(onSaveContent).toHaveBeenCalledTimes(1));
    const saved = onSaveContent.mock.calls[0][0];
    expect(entriesOf(saved, "projects").map((entry) => entry.name)).toEqual([PROJECT_B, PROJECT_A]);
    // 保存成功后动作条收起保存入口（脏值归零）。
    await waitFor(() => expect(saveButton()).toBeNull());

    // 「重新打开」：用保存出去的正文作为记录内容重挂载，树顺序必须还是新序。
    unmount();
    document.body.innerHTML = "";
    render(<Harness initialContent={saved} />);
    openOutline();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(treeOrder()).toEqual([PROJECT_B, PROJECT_A]);
  }, 30000);
});
