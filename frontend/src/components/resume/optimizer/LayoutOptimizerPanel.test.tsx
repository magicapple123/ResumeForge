// SPDX-License-Identifier: Apache-2.0
/** 版面优化面板（W09）：约束过滤、真实测量、应用回调、无虚假成功。 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ot } from "../../../features/resume-optimizer/i18n";
import type {
  OptimizerCandidateView,
  OptimizerCurrentValues,
} from "../../../features/resume-optimizer/types";
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

const LADDER: ResumeFitCandidate[] = [
  candidate("padding", { page_padding: 12 }),
  candidate("gap", { page_padding: 12, section_gap: 1.1 }),
  candidate("line", { page_padding: 12, section_gap: 1.1, line_height: 1.6 }),
  candidate("font", {
    page_padding: 12,
    section_gap: 1.1,
    line_height: 1.6,
    font_scale_adjust: 0.96,
  }),
];

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
  fit_ladder: LADDER,
  fit_room: {
    has_room: true,
    steps: 4,
    font_floor_px: 11,
    font_adjust_floor: 0.88,
    font_floor_note: "",
  },
};

const BEFORE: LayoutMeasure = { usedHeight: 1200, pageContentHeight: 1000, pageLimit: 1 };

/** 按注入的 CSS 返回实测高度（模拟浏览器的真实测量）。 */
function makeProbe(map: Record<string, number>) {
  const calls: string[] = [];
  const probe = (css: string): LayoutMeasure | null => {
    calls.push(css);
    const used = map[css];
    if (used === undefined) return null;
    return { usedHeight: used, pageContentHeight: 1000, pageLimit: 1 };
  };
  return { probe, calls };
}

function renderPanel(overrides: Partial<React.ComponentProps<typeof LayoutOptimizerPanel>> = {}) {
  const onApply = vi.fn(async (candidate: OptimizerCandidateView) => {
    void candidate;
  });
  const props: React.ComponentProps<typeof LayoutOptimizerPanel> = {
    analysis: ANALYSIS,
    current: CURRENT,
    before: BEFORE,
    probe: makeProbe({ "css-padding": 1180, "css-gap": 1100, "css-line": 1040, "css-font": 980 })
      .probe,
    onApply,
    ...overrides,
  };
  render(
    <AntdApp>
      <LayoutOptimizerPanel {...props} />
    </AntdApp>,
  );
  return { onApply };
}

const generate = () =>
  fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));

describe("LayoutOptimizerPanel", () => {
  it("生成候选：最多 3 个，列出改了哪些参数与可读性影响", () => {
    renderPanel();
    generate();
    const cards = document.querySelectorAll("[data-optimizer-candidate]");
    expect(cards.length).toBe(3);
    // 阶梯是累积的：每个候选都含"页边距 14 → 12"，所以这里用 getAllByText。
    expect(
      screen.getAllByText(ot("optimizer.change.padding", { from: "14", to: "12" })).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(ot("optimizer.candidate.readability.mild")).length).toBeGreaterThan(
      0,
    );
    expect(
      screen.getAllByText(ot("optimizer.candidate.overflow", { value: 160 })).length,
    ).toBeGreaterThan(0);
  });

  it("锁定不动字号：字号候选被排除，测量也不会注入它", () => {
    const { probe, calls } = makeProbe({ "css-padding": 1180, "css-gap": 1100, "css-line": 1040 });
    renderPanel({ probe });
    fireEvent.click(screen.getByRole("checkbox", { name: ot("optimizer.lockFont") }));
    generate();
    expect(calls).not.toContain("css-font");
    expect(document.querySelector('[data-optimizer-candidate="font"]')).toBeNull();
  });

  it("最小页边距把所有候选排除时，明确说被锁定条件排除", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(ot("optimizer.minMargin")), {
      target: { value: "20" },
    });
    generate();
    // 标题与兜底说明都可能是这一句：只要出现即可。
    expect(screen.getAllByText(ot("optimizer.noFeasible.locked")).length).toBeGreaterThan(0);
    expect(document.querySelectorAll("[data-optimizer-candidate]").length).toBe(0);
  });

  it("内容本来就放得下：给空态，不生成候选", () => {
    renderPanel({ before: { usedHeight: 900, pageContentHeight: 1000, pageLimit: 1 } });
    generate();
    expect(screen.getByText(ot("optimizer.empty"))).toBeTruthy();
  });

  it("应用候选：回调拿到候选，成功后提示参数已写回", async () => {
    const { onApply } = renderPanel();
    generate();
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(onApply.mock.calls[0][0]).toMatchObject({
      key: expect.any(String),
      changes: expect.any(Array),
    });
    await waitFor(() => expect(screen.getByText(ot("optimizer.applied.hint"))).toBeTruthy());
  });

  it("应用失败时不标记已应用（不假装成功）", async () => {
    const onApply = vi.fn(async () => {
      throw new Error("conflict");
    });
    renderPanel({ onApply });
    generate();
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.apply.aria", { index: 1 }) }));
    await waitFor(() => expect(onApply).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(ot("optimizer.applied.hint"))).toBeNull();
  });

  it("没有实测高度时按钮禁用（不猜着收）", () => {
    renderPanel({ before: null });
    expect(screen.getByRole("button", { name: ot("optimizer.generate") })).toBeDisabled();
  });
});
