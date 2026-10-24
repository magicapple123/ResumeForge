// SPDX-License-Identifier: Apache-2.0
/** 双语字段对照（W16）：差异行、事实锁不可采纳、全一致空态。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bt } from "../../../features/resume-bilingual/i18n";
import { buildBilingualPairs } from "../../../features/resume-bilingual/fieldPairs";
import { MOCK_PRIMARY, MOCK_SECONDARY } from "../../../features/resume-bilingual/mock";
import BilingualCompareView from "./BilingualCompareView";

const PAIRS = buildBilingualPairs(MOCK_PRIMARY, MOCK_SECONDARY);

afterEach(() => cleanup());

describe("BilingualCompareView", () => {
  it("按分组渲染两侧文本", () => {
    render(
      <AntdApp>
        <BilingualCompareView pairs={PAIRS} />
      </AntdApp>,
    );
    // 分组标题与字段标签可能同文（如"个人总结"既是分组也是字段名），这里只要求存在。
    expect(screen.getAllByText(bt("bilingual.compare.group.summary")).length).toBeGreaterThan(0);
    expect(screen.getByText(MOCK_PRIMARY.summary)).toBeTruthy();
    expect(screen.getByText(MOCK_SECONDARY.summary)).toBeTruthy();
  });

  it("有差异且未锁定的行可采纳；事实锁行没有采纳按钮", () => {
    const onAdopt = vi.fn();
    render(
      <AntdApp>
        <BilingualCompareView pairs={PAIRS} onAdopt={onAdopt} />
      </AntdApp>,
    );
    // 采纳按钮的无障碍名是"采纳第 <path> 条翻译"：只要存在可采纳行即可。
    const adoptButtons = screen.getAllByRole("button", { name: /^采纳第/ });
    expect(adoptButtons.length).toBeGreaterThan(0);
    fireEvent.click(adoptButtons[0]);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(typeof onAdopt.mock.calls[0][0]).toBe("string");
    // 姓名/机构/时间是事实锁：有"事实锁"标记，且这些行没有采纳按钮。
    expect(screen.getAllByText(bt("bilingual.compare.locked")).length).toBeGreaterThan(0);
    expect(adoptButtons.length).toBeLessThan(
      PAIRS.filter((pair) => pair.status === "changed").length,
    );
  });

  it("两边都没有内容时显示空态说明", () => {
    render(
      <AntdApp>
        <BilingualCompareView pairs={buildBilingualPairs(null, null)} />
      </AntdApp>,
    );
    expect(screen.getByText(bt("bilingual.compare.nothing"))).toBeTruthy();
  });
});
