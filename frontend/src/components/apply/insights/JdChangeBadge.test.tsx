// SPDX-License-Identifier: Apache-2.0
/**
 * #15B 投递记录行的「你投的岗位有变更」徽标。
 *
 * 三件事必须有断言，缺一件这个功能就会静默失效：
 * - `jd_changed` 不为真 → 不渲染（否则每条记录都挂一枚恒亮徽标）；
 * - 有队列条目 id → 点开抽屉，按**这条记录的 queue_id** 取明细，两版文本与
 *   「下次采集时更新」都出现；
 * - 没有队列条目 id → 徽标仍在（"有变更"是真的），但**不发请求**、不打开抽屉。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyJdChange, ApplyRecord } from "../../../types";

const apiMocks = vi.hoisted(() => ({
  getJdChange: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  getJdChange: apiMocks.getJdChange,
}));

import JdChangeBadge from "./JdChangeBadge";

const CHANGED: ApplyJdChange = {
  changed: true,
  before: "3 years of experience",
  after: "5 years of experience",
  seen_at: "2026-11-10T09:30:00",
};

function record(patch: Partial<ApplyRecord> = {}): ApplyRecord {
  return {
    id: 91,
    task_id: 4,
    job_id: 12,
    job_title: "Backend Engineer",
    company: "ACME",
    resume_title: "后端版",
    greeting: "",
    status: "success",
    failure_category: "",
    failure_label: "",
    failure_detail: "",
    attempt: 1,
    jd_changed: true,
    queue_id: 12,
    created_at: "2026-11-09T08:00:00",
    finished_at: "2026-11-09T08:01:00",
    ...patch,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.getJdChange.mockResolvedValue(CHANGED);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("JdChangeBadge（#15B）", () => {
  it("renders nothing for a record whose JD did not change", () => {
    const { container } = render(<JdChangeBadge record={record({ jd_changed: false })} />);

    expect(container).toBeEmptyDOMElement();
    expect(apiMocks.getJdChange).not.toHaveBeenCalled();
  });

  it("opens the before/after drawer using this record's queue id", async () => {
    render(<JdChangeBadge record={record({ queue_id: 33, job_id: 12 })} />);

    const badge = screen.getByRole("button", {
      name: t("applyQueue.insights.jdChange.badge"),
    });
    expect(badge).toHaveClass("apply-jd-change-badge");
    fireEvent.click(badge);

    expect(await screen.findByText("3 years of experience")).toBeInTheDocument();
    expect(screen.getByText("5 years of experience")).toBeInTheDocument();
    // 顶部提示必须带「下次采集时更新」——这是 15B 的被动式契约，缺了就是功能说谎。
    expect(screen.getByRole("alert")).toHaveTextContent(t("applyQueue.insights.jdChange.passive"));
    // 必须是**这条记录的 queue_id**（33），不能拿 job_id（12）去猜一份明细出来。
    expect(apiMocks.getJdChange).toHaveBeenCalledWith(33);
    expect(apiMocks.getJdChange).not.toHaveBeenCalledWith(12);
  });

  it("keeps the badge but sends no request when the record has no queue id", async () => {
    render(<JdChangeBadge record={record({ queue_id: null })} />);

    const badge = screen.getByText(t("applyQueue.insights.jdChange.badge"));
    fireEvent.click(badge);

    // 徽标还在（"有变更"这件事没变），但没有 id 就不猜一份明细出来。
    await waitFor(() => expect(badge).toBeInTheDocument());
    // 不可点的语义也要对：没有 id 时徽标**不是按钮**（没有 role=button / 键盘等价），
    // 抽屉也没打开（没有那句「下次采集时更新」的 alert）。
    expect(
      screen.queryByRole("button", { name: t("applyQueue.insights.jdChange.badge") }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(apiMocks.getJdChange).not.toHaveBeenCalled();
    expect(screen.queryByText("3 years of experience")).not.toBeInTheDocument();
  });
});
