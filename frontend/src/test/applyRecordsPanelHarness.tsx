// SPDX-License-Identifier: Apache-2.0
/**
 * ApplyRecordsPanel 测试的非 mock 测试基建（先例：src/test/assistantPageHarness.tsx）。
 *
 * 从 ApplyRecordsPanel.test.tsx 拆分时提取：记录/批次夹具、render 工具、组头定位与
 * beforeEach 的默认桩。vi.mock 声明与 apiMocks **不**在这里——mock 必须留在每个测试
 * 文件内逐字声明（vitest 按测试文件装配 mock 注册表），这里只放与 mock 无关的 harness。
 *
 * 本文件不是 `.test.` 文件：vitest 不收集、行数预算扫描不涉及。
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { type Mock, vi } from "vitest";
import type { ApplyRecord, ApplyRecordBatch, Page } from "../types";
import ApplyRecordsPanel from "../features/apply/ApplyRecordsPanel";

export const RECORD: ApplyRecord = {
  id: 1,
  task_id: 7,
  job_id: 11,
  job_title: "高级后端工程师（高并发方向）",
  company: "某知名互联网科技有限公司",
  resume_title: "后端开发岗位版简历",
  greeting: "您好，我看到贵司的岗位非常契合我的经验，希望能进一步沟通。",
  status: "failed",
  failure_category: "selector_invalid",
  failure_label: "",
  failure_detail:
    "页面结构变化：投递表单的选择器已失效。失败页面 URL：https://example.com/job/12345 ，页面标题：「职位申请 - 某某招聘」",
  attempt: 2,
  created_at: "2026-09-17T08:00:00",
  finished_at: "2026-09-17T08:05:00",
};

export const RECORD_SUCCESS: ApplyRecord = {
  ...RECORD,
  id: 2,
  job_title: "全栈工程师",
  company: "另一家公司",
  status: "success",
  failure_category: "",
  failure_label: "",
  failure_detail: "",
};

export const BATCHES: Page<ApplyRecordBatch> = {
  items: [
    {
      id: 7,
      status: "completed",
      total: 3,
      processed: 3,
      succeeded: 1,
      failed: 1,
      skipped: 1,
      message: "投递任务已完成",
      created_at: "2026-09-17T08:00:00",
      finished_at: "2026-09-17T08:05:00",
      matched_count: 2,
      failure_summary: [],
      items: [],
    },
    {
      id: 6,
      status: "failed",
      total: 1,
      processed: 1,
      succeeded: 0,
      failed: 1,
      skipped: 0,
      message: "",
      created_at: "2026-09-16T08:00:00",
      finished_at: "2026-09-16T08:01:00",
      matched_count: 0,
      failure_summary: [],
      items: [],
    },
  ],
  total: 2,
};

export const BATCH_ITEMS: Page<ApplyRecord> = {
  items: [RECORD, RECORD_SUCCESS],
  total: 2,
};

/** beforeEach 的默认桩：与拆分前 ApplyRecordsPanel.test.tsx 的 beforeEach 逐字一致。 */
export function resetApplyRecordsPanelApiMocks(apiMocks: {
  listRecordBatches: Mock;
  listRecordBatchItems: Mock;
  retryRecord: Mock;
}): void {
  apiMocks.listRecordBatches.mockResolvedValue(BATCHES);
  apiMocks.listRecordBatchItems.mockResolvedValue(BATCH_ITEMS);
  apiMocks.retryRecord.mockResolvedValue({ id: 99 } as never);
}

export async function renderPanel() {
  render(
    <AntdApp>
      <MemoryRouter>
        <ApplyRecordsPanel disabled={false} onRetried={vi.fn()} />
      </MemoryRouter>
    </AntdApp>,
  );
  // 等组头渲染完成。
  await screen.findByTestId("record-batch-7");
}

/** 取某个批次的组头按钮（批次卡片里可能有多个 button，组头有专属 class）。 */
export function batchHead(batchId: number): HTMLElement {
  const card = screen.getByTestId(`record-batch-${batchId}`);
  const head = card.querySelector<HTMLElement>("button.apply-records-batch-head");
  if (!head) throw new Error(`batch #${batchId} head not found`);
  return head;
}
