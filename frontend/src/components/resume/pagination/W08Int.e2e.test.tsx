// SPDX-License-Identifier: Apache-2.0
/**
 * W08-INT 真实壳 e2e（task-39 收尾）：大纲选中 → 条目级分页意图 → 保存通道；
 * 溢出报告**手动触发** → 页标记写入画布 store → 定位走 pickTarget 反选大纲。
 *
 * 只 mock 网络（报告端点）与画布 iframe；其余都是 wb-core 落地的真实 shell：
 * selection 上提、PaginationControls.entry、OverflowLocator banner、usePaginationReport*。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeContent, ResumeLayout } from "../../../types";
import type { ResumeDocumentPipeline } from "../../../features/resume-document/types";
import { parsePaginationReport } from "../../../features/resume-pagination/paginationReport";
import { resetPageMarkers, pageMarkersStore } from "../../../features/resume-proview/pageMarkers";
import { DEFAULT_LAYOUT } from "../../ResumeLayoutControls.testkit";
import ResumeZoomModal from "../ResumeZoomModal";

const REPORT = parsePaginationReport({
  pages: 1,
  pages_needed: 2,
  overflow: true,
  page_limit: 1,
  truncated_at: {
    kind: "entry",
    section: "experience",
    object_id: "e2e_entry001",
    point_index: null,
    text_preview: "Core pipeline",
  },
  manual_breaks: [],
  warnings: [],
  snapshot: { content_sha256: "a".repeat(64), render_config_sha256: "b".repeat(64) },
})!;

const reportMocks = vi.hoisted(() => ({ fetchPaginationReport: vi.fn() }));
vi.mock("../../../features/resume-pagination/paginationReport", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../features/resume-pagination/paginationReport")
  >()),
  fetchPaginationReport: reportMocks.fetchPaginationReport,
}));
vi.mock("../../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../../ResumePreview", () => ({
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
  summary: "",
  education: [],
  experience: [
    {
      id: "e2e_entry001",
      company: "Acme",
      role: "Backend",
      start_date: "",
      end_date: "",
      description: ["Core pipeline"],
      point_ids: { description: ["e2e_point001"] },
    },
  ],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

function makePipeline() {
  const saveLayout = vi.fn(async () => ({ status: "saved" as const, revision: 4 }));
  const pipeline: ResumeDocumentPipeline = {
    revision: 3,
    saveLayout,
    saveContent: vi.fn(async () => 4),
    publishDraft: vi.fn(async () => ({ status: "saved" as const, revision: 4 })),
    fetchLatest: vi.fn(async () => {
      throw new Error("not used");
    }),
    adoptLatest: vi.fn(),
    saveAsCopy: vi.fn(async () => {
      throw new Error("not used");
    }),
  };
  return { pipeline, saveLayout };
}

function Harness({
  pipeline,
  onApplyLayout,
}: {
  pipeline?: ResumeDocumentPipeline;
  onApplyLayout?: (next: ResumeLayout) => void;
}) {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const apply = (next: ResumeLayout) => {
    onApplyLayout?.(next);
    setLayout(next);
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
        onApplyLayout={apply}
        onSaveContent={vi.fn(async () => undefined)}
        documentPipeline={pipeline}
      />
    </AntdApp>
  );
}

function paramsColumn(): HTMLElement {
  return document.querySelector<HTMLElement>(".resume-wb-col-params") as HTMLElement;
}

function switchTab(label: string): void {
  fireEvent.click(within(paramsColumn()).getByText(label));
}

async function selectEntry(): Promise<void> {
  switchTab(t("outline.panel.title"));
  fireEvent.click(await screen.findByText("Acme"));
  await waitFor(() => {
    expect(document.querySelector('[role="treeitem"][aria-selected="true"]')).not.toBeNull();
  });
  switchTab(t("responsive.action.params"));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  resetPageMarkers();
  vi.restoreAllMocks();
  reportMocks.fetchPaginationReport.mockReset();
});

describe("W08-INT · 真实壳 e2e", () => {
  it("选中条目 → 条目级分页意图 → onApplyLayout payload → 保存通道", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    await selectEntry();
    const entryPanel = await screen.findByTestId("pagination-entry");
    fireEvent.click(within(entryPanel).getByRole("switch", { name: t("pagination.breakBefore") }));
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
      format_config: { pagination?: unknown };
    };
    expect(layout.format_config.pagination).toEqual({
      version: 1,
      entries: { e2e_entry001: { break_before: "page" } },
    });

    // 脏态 → 保存修改 → W02 统一保存通道（payload 里的 layout 已含条目级意图）。
    const { pipeline, saveLayout } = makePipeline();
    cleanup();
    render(<Harness pipeline={pipeline} onApplyLayout={onApplyLayout} />);
    await selectEntry();
    fireEvent.click(
      within(await screen.findByTestId("pagination-entry")).getByRole("switch", {
        name: t("pagination.breakBefore"),
      }),
    );
    fireEvent.click(
      await screen.findByRole("button", {
        name: new RegExp(t("workbench.action.save-changes")),
      }),
    );
    await waitFor(() => expect(saveLayout).toHaveBeenCalledWith(3));
  });

  it("报告不自动请求；点「获取分页报告」→ 页标记 + 定位反选大纲", async () => {
    reportMocks.fetchPaginationReport.mockResolvedValue(REPORT);
    render(<Harness />);
    expect(reportMocks.fetchPaginationReport).not.toHaveBeenCalled();
    expect(screen.getByText(t("pagination.report.empty"))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("pagination.report.refresh") }));
    await waitFor(() => expect(reportMocks.fetchPaginationReport).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText(t("pagination.report.pages", { pages: 2, limit: 1 })),
    ).toBeInTheDocument();
    // 页标记写入画布 store（PageNavigator 订阅）：blocker 落在上限页。
    expect(pageMarkersStore.getSnapshot()).toEqual([{ page: 1, severity: "blocker", count: 1 }]);

    // 定位：objectId → resolvePathAt → pickTarget；大纲被反选到该条目。
    fireEvent.click(screen.getAllByRole("button", { name: t("pagination.report.locate") })[0]);
    switchTab(t("outline.panel.title"));
    await waitFor(() => {
      const selected = document.querySelector('[role="treeitem"][aria-selected="true"]');
      expect(selected?.textContent ?? "").toContain("Acme");
    });
  });
});
