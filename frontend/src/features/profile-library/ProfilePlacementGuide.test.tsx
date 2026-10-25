// SPDX-License-Identifier: Apache-2.0
/** ProfilePlacementGuide（F6/S）：§3.4 判定规则表十行 + 总则 + 培训替代说明都可达。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import ProfilePlacementGuide from "./ProfilePlacementGuide";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ProfilePlacementGuide", () => {
  it("完整展示十行规则、总则与培训替代路径", () => {
    render(<ProfilePlacementGuide open onClose={vi.fn()} />);
    expect(screen.getAllByTestId("placement-guide-row")).toHaveLength(10);
    expect(screen.getByText(t("profileLibrary.guide.total"))).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.guide.trainingTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("profileLibrary.guide.trainingBody"))).toBeInTheDocument();
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
});
