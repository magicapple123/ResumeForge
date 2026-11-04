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
    // 布局契约：约束区是两列网格容器，生成按钮带自己的类（min-width / 与控件列对齐
    // 都由 optimizer.css 的这条类名收敛，删掉类名 CSS 就静默失效）。
    expect(document.querySelector(".resume-optimizer-constraints")).not.toBeNull();
    expect(screen.getByRole("button", { name: ot("optimizer.regenerate") })).toHaveClass(
      "resume-optimizer-generate",
    );
  });

  it("锁定不动字号：字号候选被排除，测量也不会注入它", () => {
    const { probe, calls } = makeProbe({ "css-padding": 1180, "css-gap": 1100, "css-line": 1040 });
    renderPanel({ probe });
    fireEvent.click(screen.getByRole("checkbox", { name: ot("optimizer.lockFont") }));
    generate();
    expect(calls).not.toContain("css-font");
    expect(document.querySelector('[data-optimizer-candidate="font"]')).toBeNull();
  });

  it("最小页边距只排掉压页边距那一档，行高/字号候选仍然给出（问题 17）", () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText(ot("optimizer.minMargin")), {
      target: { value: "20" },
    });
    generate();
    // 阶梯是累积覆盖：不该因为第一档越线就把后面所有档一起排掉。
    expect(screen.queryAllByText(ot("optimizer.noFeasible.locked")).length).toBe(0);
    expect(document.querySelectorAll("[data-optimizer-candidate]").length).toBeGreaterThan(0);
    expect(document.querySelector('[data-optimizer-candidate="padding"]')).toBeNull();
  });

  it("目标 2 页：收到能装 2 页就停，不再试更紧的字号档（问题 17）", () => {
    // 2 页可用高度 2000：padding 档 2080 仍溢出，line 档 1980 已装得下 → 后面不再探。
    const { probe, calls } = makeProbe({
      "css-padding": 2080,
      "css-gap": 2050,
      "css-line": 1980,
      "css-font": 1500,
    });
    renderPanel({ before: { usedHeight: 2100, pageContentHeight: 1000, pageLimit: 1 }, probe });
    fireEvent.click(screen.getByText(ot("optimizer.target.pages", { count: 2 })));
    generate();
    expect(calls).not.toContain("css-font");
    expect(document.querySelectorAll("[data-optimizer-candidate]").length).toBe(2);
  });

  it("目标篇幅默认跟随简历的 page_limit（2 页不再按 1 页判溢出）", () => {
    // 1500 高：1 页放不下、2 页放得下。目标若还默认 1 页，这里会给出候选而不是空态。
    renderPanel({
      pageLimit: 2,
      before: { usedHeight: 1500, pageContentHeight: 1000, pageLimit: 2 },
    });
    generate();
    expect(screen.getByText(ot("optimizer.empty"))).toBeTruthy();
    expect(document.querySelectorAll("[data-optimizer-candidate]").length).toBe(0);
  });

  it("不限篇幅（page_limit=0）：没有收敛目标，不试任何版式档", () => {
    const { probe, calls } = makeProbe({ "css-padding": 1180, "css-gap": 1100 });
    renderPanel({ pageLimit: 0, probe });
    generate();
    expect(calls).toHaveLength(0);
    expect(document.querySelectorAll("[data-optimizer-candidate]").length).toBe(0);
  });

  it("试过仍放不下：提示写明目标几页、实际几页（不再只说超出）", () => {
    const { probe } = makeProbe({
      "css-padding": 2400,
      "css-gap": 2350,
      "css-line": 2300,
      "css-font": 2250,
    });
    renderPanel({
      pageLimit: 2,
      before: { usedHeight: 2500, pageContentHeight: 1000, pageLimit: 2 },
      probe,
    });
    generate();
    expect(
      screen.getAllByText(ot("optimizer.noFeasible.stillOverflowNumbered", { target: 2, pages: 3 }))
        .length,
    ).toBeGreaterThan(0);
  });

  it("最小页边距变化会通知宿主重算阶梯（边距是下界，不是本地丢档）", () => {
    const onMinMarginChange = vi.fn();
    renderPanel({ onMinMarginChange });
    fireEvent.change(screen.getByLabelText(ot("optimizer.minMargin")), {
      target: { value: "20" },
    });
    expect(onMinMarginChange).toHaveBeenCalledWith(20);
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
