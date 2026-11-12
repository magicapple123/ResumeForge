// SPDX-License-Identifier: Apache-2.0
/**
 * #15D 优化指派抽屉：只推荐有提升的那些，换用走现有改简历接口。
 *
 * 三条关键判据（都不是"元素存在"级别的）：
 * - `gain <= 0` 的行推荐列写「覆盖已经最高」且「换用」不可点——不给一个点了只会变差的按钮；
 * - 「换用」提交的是 `PATCH /apply/queue/{id}`（`updateQueueItem`），参数只有 `resume_id`；
 * - 「全部换用」只处理 `gain > 0` 且未换过的行，避免重复提交。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyQueueItem, ApplyResumeFitList } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  getResumeFit: vi.fn(),
  updateQueueItem: vi.fn(),
  listResumes: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getResumeFit: apiMocks.getResumeFit,
}));

vi.mock("../../../api/apply", () => ({
  updateQueueItem: apiMocks.updateQueueItem,
}));

vi.mock("../../../api/resumes", () => ({
  listResumes: apiMocks.listResumes,
}));

import ApplyResumeFitDrawer from "./ApplyResumeFitDrawer";

const ITEMS: ApplyQueueItem[] = [
  {
    id: 1,
    job_id: 11,
    job_title: "Backend Engineer",
    company: "A",
    resume_id: 3,
    resume_title: "General",
    greeting: "",
    sort_order: 0,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  },
  {
    id: 2,
    job_id: 12,
    job_title: "Frontend Engineer",
    company: "B",
    resume_id: 4,
    resume_title: "Frontend general",
    greeting: "",
    sort_order: 1,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  },
];

const FIT: ApplyResumeFitList = {
  items: [
    {
      queue_id: 1,
      job_id: 11,
      current_resume_id: 3,
      current_coverage: 40,
      recommended_resume_id: 5,
      recommended_coverage: 75,
      gain: 35,
      reason: "more keyword hits",
    },
    {
      queue_id: 2,
      job_id: 12,
      current_resume_id: 4,
      current_coverage: 80,
      recommended_resume_id: 6,
      recommended_coverage: 80,
      gain: 0,
      reason: "",
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getResumeFit.mockResolvedValue(FIT);
  apiMocks.updateQueueItem.mockResolvedValue(ITEMS[0]);
  apiMocks.listResumes.mockResolvedValue({
    items: [
      { id: 5, title: "Backend edition" },
      { id: 6, title: "Frontend edition" },
    ],
    total: 2,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderDrawer() {
  return render(
    <AntdApp>
      <ApplyResumeFitDrawer open items={ITEMS} onClose={vi.fn()} onApplied={vi.fn()} />
    </AntdApp>,
  );
}

function rowOf(jobTitle: string): HTMLElement {
  const cell = screen.getByText(jobTitle);
  const row = cell.closest("tr");
  if (!row) throw new Error("row not found");
  return row as HTMLElement;
}

describe("ApplyResumeFitDrawer", () => {
  it("only asks for the selected queue items and shows coverage 40% -> 75%", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    expect(apiMocks.getResumeFit).toHaveBeenCalledWith([1, 2]);
    expect(within(rowOf("Backend Engineer")).getByText("40%")).toBeInTheDocument();
    expect(within(rowOf("Backend Engineer")).getByText("75%")).toBeInTheDocument();
    expect(within(rowOf("Backend Engineer")).getByText("+35")).toBeInTheDocument();
  });

  it("does not offer a swap when the gain is zero", async () => {
    renderDrawer();

    await screen.findByText(t("applyQueue.insights.fit.noGain"));
    const row = rowOf("Frontend Engineer");
    expect(within(row).getByText(t("applyQueue.insights.fit.noGain"))).toBeInTheDocument();
    expect(
      within(row).getByRole("button", { name: t("applyQueue.insights.fit.swap") }),
    ).toBeDisabled();
  });

  it("swaps with the existing queue PATCH and only sends resume_id", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    fireEvent.click(
      within(rowOf("Backend Engineer")).getByRole("button", {
        name: t("applyQueue.insights.fit.swap"),
      }),
    );

    await waitFor(() => expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, { resume_id: 5 }));
    // 只换有提升的那条：0 收益的行不该被顺手改掉。
    expect(apiMocks.updateQueueItem).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t("applyQueue.insights.fit.swapped"))).toBeInTheDocument();
  });

  it("swap-all touches only rows with a positive gain", async () => {
    renderDrawer();

    await screen.findByText("Backend edition");
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.insights.fit.swapAll") }));

    await waitFor(() => expect(apiMocks.updateQueueItem).toHaveBeenCalledTimes(1));
    expect(apiMocks.updateQueueItem).toHaveBeenCalledWith(1, { resume_id: 5 });
    expect(apiMocks.updateQueueItem).not.toHaveBeenCalledWith(2, expect.anything());
  });

  it("keeps the drawer usable when coverage cannot be computed", async () => {
    apiMocks.getResumeFit.mockRejectedValue(new Error("boom"));

    renderDrawer();

    expect(await screen.findByText(t("applyQueue.insights.fit.error"))).toBeInTheDocument();
  });
});
