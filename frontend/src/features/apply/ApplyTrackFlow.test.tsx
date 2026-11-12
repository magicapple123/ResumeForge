// SPDX-License-Identifier: Apache-2.0
/**
 * #14C 跟进闭环的两个前端接线点：记录页顶部的「7 天无回音」提醒，和记录行的「更新进度」。
 *
 * 钉住三件事：
 * 1. 提醒只在**真的有 stale 记录**时出现（数量 0 / 接口失败都整条不渲染）；
 * 2. 「批量标为跟进中」逐条 POST，一条失败不拖垮整批（allSettled）；
 * 3. 「更新进度」按后端回包的 `created` 分两种成功文案——连点不会多出漏斗记录，
 *    所以"新建"和"复用已有"必须说得不一样，否则用户会以为自己点了两次建了两条。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApplyRecord } from "../../types";

const apiMocks = vi.hoisted(() => ({
  listStaleRecords: vi.fn(),
  trackApplyRecord: vi.fn(),
}));

vi.mock("../../api/applyExtras", () => ({
  listStaleRecords: apiMocks.listStaleRecords,
  trackApplyRecord: apiMocks.trackApplyRecord,
}));

import { t } from "../../i18n";
import ApplyStaleBanner from "./ApplyStaleBanner";
import ApplyRecordTrackButton from "./ApplyRecordTrackButton";

const STALE = {
  items: [
    {
      record_id: 1,
      job_id: 11,
      job_title: "后端开发",
      company: "A公司",
      applied_at: "2026-09-01T08:00:00",
      days: 9,
    },
    {
      record_id: 2,
      job_id: 12,
      job_title: "前端开发",
      company: "B公司",
      applied_at: "2026-09-02T08:00:00",
      days: 8,
    },
  ],
  count: 2,
};

/** 提醒第二行的锚点文案：交给 t() 渲染，避免在断言里写死中文。 */
const staleLine = (index: number): string =>
  t("applyRecords.stale.line", {
    title: STALE.items[index].job_title,
    company: STALE.items[index].company,
    days: STALE.items[index].days,
  });

const RECORD: ApplyRecord = {
  id: 7,
  task_id: 1,
  job_id: 11,
  job_title: "后端开发",
  company: "A公司",
  resume_title: "通用版",
  greeting: "您好，我想应聘这个岗位。",
  status: "success",
  failure_category: "",
  failure_label: "",
  failure_detail: "",
  attempt: 1,
  created_at: "2026-09-01T08:00:00",
  finished_at: "2026-09-01T08:05:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.listStaleRecords.mockResolvedValue(STALE);
  apiMocks.trackApplyRecord.mockResolvedValue({ track_id: 3, created: true, stage: "applied" });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderBanner() {
  return render(
    <AntdApp>
      <ApplyStaleBanner />
    </AntdApp>,
  );
}

function renderTrackButton(record: ApplyRecord = RECORD) {
  return render(
    <AntdApp>
      <ApplyRecordTrackButton record={record} />
    </AntdApp>,
  );
}

describe("ApplyStaleBanner（7 天无回音）", () => {
  it("有 stale 记录时在记录页顶部给出数量、可展开清单", async () => {
    renderBanner();

    expect(
      await screen.findByText(t("applyRecords.stale.title", { count: 2 })),
    ).toBeInTheDocument();
    // 默认收起：提醒本身要短，清单按需展开。
    expect(screen.queryByText(staleLine(0))).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "查看这 2 条" }));
    expect(await screen.findByText(staleLine(0))).toBeInTheDocument();
    expect(screen.getByText(staleLine(1))).toBeInTheDocument();
    expect(apiMocks.listStaleRecords).toHaveBeenCalledWith(7);
  });

  it("数量为 0 时整条不渲染（提醒不该常驻）", async () => {
    apiMocks.listStaleRecords.mockResolvedValue({ items: [], count: 0 });

    const { container } = renderBanner();

    await Promise.resolve();
    expect(container.querySelector(".apply-stale-banner")).toBeNull();
  });

  it("接口失败时整条不渲染（不在记录页挂一行错误）", async () => {
    apiMocks.listStaleRecords.mockRejectedValue(new Error("stale 挂了"));

    const { container } = renderBanner();

    await Promise.resolve();
    expect(container.querySelector(".apply-stale-banner")).toBeNull();
  });

  it("「批量标为跟进中」逐条写进度，一条失败不拖垮整批", async () => {
    apiMocks.trackApplyRecord
      .mockResolvedValueOnce({ track_id: 3, created: true, stage: "applied" })
      .mockRejectedValueOnce(new Error("这条没写进去"));

    renderBanner();

    fireEvent.click(await screen.findByRole("button", { name: "批量标为跟进中" }));

    await waitFor(() => expect(apiMocks.trackApplyRecord).toHaveBeenCalledTimes(2));
    expect(apiMocks.trackApplyRecord).toHaveBeenCalledWith(1);
    expect(apiMocks.trackApplyRecord).toHaveBeenCalledWith(2);
    // 成功的说成功、失败的说失败——不能既报成功又静默丢一条。
    expect(
      await screen.findByText(t("applyRecords.stale.partial", { ok: 1, failed: 1 })),
    ).toBeInTheDocument();
  });
});

describe("ApplyRecordTrackButton（更新进度）", () => {
  it("新建了进度时提示「已记录」，复用时提示「已更新」（连点不会多建一条）", async () => {
    renderTrackButton();

    fireEvent.click(await screen.findByRole("button", { name: /更新进度/ }));

    await waitFor(() => expect(apiMocks.trackApplyRecord).toHaveBeenCalledWith(7));
    expect(await screen.findByText(t("applyRecords.toast.tracked"))).toBeInTheDocument();
  });

  it("复用已有进度时提示「已更新」，与新建区分开", async () => {
    apiMocks.trackApplyRecord.mockResolvedValue({ track_id: 3, created: false, stage: "applying" });

    renderTrackButton();

    fireEvent.click(await screen.findByRole("button", { name: /更新进度/ }));

    expect(await screen.findByText(t("applyRecords.toast.trackUpdated"))).toBeInTheDocument();
  });

  it("岗位已删除（job_id 为空）时按钮禁用：后端也建不出关联", async () => {
    renderTrackButton({ ...RECORD, job_id: null });

    expect(await screen.findByRole("button", { name: /更新进度/ })).toBeDisabled();
  });
});
