// SPDX-License-Identifier: Apache-2.0
/** 「数据完整度」筛选项（CR-36）的组件行为。 */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
// 断言文案走语言包（`t()`），中文不落在 `getByText` 字面量里（cjkRatchet 口径）。
import { t } from "../../i18n";
import JobCompletenessFilter from "./JobCompletenessFilter";

describe("JobCompletenessFilter", () => {
  it("未勾选时不显示可疑条数", () => {
    render(<JobCompletenessFilter checked={false} onChange={() => {}} total={3} />);
    expect(screen.getByText(t("jobsPage.completeness.label"))).toBeTruthy();
    expect(screen.queryByTestId("job-completeness-count")).toBeNull();
  });

  it("点击复选框回调新的勾选状态", () => {
    const onChange = vi.fn();
    render(<JobCompletenessFilter checked={false} onChange={onChange} total={0} />);

    fireEvent.click(screen.getByRole("checkbox"));

    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("勾选后显示当前筛选口径下的条数", () => {
    render(<JobCompletenessFilter checked onChange={() => {}} total={3} />);
    expect(screen.getByTestId("job-completeness-count").textContent).toContain("3");
  });

  it("加载中显示统计中", () => {
    render(<JobCompletenessFilter checked onChange={() => {}} total={0} loading />);
    expect(screen.getByTestId("job-completeness-count").textContent).toContain(
      t("jobsPage.completeness.counting"),
    );
  });
});
