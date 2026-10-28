// SPDX-License-Identifier: Apache-2.0
/** ProfilePlacementGuide（F6/S）：§3.4 判定规则表十行 + 总则可达（培训说明已按用户要求下线）。 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ProfilePlacementGuide from "./ProfilePlacementGuide";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePlacementGuide", () => {
  it("完整展示十行规则与总则", () => {
    render(<ProfilePlacementGuide open onClose={vi.fn()} />);
    expect(screen.getAllByTestId("placement-guide-row")).toHaveLength(10);
    expect(screen.getByText(t("profileLibrary.guide.total"))).toBeInTheDocument();
    const firstRule = t("profileLibrary.guide.row.work").split("|");
    expect(screen.getByText(firstRule[0])).toBeInTheDocument();
    expect(screen.getByText(firstRule[1])).toBeInTheDocument();
  });

  it("只读弹层没有 footer 动作，关闭走 onClose", () => {
    const onClose = vi.fn();
    render(<ProfilePlacementGuide open onClose={onClose} />);
    expect(screen.queryByRole("button", { name: t("profileLibrary.guide.close") })).toBeNull();
    fireEvent.click(screen.getAllByLabelText("Close")[0]);
    expect(onClose).toHaveBeenCalled();
  });

  /**
   * 需求 7：表格前要有术语说明（方案 / 板块 / 字段 + 层级）。
   *
   * 断言的是"三个词各自被解释过 + 层级那一句在"，不是逐字比对整段文案——文案会继续打磨，
   * 但这四块内容缺一块，用户就又看不懂表格里的「该填哪里」指的是哪一层。
   */
  it("表格前给出方案 / 板块 / 字段三个词的释义与层级", () => {
    render(<ProfilePlacementGuide open onClose={vi.fn()} />);

    const terms = screen.getByTestId("placement-guide-terms");
    expect(screen.getAllByTestId("placement-guide-term")).toHaveLength(3);
    const termKeys = [
      "profileLibrary.guide.terms.plan",
      "profileLibrary.guide.terms.section",
      "profileLibrary.guide.terms.field",
      "profileLibrary.guide.terms.hierarchy",
    ] as const;
    for (const key of termKeys) {
      expect(within(terms).getByText(t(key))).toBeInTheDocument();
    }

    // 位置：术语说明必须排在判定表**前面**（先给词汇表，再看表格）。
    const table = screen.getByTestId("placement-guide");
    expect(terms.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
