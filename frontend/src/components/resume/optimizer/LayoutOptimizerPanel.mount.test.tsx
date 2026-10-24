// SPDX-License-Identifier: Apache-2.0
/**
 * W09 挂载级 e2e（模拟主预览「版面诊断」卡的宿主契约）：
 * 卡片出现 → 无可行方案给原因 → 应用写回滑杆参数（宿主 state）→ 失败不标记已应用。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { ot } from "../../../features/resume-optimizer/i18n";
import type { OptimizerCurrentValues } from "../../../features/resume-optimizer/types";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import type { ResumeFitCandidate, ResumeLayoutAnalysis } from "../../../types/resumeLayout";
import LayoutOptimizerPanel from "./LayoutOptimizerPanel";

afterEach(() => cleanup());

const CURRENT: OptimizerCurrentValues = {
  page_padding: 14,
  section_gap: 1.3,
  line_height: 1.7,
  font_scale_adjust: 1,
};

function candidate(key: string, config: ResumeFitCandidate["config"]): ResumeFitCandidate {
  return { key, label: "候选 " + key, config, css: "css-" + key };
}

const ANALYSIS: ResumeLayoutAnalysis = {
  diagnosis: {
    status: "overflow",
    status_label: "超出",
    summary: "",
    fill: 1.2,
    pages_needed: 2,
    page_limit: 1,
    pages: [],
    suggestions: [],
  },
  fit_ladder: [
    candidate("padding", { page_padding: 12 }),
    candidate("line", { page_padding: 12, section_gap: 1.1, line_height: 1.6 }),
  ],
  fit_room: {
    has_room: true,
    steps: 2,
    font_floor_px: 11,
    font_adjust_floor: 0.88,
    font_floor_note: "",
  },
};

const BEFORE: LayoutMeasure = { usedHeight: 1200, pageContentHeight: 1000, pageLimit: 1 };

/** 模拟主预览宿主：apply 把候选里的值写回"滑杆 state"。 */
function HostHarness({ failApply = false }: { failApply?: boolean }) {
  const [sliders, setSliders] = useState(CURRENT);
  const probe = (css: string): LayoutMeasure | null =>
    css === "css-padding"
      ? { usedHeight: 1150, pageContentHeight: 1000, pageLimit: 1 }
      : { usedHeight: 980, pageContentHeight: 1000, pageLimit: 1 };
  const apply = async (view: { changes: { key: keyof OptimizerCurrentValues; to: number }[] }) => {
    if (failApply) throw new Error("layout_conflict");
    setSliders((values) => {
      const next = { ...values };
      for (const change of view.changes) next[change.key] = change.to;
      return next;
    });
  };
  return (
    <AntdApp>
      <div data-sliders={JSON.stringify(sliders)}>
        <LayoutOptimizerPanel
          analysis={ANALYSIS}
          current={sliders}
          probe={probe}
          before={BEFORE}
          onApply={apply}
        />
      </div>
    </AntdApp>
  );
}

describe("LayoutOptimizerPanel 挂载 e2e", () => {
  it("卡片出现 → 生成候选 → 应用后宿主滑杆 state 真的变了", async () => {
    render(<HostHarness />);
    expect(screen.getByText(ot("optimizer.title"))).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }));
    await waitFor(() => expect(screen.getByText(ot("optimizer.applied.hint"))).toBeTruthy());
    const host = document.querySelector("[data-sliders]");
    const sliders = JSON.parse(host?.getAttribute("data-sliders") ?? "{}");
    expect(sliders.page_padding).toBe(12);
  });

  it("应用失败：不标记已应用（不假装成功），滑杆不变", async () => {
    render(<HostHarness failApply />);
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }),
      ).toBeTruthy(),
    );
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }));
    await waitFor(() => expect(screen.queryByText(ot("optimizer.applied.hint"))).toBeNull());
  });

  it("分析结果缺失（防陈旧：宿主不传 analysis）→ 不生成、按钮禁用", () => {
    render(
      <AntdApp>
        <LayoutOptimizerPanel
          analysis={null}
          current={CURRENT}
          before={BEFORE}
          probe={() => BEFORE}
        />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: ot("optimizer.generate") })).toBeDisabled();
  });
});
