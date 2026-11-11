// SPDX-License-Identifier: Apache-2.0
/**
 * #15B JD 变更抽屉：左右两栏、逐行 diff、**必须写明「下次采集时更新」**。
 *
 * 断言重点：
 * - 两版文本都在（左=上次采集、右=本次采集），且改动的行有 `data-diff` 标记（红/绿）；
 * - 顶部一定有「被动式」那句——不写用户会以为点开就重抓了一遍；
 * - `changed=false` 时**不给 diff**（不把同一段话左右各摆一遍），只写一句"没有变更"；
 * - 请求失败只在这个抽屉里报错，不外溢（记录页照常可用）。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyJdChange } from "../../../types";
import { formatDateTime } from "../../../utils/format";

const apiMocks = vi.hoisted(() => ({
  getJdChange: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getJdChange: apiMocks.getJdChange,
}));

import JdChangeDrawer from "./JdChangeDrawer";

const CHANGED: ApplyJdChange = {
  changed: true,
  // 夹具用英文：JD 正文是**后端数据**，与界面文案无关；用 ASCII 也避免与 i18n 守卫混淆。
  before: "Builds backend services\nPython\n3 years of experience",
  after: "Builds backend and data pipelines\nPython\n5 years of experience",
  seen_at: "2026-11-10T09:30:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getJdChange.mockResolvedValue(CHANGED);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderDrawer(queueId: number | null = 12) {
  return render(<JdChangeDrawer open queueId={queueId} onClose={vi.fn()} />);
}

describe("JdChangeDrawer（#15B）", () => {
  it("shows both versions and marks the changed lines", async () => {
    renderDrawer(12);

    expect(await screen.findByText("Builds backend services")).toBeInTheDocument();
    expect(screen.getByText("Builds backend and data pipelines")).toBeInTheDocument();
    expect(screen.getByText("3 years of experience")).toBeInTheDocument();
    expect(screen.getByText("5 years of experience")).toBeInTheDocument();
    // 未变的行两侧都在（说明是逐行对齐，不是把两份整段并排堆起来）。
    expect(screen.getAllByText("Python")).toHaveLength(2);

    const removed = document.querySelectorAll('.apply-jd-diff-cell[data-diff="removed"]');
    const added = document.querySelectorAll('.apply-jd-diff-cell[data-diff="added"]');
    expect(removed).toHaveLength(2);
    expect(added).toHaveLength(2);
    expect(removed[0]).toHaveTextContent("Builds backend services");
    expect(added[0]).toHaveTextContent("Builds backend and data pipelines");

    // 两栏标题：上次采集 / 本次采集。
    expect(screen.getByText(t("applyQueue.insights.jdChange.before"))).toBeInTheDocument();
    expect(screen.getByText(t("applyQueue.insights.jdChange.after"))).toBeInTheDocument();
  });

  it("always says it updates on the next collection", async () => {
    renderDrawer(12);

    await screen.findByText("Builds backend services");
    // 顶部那条提示**必须**同时带「被动式：下次采集时更新」与本次采集时间：
    // 只有时间没有这句话，用户会以为点开就重抓了一遍。
    const notice = screen.getByRole("alert");
    expect(notice).toHaveTextContent(t("applyQueue.insights.jdChange.passive"));
    expect(notice).toHaveTextContent(
      t("applyQueue.insights.jdChange.seenAt", { time: formatDateTime(CHANGED.seen_at ?? "") }),
    );
  });

  it("does not fake a diff when nothing changed", async () => {
    apiMocks.getJdChange.mockResolvedValue({
      changed: false,
      before: "Identical description",
      after: "Identical description",
      seen_at: null,
    });

    renderDrawer(12);

    expect(
      await screen.findByText(t("applyQueue.insights.jdChange.unchanged")),
    ).toBeInTheDocument();
    expect(document.querySelector(".apply-jd-diff")).toBeNull();
    expect(screen.queryByText("Identical description")).not.toBeInTheDocument();
    // 没有第二次采集时不编时间。
    expect(screen.getByText(t("applyQueue.insights.jdChange.seenAtUnknown"))).toBeInTheDocument();
  });

  it("reports the failure inside the drawer only", async () => {
    apiMocks.getJdChange.mockRejectedValue(new Error("boom"));

    renderDrawer(12);

    expect(await screen.findByText(t("applyQueue.insights.jdChange.error"))).toBeInTheDocument();
    expect(document.querySelector(".apply-jd-diff")).toBeNull();
  });

  it("never calls the endpoint without a queue id", async () => {
    render(<JdChangeDrawer open queueId={null} onClose={vi.fn()} />);

    // 没有队列条目 id 时只说明"看不到前后对比"，绝不拿别的 id 去猜一份 diff。
    expect(await screen.findByText(t("applyQueue.insights.jdChange.noId"))).toBeInTheDocument();
    expect(apiMocks.getJdChange).not.toHaveBeenCalled();
  });
});
