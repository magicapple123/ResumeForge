// SPDX-License-Identifier: Apache-2.0
/**
 * #15A 队列行「僵尸 82」徽标。
 *
 * 断言的是**用户能得到的四件事**，不是"元素存在"：
 * 1. 三档颜色（低/中/高）——颜色就是提醒强度，分档错了整个功能就没有意义；
 * 2. 证据逐条列出（后端给几条就显示几条，不合并成一句话）；
 * 3. 「忽略此岗位」的调用参数是 `(queue_id, { ignored: true })`，且成功后**这一行**的徽标消失；
 * 4. `ghost_score = null`（冷启动）时一个像素都不渲染——不能把"没数据"画成 0 分。
 *
 * 另有一条集成用例：徽标确实挂在队列表的那一行上（否则组件写得再对也没人看见）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import type { ApplyQueueItem } from "../../../types";
import { ContextMenuHost } from "../../../features/context-menu/ContextMenuHost";

const apiMocks = vi.hoisted(() => ({
  setGhostIgnored: vi.fn(),
}));

vi.mock("../../../api/applyInsights", () => ({
  setGhostIgnored: apiMocks.setGhostIgnored,
}));

import GhostBadge from "./GhostBadge";
import { QueueTable } from "../queue/QueueTable";

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.setGhostIgnored.mockResolvedValue({ queue_id: 1, ignored: true });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

function renderBadge(props: {
  queueId?: number;
  score?: number | null;
  evidence?: string[];
  ignored?: boolean;
}) {
  return render(
    <AntdApp>
      <GhostBadge
        queueId={props.queueId ?? 1}
        score={props.score === undefined ? 82 : props.score}
        evidence={props.evidence}
        ignored={props.ignored}
      />
    </AntdApp>,
  );
}

/** 打开证据浮层（点击徽标）。 */
function openPopover(score: number) {
  fireEvent.click(
    screen.getByRole("button", { name: t("applyQueue.insights.ghost.badge", { score }) }),
  );
}

describe("GhostBadge（#15A）", () => {
  it("colours the three score bands differently", () => {
    const { unmount } = renderBadge({ score: 30 });
    const low = screen.getByRole("button", {
      name: t("applyQueue.insights.ghost.badge", { score: 30 }),
    });
    expect(low).toHaveAttribute("data-band", "low");
    expect(low).toHaveClass("ant-tag-default");
    unmount();

    const middle = renderBadge({ score: 55 });
    const mid = screen.getByRole("button", {
      name: t("applyQueue.insights.ghost.badge", { score: 55 }),
    });
    expect(mid).toHaveAttribute("data-band", "mid");
    expect(mid).toHaveClass("ant-tag-orange");
    middle.unmount();

    renderBadge({ score: 82 });
    const high = screen.getByRole("button", {
      name: t("applyQueue.insights.ghost.badge", { score: 82 }),
    });
    expect(high).toHaveAttribute("data-band", "high");
    expect(high).toHaveClass("ant-tag-red");
  });

  it("lists every evidence line the backend sent", () => {
    renderBadge({ score: 82, evidence: ["First seen 63 days ago", "Re-collected 4 times"] });

    openPopover(82);

    expect(screen.getByText("First seen 63 days ago")).toBeInTheDocument();
    expect(screen.getByText("Re-collected 4 times")).toBeInTheDocument();
    // 逐条：两条证据就是两个列表项，不是拼成一句。
    expect(document.querySelectorAll(".apply-ghost-evidence li")).toHaveLength(2);
  });

  it("ignores the Job with (id, { ignored: true }) and hides only this badge", async () => {
    renderBadge({ queueId: 7, score: 82, evidence: ["First seen 63 days ago"] });

    openPopover(82);
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.insights.ghost.ignore") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("applyQueue.insights.ghost.ignoreOk") }),
    );

    await waitFor(() =>
      expect(apiMocks.setGhostIgnored).toHaveBeenCalledWith(7, { ignored: true }),
    );
    // 成功后这一行不再有徽标（不刷新整表，也不残留一个已忽略的分数）。
    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: t("applyQueue.insights.ghost.badge", { score: 82 }) }),
      ).not.toBeInTheDocument(),
    );
  });

  it("keeps the badge when the ignore request fails", async () => {
    apiMocks.setGhostIgnored.mockRejectedValue(new Error("boom"));
    renderBadge({ queueId: 3, score: 82 });

    openPopover(82);
    fireEvent.click(screen.getByRole("button", { name: t("applyQueue.insights.ghost.ignore") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("applyQueue.insights.ghost.ignoreOk") }),
    );

    await waitFor(() => expect(apiMocks.setGhostIgnored).toHaveBeenCalledTimes(1));
    // 失败不动数据：徽标还在，用户可以再点一次。
    expect(
      screen.getByRole("button", { name: t("applyQueue.insights.ghost.badge", { score: 82 }) }),
    ).toBeInTheDocument();
  });

  it("renders nothing when there is no score yet or the user ignored it", () => {
    // `AntdApp` 自己会渲染一层壳，所以判据是"壳里没有徽标、也没有任何文字"，
    // 而不是 container 为空。
    const { container: cold } = renderBadge({ score: null });
    expect(cold.querySelector(".apply-ghost-badge")).toBeNull();
    expect(cold.textContent).toBe("");
    cold.remove();

    const { container: ignored } = renderBadge({ score: 82, ignored: true });
    expect(ignored.querySelector(".apply-ghost-badge")).toBeNull();
    expect(ignored.textContent).toBe("");
  });
});

function queueItem(id: number, jobTitle: string, ghostScore: number | null): ApplyQueueItem {
  return {
    id,
    job_id: id * 10,
    job_title: jobTitle,
    company: "ACME",
    resume_id: null,
    resume_title: "",
    greeting: "",
    sort_order: id,
    status: "pending",
    admission: null,
    hard_gate: null,
    requires_confirm: false,
    ghost_score: ghostScore,
    ghost_evidence: ghostScore === null ? [] : ["First seen 63 days ago"],
    jd_changed: false,
    ghost_ignored: false,
    created_at: "2026-09-17T08:00:00",
    updated_at: "2026-09-17T08:00:00",
  };
}

describe("QueueTable + GhostBadge（#15A）", () => {
  it("only puts the badge on the row that has a score", () => {
    const items = [queueItem(1, "Backend Engineer", 82), queueItem(2, "Frontend Engineer", null)];
    render(
      <AntdApp>
        <ContextMenuHost>
          <QueueTable
            items={items}
            busy={false}
            selectedIds={[]}
            setSelectedIds={vi.fn()}
            setDetail={vi.fn()}
            rowMenuItems={() => [{ key: "x", label: "placeholder" }]}
            onInspect={vi.fn()}
          />
        </ContextMenuHost>
      </AntdApp>,
    );

    const badges = screen.getAllByRole("button", {
      name: t("applyQueue.insights.ghost.badge", { score: 82 }),
    });
    expect(badges).toHaveLength(1);
    // 徽标落在第一条（有分的那一行）里，不是随便某个单元格。
    expect(badges[0].closest("tr")).toHaveTextContent("Backend Engineer");
  });
});
