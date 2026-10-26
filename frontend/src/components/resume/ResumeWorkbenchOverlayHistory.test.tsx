// SPDX-License-Identifier: Apache-2.0
/**
 * W02/W03 收口·**真实外壳接线**：宿主持有的 overlay 经 `documentPipeline` 进入制作台后，
 * 点加粗会记一步"加粗"，撤销会把粗体退回。
 *
 * 为什么还要这一层：`useWorkbenchHistory.overlays.test.tsx` 直接调 `applyOverlay`，证明的是
 * hook 自身；审计要看的是"点纸面加粗"这条真实链路——宿主 state 变 → 外壳的 effect 对齐快照
 * → 历史面板出现这一步。少一根线（pipeline 没带 overlays、effect 没接）这条用例就会红。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeContent, ResumeDetail, ResumeLayout } from "../../types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import type { RichTextOverlayMap } from "../../features/resume/useRichTextOverrides";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "hi",
  education: [],
  experience: [],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

interface Holder {
  overlays: RichTextOverlayMap;
  setOverlays: (next: RichTextOverlayMap) => void;
  saveContent: ReturnType<typeof vi.fn>;
}

function renderWorkbench(): Holder {
  const saveContent = vi.fn(async () => {
    throw new Error("save failed");
  });
  const holder: Holder = { overlays: {}, setOverlays: () => undefined, saveContent };
  function Harness() {
    const [overlays, setOverlays] = useState<RichTextOverlayMap>({});
    const [layout, setLayout] = useState(LAYOUT);
    holder.overlays = overlays;
    holder.setOverlays = setOverlays;
    const pipeline: ResumeDocumentPipeline = {
      revision: 1,
      saveLayout: async () => ({ status: "unchanged", revision: 1 }),
      saveContent,
      publishDraft: async () => ({ status: "unchanged", revision: 1 }),
      fetchLatest: async () => ({}) as ResumeDetail,
      adoptLatest: async () => undefined,
      saveAsCopy: async () => ({}) as ResumeDetail,
      overlays,
      onOverlaysChange: setOverlays,
    };
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
          content={CONTENT}
          onApplyLayout={setLayout}
          onSaveContent={vi.fn(async () => undefined)}
          documentPipeline={pipeline}
          richDirty={Object.keys(overlays).length > 0}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
  return holder;
}

function openHistoryTab(): void {
  const params = document.querySelector<HTMLElement>(".resume-wb-col-params");
  if (!params) throw new Error("params column not rendered");
  fireEvent.click(within(params).getByText(t("workbench.history.title")));
}

function paramsColumn(): HTMLElement {
  const params = document.querySelector<HTMLElement>(".resume-wb-col-params");
  if (!params) throw new Error("params column not rendered");
  return params;
}

function undoButton(): HTMLButtonElement {
  return within(paramsColumn()).getByRole("button", {
    name: new RegExp(t("workbench.history.undo").split("").join("\\s*")),
  }) as HTMLButtonElement;
}

function topSaveButton(): HTMLElement {
  const bar = document.querySelector<HTMLElement>(".resume-wb-actionbar");
  if (!bar) throw new Error("action bar not rendered");
  return within(bar).getByRole("button", { name: new RegExp(t("workbench.action.save-changes")) });
}

async function settleHistory(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 330));
  });
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 纸面加粗进入统一历史（真实外壳）", () => {
  it("宿主加粗 → 历史出现「加粗」→ 撤销把粗体退回", async () => {
    const holder = renderWorkbench();
    await waitFor(() => expect(document.querySelector(".resume-wb-col-params")).not.toBeNull());

    act(() => holder.setOverlays({ name: { raw: "**Alex**", base: "Alex" } }));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 330));
    });
    openHistoryTab();

    const params = document.querySelector<HTMLElement>(".resume-wb-col-params") as HTMLElement;
    expect(within(params).getByText(t("workbench.history.label.bold"))).toBeInTheDocument();

    const undo = within(params).getByRole("button", {
      name: new RegExp(t("workbench.history.undo").split("").join("\\s*")),
    });
    act(() => {
      fireEvent.click(undo);
    });
    expect(holder.overlays).toEqual({});
  });

  it("保存失败：历史不清栈，加粗仍在且仍可撤销", async () => {
    const holder = renderWorkbench();
    await waitFor(() => expect(document.querySelector(".resume-wb-col-params")).not.toBeNull());

    act(() => holder.setOverlays({ name: { raw: "**Alex**", base: "Alex" } }));
    await settleHistory();

    fireEvent.click(topSaveButton());
    await waitFor(() => expect(holder.saveContent).toHaveBeenCalledTimes(1));
    // 失败后宿主原样：粗体还在，历史里"加粗"这一步也还在。
    expect(holder.overlays).toEqual({ name: { raw: "**Alex**", base: "Alex" } });
    openHistoryTab();
    expect(within(paramsColumn()).getByText(t("workbench.history.label.bold"))).toBeInTheDocument();

    fireEvent.click(undoButton());
    expect(holder.overlays).toEqual({});
  });
});
