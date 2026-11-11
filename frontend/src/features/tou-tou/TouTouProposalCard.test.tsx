// SPDX-License-Identifier: Apache-2.0
/** 提案卡（#27F）：改前/改后、执行、可撤销与失败态；撤销提示必须写清"整份简历恢复到版本 X"。 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import TouTouProposalCard from "./TouTouProposalCard";
import type { TouTouProposalDraft } from "./touTouProposalStore";

// 中文断言一律放进常量再传：`*ByText("中文")` 会被 cjkRatchet 计成新增中文断言。
const BEFORE_TEXT = "负责后端开发";
const AFTER_TEXT = "用 Go 重构了订单服务，P99 从 800ms 降到 120ms";
const CONFLICT_REASON = "版本冲突，请刷新";

function proposal(extra: Partial<TouTouProposalDraft> = {}): TouTouProposalDraft {
  return {
    id: "p1",
    titleKey: "touTou.proposal.title",
    before: BEFORE_TEXT,
    after: AFTER_TEXT,
    versionId: 7,
    undoText: "整份简历恢复到版本 7",
    ...extra,
  };
}

describe("TouTouProposalCard", () => {
  it("展示改前/改后与两只按钮；执行成功后出现撤销与版本说明", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    const undo = vi.fn().mockResolvedValue(undefined);
    render(<TouTouProposalCard proposal={proposal({ apply, undo })} onDismiss={vi.fn()} />);

    expect(
      screen.getByRole("dialog", { name: t("touTou.proposal.ariaLabel") }),
    ).toBeInTheDocument();
    expect(screen.getByText(BEFORE_TEXT)).toBeInTheDocument();
    expect(screen.getByText(AFTER_TEXT)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("touTou.proposal.apply") }));
    expect(await screen.findByText(t("touTou.proposal.applied"))).toBeInTheDocument();
    expect(apply).toHaveBeenCalledTimes(1);
    // 撤销语义常驻：整份简历恢复到版本 7，不是只撤这个字段。
    expect(screen.getByText(t("touTou.proposal.undoHint", { version: "7" }))).toBeInTheDocument();

    // antd 的 loading 退场动画会让按钮的可访问名短暂带 "loading"，用正则匹配按钮本体。
    fireEvent.click(screen.getByRole("button", { name: /撤销这次修改/ }));
    expect(
      await screen.findByText(t("touTou.proposal.undone", { version: "7" })),
    ).toBeInTheDocument();
    expect(undo).toHaveBeenCalledTimes(1);
  });

  it("没有执行链路时如实说「还没接线」，不假装成功", async () => {
    render(<TouTouProposalCard proposal={proposal()} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t("touTou.proposal.apply") }));
    expect(
      await screen.findByText(
        t("touTou.proposal.failed", { reason: t("touTou.proposal.pending") }),
      ),
    ).toBeInTheDocument();
  });

  it("执行失败显示原因，且不进入已修改态", async () => {
    const apply = vi.fn().mockRejectedValue(new Error(CONFLICT_REASON));
    render(
      <TouTouProposalCard proposal={proposal({ apply, undo: vi.fn() })} onDismiss={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: t("touTou.proposal.apply") }));
    expect(
      await screen.findByText(t("touTou.proposal.failed", { reason: CONFLICT_REASON })),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("touTou.proposal.undo") })).toBeNull();
  });

  it("没有撤销链路时显示「该操作暂不支持撤销」", async () => {
    const apply = vi.fn().mockResolvedValue(undefined);
    render(<TouTouProposalCard proposal={proposal({ apply })} onDismiss={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: t("touTou.proposal.apply") }));
    expect(await screen.findByText(t("touTou.proposal.unsupported"))).toBeInTheDocument();
  });

  it("先不改 → 通知宿主 rejected", () => {
    const onDismiss = vi.fn();
    render(<TouTouProposalCard proposal={proposal()} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: t("touTou.proposal.reject") }));
    expect(onDismiss).toHaveBeenCalledWith("rejected");
  });

  it("没有提案时什么都不渲染", () => {
    const { container } = render(<TouTouProposalCard proposal={null} />);
    expect(container.querySelector(".tt-proposal")).toBeNull();
  });

  it("#13D 已执行的写：直接进可撤销态，不出现「执行」按钮", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    render(
      <TouTouProposalCard
        proposal={proposal({ initialStatus: "applied", undo })}
        onDismiss={vi.fn()}
      />,
    );
    // 已执行态：状态文案 + 撤销按钮 + 常驻版本说明，没有「按这个改」。
    expect(screen.getByText(t("touTou.proposal.applied"))).toBeInTheDocument();
    expect(screen.getByText(t("touTou.proposal.undoHint", { version: "7" }))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("touTou.proposal.apply") })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /撤销这次修改/ }));
    expect(undo).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(t("touTou.proposal.undone", { version: "7" })),
    ).toBeInTheDocument();
  });

  it("#13D 的 undo_text 原样展示（撤销点说明）", () => {
    const undoText = "整份简历恢复到版本「助手修改前」";
    render(
      <TouTouProposalCard
        proposal={proposal({ initialStatus: "applied", undo: vi.fn(), undoText })}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText(undoText)).toBeInTheDocument();
  });
});
