/**
 * 岗位筛选栏：搜索框受控化的两条关键行为。
 *
 * 修复的缺陷：之前是非受控（defaultValue + 只挂 onSearch），点 × 清空后列表仍按
 * 旧关键词过滤；外部 keyword 变化（URL 带参）也不会回填输入框。这里把这两条钉住。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { JobFilterBar } from "./JobFilterBar";

/** 与 JobsPage 相同的接线：keyword/setKeyword 是真实 React state。 */
function StatefulHarness({ onKeywordChange }: { onKeywordChange?: (value: string) => void }) {
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
      selectionMode={false}
      exitSelectionMode={vi.fn()}
      openMatchBatch={vi.fn()}
      emptyDescriptionJobIds={[]}
      backfilling={false}
      backfillDetails={vi.fn()}
      setCandidatesOpen={vi.fn()}
      setFormOpen={vi.fn()}
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
      selectionMode={false}
      exitSelectionMode={vi.fn()}
      openMatchBatch={vi.fn()}
      emptyDescriptionJobIds={[]}
      backfilling={false}
      backfillDetails={vi.fn()}
      setCandidatesOpen={vi.fn()}
      setFormOpen={vi.fn()}
    />
  );
}

/** Input.Search 里的文本输入框。 */
function searchInput(): HTMLInputElement {
  return screen
    .getByPlaceholderText("搜索职位 / 公司 / 城市 / 描述 / 备注")
    .closest("input") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
});

describe("JobFilterBar 搜索框（受控化）", () => {
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
