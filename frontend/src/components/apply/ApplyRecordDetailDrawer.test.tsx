// SPDX-License-Identifier: Apache-2.0
/**
 * 投递记录详情抽屉 ·「我已提交」（T07）：
 * - 只有投递**成功**的记录出现记录动作；
 * - 点一次即显示后端返回的提醒日期（不自己算 7 天）；
 * - 一次性引导只在 show_followup_hint=true 时渲染（开关由后端 gate）；
 * - 失败给出可重试的提示，按钮恢复可点；按钮是 antd Button（键盘可达）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyRecord } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import ApplyRecordDetailDrawer from "./ApplyRecordDetailDrawer";

const apiMocks = vi.hoisted(() => ({ markRecordSubmitted: vi.fn() }));
vi.mock("../../api/apply", () => ({ markRecordSubmitted: apiMocks.markRecordSubmitted }));

const receiptMocks = vi.hoisted(() => ({
  getDeliveryReceipt: vi.fn(),
  ackDeliveryReceipt: vi.fn(),
}));
vi.mock("../../api/deliveryReceipt", () => ({
  getDeliveryReceipt: receiptMocks.getDeliveryReceipt,
  ackDeliveryReceipt: receiptMocks.ackDeliveryReceipt,
}));

const REMINDER_DUE_AT = "2026-11-16T09:00:00";

function makeRecord(overrides: Partial<ApplyRecord> = {}): ApplyRecord {
  return {
    id: 7,
    task_id: 3,
    job_id: 11,
    job_title: "Backend Engineer",
    company: "Example Corp",
    resume_title: "Backend resume",
    greeting: "Hello",
    status: "success",
    failure_category: "",
    failure_label: "",
    failure_detail: "",
    attempt: 1,
    created_at: "2026-11-09T08:00:00",
    finished_at: "2026-11-09T08:05:00",
    ...overrides,
  };
}

function submittedResponse(showFollowupHint: boolean) {
  return {
    record_id: 7,
    track_id: 12,
    reminder_id: 34,
    reminder_due_at: REMINDER_DUE_AT,
    created_track: true,
    created_reminder: true,
    show_followup_hint: showFollowupHint,
  };
}

function renderDrawer(record: ApplyRecord) {
  render(
    <AntdApp>
      <ApplyRecordDetailDrawer record={record} onClose={() => undefined} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  apiMocks.markRecordSubmitted.mockReset();
  receiptMocks.getDeliveryReceipt.mockReset();
  receiptMocks.ackDeliveryReceipt.mockReset();
});

describe("ApplyRecordDetailDrawer「我已提交」", () => {
  it("成功记录提供记录动作；失败记录不出现这一段", () => {
    renderDrawer(makeRecord());
    expect(screen.getByTestId("apply-record-mark-submitted")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: t("applyUi.recordDetail.submitted.action") }),
    ).toBeTruthy();
    cleanup();

    renderDrawer(
      makeRecord({ status: "failed", failure_category: "selector_invalid", failure_label: "" }),
    );
    expect(screen.queryByTestId("apply-record-mark-submitted")).toBeNull();
  });

  it("点击后显示后端返回的提醒日期，并给成功提示", async () => {
    apiMocks.markRecordSubmitted.mockResolvedValue(submittedResponse(false));
    renderDrawer(makeRecord());
    fireEvent.click(screen.getByTestId("apply-record-mark-submitted"));

    const reminder = t("applyUi.recordDetail.submitted.reminder", {
      date: formatDateTime(REMINDER_DUE_AT),
    });
    await screen.findByText(reminder);
    expect(screen.getByText(t("applyUi.recordDetail.submitted.done"))).toBeTruthy();
    expect(screen.queryByTestId("apply-record-mark-submitted")).toBeNull();
    await screen.findByText(t("applyUi.recordDetail.submitted.toast"));
    expect(apiMocks.markRecordSubmitted).toHaveBeenCalledWith(7);
  });

  it("一次性引导只在 show_followup_hint=true 时出现（开关由后端 gate）", async () => {
    apiMocks.markRecordSubmitted.mockResolvedValueOnce(submittedResponse(true));
    renderDrawer(makeRecord());
    fireEvent.click(screen.getByTestId("apply-record-mark-submitted"));
    await screen.findByTestId("apply-record-followup-hint");
    expect(screen.getByText(t("applyUi.recordDetail.submitted.hintTitle"))).toBeTruthy();
    cleanup();

    apiMocks.markRecordSubmitted.mockResolvedValueOnce(submittedResponse(false));
    renderDrawer(makeRecord());
    fireEvent.click(screen.getByTestId("apply-record-mark-submitted"));
    await screen.findByText(t("applyUi.recordDetail.submitted.done"));
    expect(screen.queryByTestId("apply-record-followup-hint")).toBeNull();
  });

  it("交付单收起时不请求接口，展开后才读取（T09 接线）", async () => {
    receiptMocks.getDeliveryReceipt.mockResolvedValue({
      record_id: 7,
      state: "ready",
      state_reasons: [],
      delivery: null,
      fill: null,
      doubts: { count: 0 },
      human_steps: [],
      followup: null,
      receipt_acked_at: null,
    });
    renderDrawer(makeRecord());
    expect(receiptMocks.getDeliveryReceipt).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(t("deliveryReceipt.title")));
    await waitFor(() => expect(receiptMocks.getDeliveryReceipt).toHaveBeenCalledWith(7));
    await screen.findByTestId("delivery-receipt-7");
  });

  it("接口失败时显示原因，按钮恢复可点可重试", async () => {
    apiMocks.markRecordSubmitted.mockRejectedValueOnce(new Error("only success records allowed"));
    renderDrawer(makeRecord());
    const button = screen.getByTestId("apply-record-mark-submitted") as HTMLButtonElement;
    fireEvent.click(button);
    await screen.findByText("only success records allowed");
    await waitFor(() => expect(button.disabled).toBe(false));
    expect(screen.getByTestId("apply-record-mark-submitted")).toBeTruthy();
  });
});
