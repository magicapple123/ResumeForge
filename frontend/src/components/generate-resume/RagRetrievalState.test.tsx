// SPDX-License-Identifier: Apache-2.0
/** #30 语义检索回执：五态徽标、审计行、明细展开与两个出口的可见性。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { RagRetrieval } from "../../types";
import RagRetrievalState from "./RagRetrievalState";

afterEach(() => {
  cleanup();
});

function hit(): RagRetrieval {
  return {
    state: "hit",
    hit_count: 2,
    expanded_terms: 1,
    reason: "",
    impacts: [
      { entry_id: "e1", title: "订单服务改造", section: "项目经历", delta: 0.31 },
      { entry_id: "e2", title: "支付重构", section: "项目经历", delta: 0.12 },
    ],
  };
}

describe("RagRetrievalState 五态", () => {
  it("没有回执时不渲染任何东西（尚未检索 ≠ 未启用）", () => {
    const { container } = render(<RagRetrievalState rag={null} variant="progress" />);
    expect(container.firstChild).toBeNull();
  });

  it("off 态是灰色「未启用」，并提供去开启入口", () => {
    const onEnable = vi.fn();
    render(
      <RagRetrievalState
        rag={{ state: "off", hit_count: 0, expanded_terms: 0, reason: "disabled" }}
        variant="progress"
        onEnable={onEnable}
      />,
    );
    expect(screen.getByText(t("generateStages.rag.state.off"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: t("generateStages.rag.enable") }));
    expect(onEnable).toHaveBeenCalledTimes(1);
  });

  it("empty 与 miss 必须分开显示（索引为空不是无命中）", () => {
    render(
      <RagRetrievalState
        rag={{ state: "empty", hit_count: 0, expanded_terms: 0, reason: "empty_index" }}
        variant="progress"
      />,
    );
    expect(screen.getByText(t("generateStages.rag.state.empty"))).toBeTruthy();
    cleanup();
    render(
      <RagRetrievalState
        rag={{ state: "miss", hit_count: 0, expanded_terms: 0, reason: "" }}
        variant="progress"
      />,
    );
    expect(screen.getByText(t("generateStages.rag.state.miss"))).toBeTruthy();
  });

  it("fallback 带耗时，让用户分清「慢」和「坏」", () => {
    render(
      <RagRetrievalState
        rag={{
          state: "fallback",
          hit_count: 0,
          expanded_terms: 0,
          reason: "budget_exceeded",
          elapsed_ms: 153,
        }}
        variant="progress"
      />,
    );
    expect(screen.getByText(t("generateStages.rag.state.fallback", { ms: 153 }))).toBeTruthy();
  });
});

describe("RagRetrievalState 审计行", () => {
  it("hit 态显示条数与影响条目数，展开后列出条目名、分值与跳转", () => {
    const onOpenProfile = vi.fn();
    render(<RagRetrievalState rag={hit()} variant="audit" onOpenProfile={onOpenProfile} />);
    expect(
      screen.getByText(t("generateStages.rag.audit.hit", { count: 2, impacts: 2 })),
    ).toBeTruthy();
    expect(screen.queryByTestId("rag-audit-impacts")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t("generateStages.rag.audit.expand") }));
    expect(screen.getByTestId("rag-audit-impacts")).toBeTruthy();
    // 条目名与分值来自回执数据（后端数据，不是界面文案），按回执值断言。
    expect(screen.getByText(hit().impacts?.[0].title ?? "")).toBeTruthy();
    expect(screen.getByText("+0.31")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: t("generateStages.rag.audit.jump") })[0]);
    expect(onOpenProfile).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: t("generateStages.rag.audit.collapse") }));
    expect(screen.queryByTestId("rag-audit-impacts")).toBeNull();
  });

  it("未参与时同样有这一行并写清原因（静默降级是最坏的选择）", () => {
    render(
      <RagRetrievalState
        rag={{
          state: "fallback",
          hit_count: 0,
          expanded_terms: 0,
          reason: "budget_exceeded",
          elapsed_ms: 88,
        }}
        variant="audit"
      />,
    );
    expect(screen.getByText(t("generateStages.rag.state.fallback", { ms: 88 }))).toBeTruthy();
    // 未命中不提供"展开明细"（没有明细可展开）。
    expect(screen.queryByRole("button", { name: t("generateStages.rag.audit.expand") })).toBeNull();
  });
});
