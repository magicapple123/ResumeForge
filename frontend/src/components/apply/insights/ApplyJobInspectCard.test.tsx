// SPDX-License-Identifier: Apache-2.0
/**
 * #15C 岗位体检小卡片的三块内容与错误态。
 *
 * 断言的是**结论文字**而不是"有没有标题"：薪资偏离必须能读出"中位多少、本岗多少、高多少"；
 * 样本不足时必须只有「样本不足（N 条）」、**整张卡片不出现任何百分号**——把没样本算成
 * 0% 会被读成"薪资持平"，这是这条验收的核心。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyJobInspect } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  inspectQueueItem: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  inspectQueueItem: apiMocks.inspectQueueItem,
}));

import ApplyJobInspectCard from "./ApplyJobInspectCard";

const OK: ApplyJobInspect = {
  queue_id: 7,
  salary: {
    status: "ok",
    sample: 12,
    median: 25,
    target: 30,
    delta_percent: 20,
    direction: "high",
  },
  same_company: { count: 2, in_queue: 1, applied: 1 },
  history: { applied: 2, succeeded: 1, failed: 0, no_reply: 1 },
};

const INSUFFICIENT: ApplyJobInspect = {
  ...OK,
  salary: {
    status: "insufficient",
    sample: 3,
    median: null,
    target: 30,
    delta_percent: null,
    direction: null,
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.inspectQueueItem.mockResolvedValue(OK);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderCard(queueId: number | null = 7) {
  return render(
    <ApplyJobInspectCard queueId={queueId} jobTitle="Backend Engineer" onClose={vi.fn()} />,
  );
}

/** 卡片正文（抽屉 portal 在 body 下）：用来断言"整块里没有任何百分比"。 */
function cardText(): string {
  return document.querySelector(".ant-drawer-body")?.textContent ?? "";
}

describe("ApplyJobInspectCard", () => {
  it("shows the salary gap as median / this Job / direction and percentage", async () => {
    renderCard();

    const expected = t("applyQueue.insights.inspect.salary.ok", {
      median: 25,
      target: 30,
      delta: t("applyQueue.insights.inspect.salary.high", { percent: 20 }),
    });
    expect(await screen.findByText(expected)).toBeInTheDocument();
    // 方向与幅度都要读得出来（不是只写一句"薪资有偏离"）。
    expect(cardText()).toContain("20%");
    expect(cardText()).not.toContain(
      t("applyQueue.insights.inspect.salary.insufficient", { sample: 3 }),
    );
  });

  it("says only 'not enough samples (3)' when the sample is insufficient", async () => {
    apiMocks.inspectQueueItem.mockResolvedValue(INSUFFICIENT);

    renderCard();

    expect(
      await screen.findByText(t("applyQueue.insights.inspect.salary.insufficient", { sample: 3 })),
    ).toBeInTheDocument();
    // 硬约束：样本不足时不得出现任何百分比。
    expect(cardText()).not.toMatch(/%/);
  });

  it("reports how many of this company were applied to / are still queued", async () => {
    renderCard();

    expect(
      await screen.findByText(
        t("applyQueue.insights.inspect.sameCompany.line", {
          applied: 1,
          in_queue: 1,
          count: 2,
        }),
      ),
    ).toBeInTheDocument();
  });

  it("summarises past results with only the outcomes that actually happened", async () => {
    renderCard();

    const parts = [
      t("applyQueue.insights.inspect.history.succeeded", { count: 1 }),
      t("applyQueue.insights.inspect.history.noReply", { count: 1 }),
    ].join(" / ");
    expect(
      await screen.findByText(
        t("applyQueue.insights.inspect.history.summary", { applied: 2, parts }),
      ),
    ).toBeInTheDocument();
    // failed 为 0 时不该出现（「0 失败」是噪声）。
    expect(cardText()).not.toContain(t("applyQueue.insights.inspect.history.failed", { count: 0 }));
  });

  it("shows an error state inside the card instead of blocking the queue", async () => {
    apiMocks.inspectQueueItem.mockRejectedValue(new Error("boom"));

    renderCard();

    expect(await screen.findByText(t("applyQueue.insights.inspect.error"))).toBeInTheDocument();
    // 错误态下不出结论：宁可什么都不说，也不给一个空白的薪资块。
    expect(
      screen.queryByText(t("applyQueue.insights.inspect.salary.label")),
    ).not.toBeInTheDocument();
  });

  it("does not request anything while the card is closed", () => {
    renderCard(null);

    expect(apiMocks.inspectQueueItem).not.toHaveBeenCalled();
  });
});
