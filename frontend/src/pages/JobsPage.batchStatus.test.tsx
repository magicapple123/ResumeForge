// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场：勾选 → 批量设置状态 → `useJobBatchActions` → `batchUpdateJobStatus` 的整条接线。
 *
 * 拆成独立文件而不是塞进 `JobsPage.test.tsx`：后者已贴 500 行预算。断言只看"用户动作真的
 * 落到 API 且参数正确"，不重复测 hook 之外的删除/入队分支。
 *
 * 列表数据用 `useApi` 替身直接喂（与 `JobsPage.test.tsx` 同一套脚手架）：这条用例守的是
 * 批量动作的接线，不是列表请求；真 hook 仍在执行，所以 UI → useJobBatchActions → API 一路都是真的。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { JOB_STATUS_LABEL_KEYS } from "../i18n/enum/jobs";
import { t } from "../i18n";
import type { JobList } from "../types";
import JobsPage from "./JobsPage";

const mocks = vi.hoisted(() => ({
  jobs: [] as JobList[],
  reload: vi.fn(),
  getJob: vi.fn(),
  batchUpdateJobStatus: vi.fn(),
}));

// 列表数据走替身（真 useApi 在这里没有额外价值，还会让"进入选择模式"的时机变得不确定）。
vi.mock("../hooks/useApi", () => ({
  useApi: () => ({
    data: { items: mocks.jobs, total: mocks.jobs.length },
    loading: false,
    reload: mocks.reload,
    error: null,
  }),
}));
// 只覆盖批量状态与详情，其余 jobs API 保持真实导出（JobsPage 会 import 多个）。
vi.mock("../api/jobs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/jobs")>()),
  batchUpdateJobStatus: mocks.batchUpdateJobStatus,
  getJob: mocks.getJob,
}));
// startBackfill 在点「补齐详情」时才用：保证 import 时存在即可。
vi.mock("../api/apply", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/apply")>()),
  startBackfill: vi.fn(),
}));

/** 落库的岗位状态协议值：与后端同值，永远不翻（展示名在渲染期由语言包给）。 */
const APPLIED_STATUS = "已投递";

const JOB: JobList = {
  id: 1,
  title: "示例岗位甲",
  company: "示例公司",
  location: "杭州市",
  salary: "",
  job_type: "社招",
  requirements: "",
  additional_info: "",
  keywords: [],
  source: "手动添加",
  source_url: "",
  posted_at: "",
  status: "开放中",
  note: "",
  note_images: [],
  recognition_source: "手动填写",
  origin_source: "",
  favorite: false,
  apply_supported: true,
  created_at: "2026-11-01T08:00:00",
  updated_at: "2026-11-01T08:00:00",
  has_description: true,
};

function renderPage() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <JobsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

/** 列表行标题按钮 → 右键菜单「批量选择」进入多选（R8 之后入口只在右键菜单里）。 */
async function enterSelectionMode(): Promise<void> {
  const rowTitle = (await screen.findAllByRole("button", { name: JOB.title }))[0]!;
  fireEvent.contextMenu(rowTitle.closest("tr") as HTMLElement);
  // 菜单项前面有图标（aria-label=check-square），可访问名是 "check-square 批量选择"，
  // 所以按子串匹配而不是全等。
  fireEvent.click(
    await screen.findByRole("menuitem", {
      name: new RegExp(t("common.action.batchSelect")),
    }),
  );
  expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
}

/** 批量操作条里的「批量设置状态」下拉（placeholder 定位，避免和筛选条的下拉混淆）。 */
function batchStatusCombobox(): HTMLElement {
  const placeholder = screen.getByText(t("jobsPage.toolbar.statusPlaceholder"));
  const selectRoot = placeholder.closest(".ant-select");
  if (!selectRoot) throw new Error("批量设置状态下拉不存在");
  const combobox = selectRoot.querySelector<HTMLElement>('[role="combobox"]');
  if (!combobox) throw new Error("批量设置状态下拉没有 combobox");
  return combobox;
}

beforeEach(() => {
  mocks.jobs = [JOB];
  mocks.reload.mockReset();
  mocks.getJob.mockReset();
  mocks.batchUpdateJobStatus.mockReset().mockResolvedValue({ updated: 1 });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JobsPage 批量设置状态接线", () => {
  it("勾选 → 选状态 → 应用，把 job_ids 与协议状态原样交给 batchUpdateJobStatus", async () => {
    renderPage();
    await enterSelectionMode();

    // 第 0 个复选框是表头全选，第 1 个才是第一行数据。
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);
    expect(
      await screen.findByText(t("jobsPage.toolbar.selectedCount", { count: 1 })),
    ).toBeInTheDocument();

    // 选状态只是本地选择，此刻还不该发请求。
    fireEvent.mouseDown(batchStatusCombobox());
    const option = await screen.findByText(
      (content, element) =>
        content === t(JOB_STATUS_LABEL_KEYS[APPLIED_STATUS]) &&
        !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(option);
    expect(mocks.batchUpdateJobStatus).not.toHaveBeenCalled();

    // 按钮带勾选图标（aria-label=check），可访问名是 "check 应用状态"，按子串匹配。
    const applyButton = screen.getByRole("button", {
      name: new RegExp(t("jobsPage.toolbar.applyStatus")),
    });
    expect(applyButton).toBeEnabled();
    fireEvent.click(applyButton);

    await waitFor(() => expect(mocks.batchUpdateJobStatus).toHaveBeenCalledTimes(1));
    expect(mocks.batchUpdateJobStatus).toHaveBeenCalledWith({
      job_ids: [1],
      status: APPLIED_STATUS,
    });
    // 成功提示带结果数；批量完成后重拉列表（页面状态由 hook 统一收拾）。
    expect(
      await screen.findByText(t("jobsPage.batch.statusUpdated", { count: 1 })),
    ).toBeInTheDocument();
    await waitFor(() => expect(mocks.reload).toHaveBeenCalled());
  });

  it("只勾选、不选状态时「应用状态」禁用，不会发请求", async () => {
    renderPage();
    await enterSelectionMode();
    fireEvent.click(screen.getAllByRole("checkbox")[1]!);

    expect(
      screen.getByRole("button", { name: new RegExp(t("jobsPage.toolbar.applyStatus")) }),
    ).toBeDisabled();
    expect(mocks.batchUpdateJobStatus).not.toHaveBeenCalled();
  });
});
