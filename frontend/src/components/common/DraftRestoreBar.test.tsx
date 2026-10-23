// SPDX-License-Identifier: Apache-2.0
/**
 * 草稿恢复条：「查看差异」入口的**出现条件**。
 *
 * 这一条修的是一个说不通的状态（2026-10-24 用户反馈"有时看不到按钮"）：界面明明写着
 * "有一条上次没提交的草稿"，却找不到「查看差异」。根因是入口按 `changes.length > 0`
 * 渲染，而草稿与当前内容一致、或差异字段不在 diff 覆盖范围时那个数组就是空的。
 *
 * 现在的口径：**有草稿（`changes` 非 null）就有入口**；展开后没有差异行时给一句
 * 「草稿与当前内容一致」——"没有变化"本身就是用户点开想知道的答案。
 *
 * 断言一律走 `t()` 取文案：本文件是新增的，`cjkRatchet` 对新增测试文件按 0 计。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { DraftDiffEntry } from "../../utils/draftDiff";
import DraftRestoreBar from "./DraftRestoreBar";

afterEach(cleanup);

function renderBar(changes: DraftDiffEntry[] | null | undefined) {
  return render(
    <DraftRestoreBar
      savedAt={Date.UTC(2026, 9, 24, 6, 30)}
      fieldCount={2}
      onRestore={vi.fn()}
      onDiscard={vi.fn()}
      changes={changes}
    />,
  );
}

describe("DraftRestoreBar 「查看差异」", () => {
  it("草稿与当前内容一致时，入口仍然在，展开后说明没有差异", () => {
    renderBar([]);

    // 关键：空数组 ≠ 没有草稿。界面上有草稿却没有入口，用户会以为功能坏了。
    const toggle = screen.getByRole("button", { name: t("draft.diff.show") });
    fireEvent.click(toggle);

    expect(screen.getByText(t("draft.diff.same"))).toBeInTheDocument();
    // 展开后按钮换成「收起差异」：同一颗按钮，两个状态。
    expect(screen.getByRole("button", { name: t("draft.diff.hide") })).toBeInTheDocument();
  });

  it("有差异时逐行渲染，且不出现「内容一致」那句", () => {
    const changes: DraftDiffEntry[] = [
      { label: "Summary", before: "before-value", after: "after-value" },
    ];
    renderBar(changes);

    fireEvent.click(screen.getByRole("button", { name: t("draft.diff.show") }));

    expect(screen.getByText("Summary")).toBeInTheDocument();
    expect(screen.getByText("before-value")).toBeInTheDocument();
    expect(screen.getByText("after-value")).toBeInTheDocument();
    expect(screen.queryByText(t("draft.diff.same"))).not.toBeInTheDocument();
  });

  it("没有草稿（不传 changes）时完全没有这个入口", () => {
    renderBar(undefined);

    expect(screen.queryByRole("button", { name: t("draft.diff.show") })).not.toBeInTheDocument();
    // 恢复/放弃仍然在：这条断言钉住"只藏差异入口，不是整块消失"。
    expect(screen.getByRole("button", { name: t("draft.restore.action") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("draft.discard.action") })).toBeInTheDocument();
  });
});
