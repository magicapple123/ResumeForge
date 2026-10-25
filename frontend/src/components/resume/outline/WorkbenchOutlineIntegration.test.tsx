// SPDX-License-Identifier: Apache-2.0
/**
 * W06 端到端（task-31）：真实左栏挂载 → 大纲命令 → 编辑器写回 → 保存 payload。
 *
 * 这条用例补的是组件测试覆盖不到的三根线：
 * 1. 左栏 Segmented 切到「文档大纲」后 OutlinePanel 真的在；
 * 2. 大纲命令经 useWorkbenchOutline 走完 apply → buildPathRemap → replaceContent；
 * 3. 保存 payload（不是内存对象）里顺序变了、id/point_ids/hidden 没丢——
 *    W06 的"排序不换 id、隐藏可恢复"只有在保存边界成立才算数。
 *
 * 画布与目录用桩（结构断言与本用例无关），断言文案走 t()。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { ensureIds } from "../../../features/resume-document/identity";
import { buildOutline, entriesOf, entryIdOf } from "../../../features/resume-outline/model";
import type { ResumeContent } from "../../../types/resume";
import type { ResumeLayout } from "../../../types";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import { renderModal } from "../ResumeZoomModal.testkit";

const PROJECT_A = "项目甲";
const PROJECT_B = "项目乙";

vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
// 画布桩：真的渲染一个（空）iframe，让大纲的高亮注入有落点。
vi.mock("../../ResumePreview", () => ({
  default: () => <iframe title="workbench-preview" />,
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
        description: ["乙一", "乙二"],
        highlights: [],
      },
    ],
    skills: [],
    awards: [],
  });
}

const CONTENT = content();
const PROJECT_B_ID = entryIdOf(entriesOf(CONTENT, "projects")[1]);
const PROJECT_B_POINT_IDS = entriesOf(CONTENT, "projects")[1].point_ids;

function button(label: string): HTMLElement {
  const target = label.replace(/\s/g, "");
  return screen.getByRole("button", {
    name: (accessibleName: string) => accessibleName.replace(/\s/g, "").includes(target),
  });
}

function openOutlineTab(): void {
  fireEvent.click(screen.getByText(t("outline.panel.title")));
}

function renderWorkbench(props: Parameters<typeof renderModal>[0] = {}) {
  // renderModal 自带 AntdApp 包裹。
  return renderModal({ content: CONTENT, ...props });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W06 真实挂载", () => {
  it("左栏切到「文档大纲」后出现语义树与条目", async () => {
    renderWorkbench();
    expect(document.querySelector(".resume-wb-col-params")).not.toBeNull();
    openOutlineTab();
    expect(await screen.findByRole("tree", { name: t("outline.tree.label") })).toBeInTheDocument();
    expect(screen.getByText(PROJECT_B)).toBeInTheDocument();
  });

  it("只读宿主（无 onSaveContent）：大纲仍在，但不渲染排序手柄", async () => {
    renderWorkbench({ onSaveContent: undefined });
    openOutlineTab();
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(screen.getByText(t("outline.readonly"))).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: (accessibleName: string) =>
          accessibleName.includes(t("outline.sort.handle", { name: PROJECT_B })),
      }),
    ).toBeNull();
  });
});

describe("结构命令 → 保存 payload（W06 硬要求）", () => {
  it("第二项目上移：保存 payload 顺序变、id/point_ids 不变、overlay remap 键跟随", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    const onRemapPaths = vi.fn<(remap: Map<string, string>) => void>(() => undefined);
    renderWorkbench({ onSaveContent, onRemapPaths });
    openOutlineTab();
    await screen.findByRole("tree", { name: t("outline.tree.label") });

    const handle = button(t("outline.sort.handle", { name: PROJECT_B }));
    fireEvent.focus(handle);
    fireEvent.keyDown(handle, { key: "Enter" });
    fireEvent.keyDown(handle, { key: "ArrowUp" });
    fireEvent.keyDown(handle, { key: "Enter" });

    // 宿主拿到的是"旧下标 → 新下标"的映射（加粗 overlay 用它改键）。
    await waitFor(() => expect(onRemapPaths).toHaveBeenCalled());
    const remap = onRemapPaths.mock.calls[0][0];
    expect(remap.get("projects.1.name")).toBe("projects.0.name");

    // 保存：动作条上的整体保存（内容脏由 replaceContent 标出）。
    fireEvent.click(button(t("workbench.action.save-changes")));
    await waitFor(() => expect(onSaveContent).toHaveBeenCalled());
    const saved = onSaveContent.mock.calls[0][0];

    // 顺序变了；但身份不换、要点身份跟着条目走。
    expect(entriesOf(saved, "projects").map((entry) => entry.name)).toEqual([PROJECT_B, PROJECT_A]);
    expect(entryIdOf(entriesOf(saved, "projects")[0])).toBe(PROJECT_B_ID);
    expect(entriesOf(saved, "projects")[0].point_ids).toEqual(PROJECT_B_POINT_IDS);
    expect(entriesOf(saved, "projects")[1]).not.toHaveProperty("hidden");

    // 「重开」语义：保存出去的 JSON 再读回来，id 仍相同、重新构建大纲顺序正确。
    const reopened = ensureIds(JSON.parse(JSON.stringify(saved)) as ResumeContent);
    expect(entryIdOf(entriesOf(reopened, "projects")[0])).toBe(PROJECT_B_ID);
    expect(
      buildOutline(reopened).sections.find((section) => section.field === "projects")?.entries[0]
        .title,
    ).toBe(PROJECT_B);
  });

  it("选中条目 → 画布 iframe 注入该条目的前缀高亮（大纲与纸面同一套 path 口径）", async () => {
    renderWorkbench();
    openOutlineTab();
    const tree = await screen.findByRole("tree", { name: t("outline.tree.label") });

    const frame = document.querySelector<HTMLIFrameElement>("iframe[title='workbench-preview']");
    expect(frame).not.toBeNull();
    const doc = frame?.contentDocument;
    expect(doc).not.toBeNull();
    if (!doc) return;
    doc.body.innerHTML =
      '<span data-resume-path="projects.1.name">项目乙</span><span data-resume-path="projects.0.name">项目甲</span>';
    frame?.dispatchEvent(new Event("load"));

    fireEvent.click(within(tree).getByText(PROJECT_B));
    await waitFor(() => {
      const style = doc.getElementById("rf-outline-highlight");
      expect(style).not.toBeNull();
      expect(style?.textContent).toContain('[data-resume-path^="projects.1."]');
    });
  });

  it("复制条目 → 保存 payload 多一条、新条目身份全新", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    renderWorkbench({ onSaveContent });
    openOutlineTab();
    const tree = await screen.findByRole("tree", { name: t("outline.tree.label") });

    fireEvent.click(within(tree).getByText(PROJECT_A));
    fireEvent.click(button(t("outline.action.clone")));
    fireEvent.click(button(t("workbench.action.save-changes")));
    await waitFor(() => expect(onSaveContent).toHaveBeenCalled());
    const saved = onSaveContent.mock.calls[0][0];
    const projects = entriesOf(saved, "projects");
    expect(projects).toHaveLength(3);
    const ids = projects.map((entry) => entryIdOf(entry));
    expect(new Set(ids).size).toBe(3);
    expect(ids.filter((id) => id === PROJECT_B_ID)).toHaveLength(1);
  });

  it("隐藏条目 → 保存 payload 写 hidden:true（导出过滤由 W06-BE 负责）", async () => {
    const onSaveContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    renderWorkbench({ onSaveContent });
    openOutlineTab();
    await screen.findByRole("tree", { name: t("outline.tree.label") });

    fireEvent.click(within(screen.getByRole("tree")).getByText(PROJECT_B));
    fireEvent.click(screen.getByRole("switch", { name: t("outline.inspector.toggleHidden") }));
    fireEvent.click(button(t("workbench.action.save-changes")));
    await waitFor(() => expect(onSaveContent).toHaveBeenCalled());
    const saved = onSaveContent.mock.calls[0][0];
    const hiddenEntry = entriesOf(saved, "projects").find((entry) => entry.name === PROJECT_B);
    expect(hiddenEntry?.hidden).toBe(true);
    expect(hiddenEntry?.description).toEqual(["乙一", "乙二"]);
  });
});

describe("多选 → 参数栏批量应用 → 返回大纲（fe-mount 接线验证）", () => {
  it("大纲空格多选 → 参数栏出现批量条并应用一次 layout；回大纲多选已清、无残留目标", async () => {
    const onApplyLayout = vi.fn();
    renderWorkbench({ onApplyLayout });
    openOutlineTab();
    const tree = await screen.findByRole("tree", { name: t("outline.tree.label") });
    const entries = Array.from(
      tree.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]'),
    );
    expect(entries).toHaveLength(2);
    fireEvent.keyDown(entries[0], { key: " " });
    fireEvent.keyDown(entries[1], { key: " " });
    expect(screen.getByText(t("outline.batch.selected", { count: 2 }))).toBeInTheDocument();

    // 切到「排版参数」页签：大纲卸载，但 shell 已把多选上提，批量条仍在且是 2 条。
    fireEvent.click(screen.getByText(t("responsive.action.params")));
    expect(await screen.findByText(t("typography.multi.title"))).toBeInTheDocument();
    expect(screen.getByText(t("typography.multi.count", { count: 2 }))).toBeInTheDocument();

    // 批量应用一次 = 一次 layout 提交，两条目标对象都写到 format_config.objects。
    const lineHeight = screen.getByRole("spinbutton", { name: t("typography.prop.line_height") });
    fireEvent.change(lineHeight, { target: { value: "1.6" } });
    fireEvent.blur(lineHeight);
    fireEvent.click(screen.getByRole("button", { name: t("typography.multi.apply") }));
    expect(onApplyLayout).toHaveBeenCalledTimes(1);
    const nextLayout = onApplyLayout.mock.calls[0][0] as ResumeLayout;
    const objects = (
      nextLayout.format_config as unknown as {
        objects?: Record<string, Record<string, unknown>>;
      }
    ).objects;
    const ids = entries.map((element) => (element.dataset.treeKey ?? "").split(":")[2]);
    for (const id of ids) expect(objects?.[id]).toMatchObject({ line_height: 1.6 });

    // 回「文档大纲」：进大纲页签会清空多选（避免对已卸载树上的高亮应用格式）。
    fireEvent.click(screen.getByText(t("outline.panel.title")));
    await screen.findByRole("tree", { name: t("outline.tree.label") });
    expect(screen.queryByText(t("outline.batch.selected", { count: 2 }))).toBeNull();
    // 再回参数栏：批量条不再出现（多选已清，不会对"树上已不存在的高亮"继续应用）。
    fireEvent.click(screen.getByText(t("responsive.action.params")));
    expect(screen.queryByText(t("typography.multi.title"))).toBeNull();
  });
});
