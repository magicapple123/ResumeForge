// SPDX-License-Identifier: Apache-2.0
/**
 * #15A 体检里的 `ghost_job`（僵尸岗提示）在**前端**必须能渲染。
 *
 * 这条用例是为一个真实的跨层缺口写的：后端 `PreflightCode` 扩了 `ghost_job`，前端
 * `ApplyPreflightCode` 的联合类型与 `CODE_LABEL_KEYS` 若没跟上，`t(undefined)` 会在渲染期
 * 抛错——整个体检抽屉白屏，而且只有"某条岗位 >70 分"时才会出现，本地很难撞见。
 *
 * 断言三件事：
 * 1. 标签按协议值翻成语言包里的展示名（不是原码、不是崩）；
 * 2. 后端给的两句文案（`message` / `fix`）原样展示，前端不重写；
 * 3. **没有**一键修按钮——僵尸岗是提示，投不投由用户决定，"忽略"在队列行徽标里。
 */
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyPreflightResult, ApplyQueueItem } from "../../../types";
import { ApplyQueuePreflightDrawer, fixActionOf } from "./ApplyQueuePreflightDrawer";

const ITEM: ApplyQueueItem = {
  id: 8,
  job_id: 80,
  job_title: "Backend Engineer",
  company: "ACME",
  resume_id: null,
  resume_title: "",
  greeting: "",
  sort_order: 8,
  status: "pending",
  admission: null,
  hard_gate: null,
  requires_confirm: false,
  ghost_score: 82,
  ghost_evidence: ["First seen 63 days ago"],
  jd_changed: false,
  ghost_ignored: false,
  created_at: "2026-09-17T08:00:00",
  updated_at: "2026-09-17T08:00:00",
};

const GHOST_RESULT: ApplyPreflightResult = {
  items: [
    {
      queue_id: 8,
      issues: [
        {
          code: "ghost_job",
          severity: "warning",
          message: "This Job looks long-lived: ghost score 82",
          fix: "Apply anyway / ignore the ghost flag",
        },
      ],
    },
  ],
  summary: { blocking: 0, warnings: 1 },
};

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ApplyQueuePreflightDrawer 的 ghost_job（#15A）", () => {
  it("renders the ghost warning without crashing and without a one-click fix", () => {
    render(
      <MemoryRouter>
        <ApplyQueuePreflightDrawer
          open
          loading={false}
          result={GHOST_RESULT}
          items={[ITEM]}
          onClose={vi.fn()}
          onFixRemove={vi.fn()}
          onFixEdit={vi.fn()}
        />
      </MemoryRouter>,
    );

    // 1) 协议值翻成了语言包里的展示名（漏登记的话这里会变成崩溃或原码）。
    expect(screen.getByText(t("applyQueue.preflight.code.ghost_job"))).toBeInTheDocument();
    // 2) 后端的两句文案原样展示。
    expect(screen.getByText("This Job looks long-lived: ghost score 82")).toBeInTheDocument();
    expect(
      screen.getByText(
        t("applyQueue.preflight.fixLabel", { fix: "Apply anyway / ignore the ghost flag" }),
      ),
    ).toBeInTheDocument();
    // 3) 不给一键动作：僵尸岗是提示，不是"哪里没准备好"。
    //    判据落在**这一行**里没有 button（抽屉右上角的 × 不算）。
    const row = document.querySelector(".apply-queue-preflight-row");
    expect(row).not.toBeNull();
    expect(row?.querySelector("button")).toBeNull();
    expect(fixActionOf("ghost_job")).toBe("ignore");
  });
});
