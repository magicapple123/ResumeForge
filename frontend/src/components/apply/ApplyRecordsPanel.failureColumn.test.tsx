// SPDX-License-Identifier: Apache-2.0
/**
 * #39 返工：失败列**不再把大类名说两遍**。
 *
 * 判据（列首 Tag 一行）：
 * - 子码（`failure_reason`）命中语言包时，Tag 直接显示子码中文；
 * - 子码原码以 `code` 小字保留在旁边（可筛选、可给建议）；
 * - 大类名不再作为首 Tag 重复出现一次；
 * - 子码为空（旧数据 / 后端没下发）时整体退回大类，不显示空 Tag。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ApplyRecord, ApplyRecordBatch, Page } from "../../types";
import ApplyRecordsPanel from "./ApplyRecordsPanel";

const apiMocks = vi.hoisted(() => ({
  listRecordBatches: vi.fn(),
  listRecordBatchItems: vi.fn(),
  retryRecord: vi.fn(),
  deleteRecord: vi.fn(),
  deleteRecordBatch: vi.fn(),
  batchDeleteRecords: vi.fn(),
}));

vi.mock("../../api/apply", () => ({
  listRecordBatches: apiMocks.listRecordBatches,
  listRecordBatchItems: apiMocks.listRecordBatchItems,
  retryRecord: apiMocks.retryRecord,
  deleteRecord: apiMocks.deleteRecord,
  deleteRecordBatch: apiMocks.deleteRecordBatch,
  batchDeleteRecords: apiMocks.batchDeleteRecords,
}));

/** 带子码的失败记录：selector_invalid + selector_missing。 */
const WITH_REASON: ApplyRecord = {
  id: 1,
  task_id: 7,
  job_id: 11,
  job_title: "带子码的岗位",
  company: "某公司",
  resume_title: "简历",
  greeting: "",
  status: "failed",
  failure_category: "selector_invalid",
  failure_reason: "selector_missing",
  failure_label: "",
  failure_step: "filling",
  failure_detail: "页面结构变化：投递表单的选择器已失效。",
  attempt: 1,
  created_at: "2026-09-17T08:00:00",
  finished_at: "2026-09-17T08:05:00",
};

/** 只有大类、没有子码的失败记录（旧数据）。 */
const WITHOUT_REASON: ApplyRecord = {
  ...WITH_REASON,
  id: 2,
  job_title: "只有大类的岗位",
  failure_category: "login_required",
  failure_reason: "",
  failure_detail: "",
};

const BATCHES: Page<ApplyRecordBatch> = {
  items: [
    {
      id: 7,
      status: "completed",
      total: 2,
      processed: 2,
      succeeded: 0,
      failed: 2,
      skipped: 0,
      message: "",
      created_at: "2026-09-17T08:00:00",
      finished_at: "2026-09-17T08:05:00",
      matched_count: 2,
      failure_summary: [],
      items: [],
    },
  ],
  total: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listRecordBatches.mockResolvedValue(BATCHES);
  apiMocks.listRecordBatchItems.mockResolvedValue({
    items: [WITH_REASON, WITHOUT_REASON],
    total: 2,
  } satisfies Page<ApplyRecord>);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

async function renderExpanded() {
  const { container } = render(
    <AntdApp>
      <MemoryRouter>
        <ApplyRecordsPanel disabled={false} onRetried={vi.fn()} />
      </MemoryRouter>
    </AntdApp>,
  );
  const card = await screen.findByTestId("record-batch-7");
  const head = card.querySelector<HTMLElement>("button.apply-records-batch-head");
  if (!head) throw new Error("batch head not found");
  fireEvent.click(head);
  await screen.findByText(WITH_REASON.job_title);
  return container;
}

function rowOf(title: string): HTMLElement {
  const row = screen.getByText(title).closest("tr");
  if (!row) throw new Error("row not found: " + title);
  return row as HTMLElement;
}

describe("ApplyRecordsPanel · 失败分类列（#39）", () => {
  it("子码中文进首 Tag，原码小字保留，大类名不再重复", async () => {
    await renderExpanded();
    const row = rowOf(WITH_REASON.job_title);

    const reasonLabel = t("enumsApply.failureReason.selector_missing");
    const tag = within(row).getByText(reasonLabel);
    expect(tag.className).toContain("ant-tag");
    // 原码仍在（小字 code），可筛选可复制。
    expect(within(row).getByText("selector_missing")).toBeInTheDocument();
    // 大类名不再作为首 Tag 出现（否则就是同一条信息说两遍）。
    expect(within(row).queryByText(t("enumsApply.failure.selector_invalid"))).toBeNull();
  });

  it("没有子码时整体退回大类名", async () => {
    await renderExpanded();
    const row = rowOf(WITHOUT_REASON.job_title);
    const tag = within(row).getByText(t("enumsApply.failure.login_required"));
    expect(tag.className).toContain("ant-tag");
    // 没有子码就没有 code 小字（不留空壳）。
    expect(row.querySelector("code")).toBeNull();
  });
});
