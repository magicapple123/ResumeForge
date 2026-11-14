// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位筛选栏：搜索框受控化的两条关键行为 + 多选态隐藏「分析记录」。
 *
 * 修复的缺陷：之前是非受控（defaultValue + 只挂 onSearch），点 × 清空后列表仍按
 * 旧关键词过滤；外部 keyword 变化（URL 带参）也不会回填输入框。这里把这两条钉住。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { JobFilterBar } from "./JobFilterBar";
import { t } from "../../i18n";
import { looseButtonName } from "../../test/profilePageHarness";

/** 工具栏上那颗「分析记录」入口（名字来自词表，逐字之间允许 antd 的两字间距）。 */
function matchHistoryButton(): HTMLElement | null {
  return screen.queryByRole("button", { name: looseButtonName(t("jobsPage.filter.matchHistory")) });
}

/** 与 JobsPage 相同的接线：keyword/setKeyword 是真实 React state。 */
function StatefulHarness({
  onKeywordChange,
  selectionMode,
  extraActions,
}: {
  onKeywordChange?: (value: string) => void;
  selectionMode?: boolean;
  extraActions?: React.ReactNode;
}) {
  const [keyword, setKeyword] = useState("");
  const updateKeyword = (value: string) => {
    setKeyword(value);
    onKeywordChange?.(value);
  };
  return (
    <JobFilterBar
      keyword={keyword}
      setKeyword={updateKeyword}
      setPage={vi.fn()}
      jobType=""
      setJobType={vi.fn()}
      status=""
      setStatus={vi.fn()}
      sourceKind=""
      setSourceKind={vi.fn()}
      batchAction={null}
      openMatchBatch={vi.fn()}
      emptyDescriptionJobIds={[]}
      backfilling={false}
      backfillDetails={vi.fn()}
      setCandidatesOpen={vi.fn()}
      setFormOpen={vi.fn()}
      onImportCsv={vi.fn()}
      selectionMode={selectionMode}
      extraActions={extraActions}
    />
  );
}

function ControlledHarness({ keyword }: { keyword: string }) {
  return (
    <JobFilterBar
      keyword={keyword}
      setKeyword={vi.fn()}
      setPage={vi.fn()}
      jobType=""
      setJobType={vi.fn()}
      status=""
      setStatus={vi.fn()}
      sourceKind=""
      setSourceKind={vi.fn()}
      batchAction={null}
      openMatchBatch={vi.fn()}
      emptyDescriptionJobIds={[]}
      backfilling={false}
      backfillDetails={vi.fn()}
      setCandidatesOpen={vi.fn()}
      setFormOpen={vi.fn()}
      onImportCsv={vi.fn()}
    />
  );
}

/** Input.Search 里的文本输入框。 */
function searchInput(): HTMLInputElement {
  return screen
    .getByPlaceholderText("搜索岗位 / 公司 / 城市 / 描述 / 备注")
    .closest("input") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe("JobFilterBar 搜索框（受控化）", () => {
  it("附加导入入口位于同一工具栏内且先于 CSV", () => {
    render(<StatefulHarness extraActions={<span data-testid="link-import">Link import</span>} />);
    const extra = screen.getByTestId("link-import");
    const csv = screen.getByRole("button", { name: /导入 CSV/ });
    expect(extra.closest(".jobs-filter-bar")).toBe(csv.closest(".jobs-filter-bar"));
    expect(extra.compareDocumentPosition(csv) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  it("点 × 清空后输入框与关键词筛选同步清空", () => {
    const onKeywordChange = vi.fn();
    render(<StatefulHarness onKeywordChange={onKeywordChange} />);
    const input = searchInput();

    // 搜索「算法」：受控镜像先显示输入内容。
    fireEvent.change(input, { target: { value: "算法" } });
    expect(input.value).toBe("算法");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input.value).toBe("算法");
    expect(onKeywordChange).toHaveBeenCalledWith("算法");

    // 点 × 清空：输入框变空的同时筛选也要清掉（镜像在 keyword 仍为旧值时也能回落）。
    fireEvent.change(input, { target: { value: "" } });
    expect(input.value).toBe("");
    expect(onKeywordChange).toHaveBeenCalledWith("");
  });

  it("外部 keyword 变化后输入框回填（URL 带参进页面能显示当前关键词）", () => {
    const { rerender } = render(<ControlledHarness keyword="" />);

    rerender(<ControlledHarness keyword="外部带入的关键词" />);

    expect(searchInput().value).toBe("外部带入的关键词");
  });
});

/**
 * 需求 5：多选态不再给「分析记录」入口（只藏按钮，不删功能）。
 *
 * 为什么两态都要断言：只断言"多选态没有"会被"根本没渲染这颗按钮"的实现蒙过去——
 * 那样非多选态也进不去分析记录，而 `?match_batch=history` 深链是完成通知的落点。
 */
describe("JobFilterBar · 分析记录入口随多选态收放", () => {
  it("非多选态出现「分析记录」", () => {
    render(<StatefulHarness />);
    expect(matchHistoryButton()).not.toBeNull();
  });

  it("多选态不出现「分析记录」，其余入口不动", () => {
    render(<StatefulHarness selectionMode />);
    expect(matchHistoryButton()).toBeNull();
    // 「开始分析」还在：多选态只是不给历史记录入口，不是把这一栏清空。
    expect(
      screen.getByRole("button", { name: looseButtonName(t("jobsPage.filter.analyzeMatch")) }),
    ).toBeInTheDocument();
  });
});

/**
 * F04：10 个控件按「筛选｜AI｜导入｜新增」四簇分组，簇内 6px、簇间 8px + 竖线。
 *
 * jsdom 不排版，所以这里只钉**结构**：簇数、分隔线数、primary 只出现在一处。
 * 间距是否真被拉开、1440 是否仍是一行，由 1440/1080 的截图确认——元素存在证明不了这两点。
 */
describe("JobFilterBar · 四簇分组", () => {
  it("筛选/AI/导入/新增 四簇，簇间三条竖分隔线", () => {
    const { container } = render(
      <StatefulHarness extraActions={<span data-testid="link-import">Link import</span>} />,
    );

    expect(container.querySelectorAll(".jobs-filter-group")).toHaveLength(4);
    expect(container.querySelectorAll(".jobs-filter-divider")).toHaveLength(3);
    // 分组不能把控件搬走：搜索框仍在筛选簇内，导入入口仍在导入簇内。
    expect(container.querySelector(".jobs-filter-group-filters .jobs-search-input")).not.toBeNull();
    expect(screen.getByTestId("link-import").closest(".jobs-filter-group-import")).not.toBeNull();
  });

  it("全栏只有「手动添加」是主按钮（AI 对比选岗降为普通按钮）", () => {
    render(<StatefulHarness />);

    const analyze = screen.getByRole("button", {
      name: looseButtonName(t("jobsPage.filter.analyzeMatch")),
    });
    const addManual = screen.getByRole("button", {
      name: looseButtonName(t("jobsPage.filter.addManual")),
    });

    expect(analyze.className).not.toContain("ant-btn-primary");
    expect(addManual.className).toContain("ant-btn-primary");
  });
});
