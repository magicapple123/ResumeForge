// SPDX-License-Identifier: Apache-2.0
/**
 * 平铺表格的多选口径（2026-11-26，R4 跨页勾选被清空的真 bug）。
 *
 * 根因写在报告里：`rowSelection.onChange` **只回传 dataSource 里存在的 key**
 * （探针：selectedRowKeys=[1,2,3]、本页只有 [1,2]，取消 1 号 → 回传 [2]，3 被丢弃），
 * 而 `ResumeTable` 原来用 `batch.setSelected(keys)` 一把替换。
 *
 * 现在读 `onSelect` / `onSelectAll` 的**增量**，用 `batch.selectPage` 合并。
 * 这个文件只守这一件事：两页数据、真 `useBatchSelection`、真翻页。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useBatchSelection } from "../../hooks/useBatchSelection";
import type { ResumeBrief } from "../../types";
import { DEFAULT_RESUME_SORT_STATE } from "../../utils/resumeSort";
import { useState } from "react";
import ResumeTable from "./ResumeTable";

function resume(id: number): ResumeBrief {
  return {
    id,
    title: `resume ${id}`,
    job_id: id,
    job_title: `job ${id}`,
    company: "acme",
    source: "manual",
    favorite: false,
    note: "",
    model: "",
    enhancement_enabled: false,
    enhancement_level: "balanced",
    template: "classic",
    format_name: "",
    format_config: {},
    page_limit: 1,
    font_scale: "standard",
    created_at: "2026-11-01T08:00:00",
    updated_at: "2026-11-01T08:00:00",
  };
}

/** 第 1 页 = [1, 2]；第 2 页 = [3]。 */
const PAGES: ResumeBrief[][] = [[resume(1), resume(2)], [resume(3)]];

const noop = () => undefined;

function Harness() {
  const batch = useBatchSelection<number>();
  const [page, setPage] = useState(0);
  return (
    <AntdApp>
      <button type="button" onClick={batch.enterSelecting}>
        enter-selecting
      </button>
      <button type="button" onClick={() => setPage((current) => (current + 1) % 2)}>
        flip-page
      </button>
      <output data-testid="count">{batch.selectedCount}</output>
      <output data-testid="ids">{[...batch.selectedIds].sort().join(",")}</output>
      <ResumeTable
        data={{ items: PAGES[page], total: 3 }}
        loading={false}
        batch={batch}
        favoriteResumeId={null}
        page={page + 1}
        setPage={noop}
        pageSize={2}
        setPageSize={noop}
        toggleFavorite={vi.fn()}
        remove={vi.fn()}
        setPreviewId={noop}
        setRenameTarget={noop}
        setRenameValue={noop}
        setNoteTarget={noop}
        setNoteValue={noop}
        setDiffBase={noop}
        setDiffAgainstId={noop}
        setDiffResult={noop}
        sortState={DEFAULT_RESUME_SORT_STATE}
        onSortChange={noop}
        navigate={noop}
        batchActions={[]}
      />
    </AntdApp>
  );
}

function rowCheckbox(container: HTMLElement, id: number): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    `tbody tr[data-row-key="${id}"] .ant-checkbox-input`,
  );
  if (!input) throw new Error(`checkbox not found for row ${id}`);
  return input;
}

const count = () => Number(screen.getByTestId("count").textContent ?? "0");
const ids = () => screen.getByTestId("ids").textContent ?? "";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ResumeTable 跨页勾选（R4）", () => {
  it("第 1 页勾 2 条 + 第 2 页勾 1 条 = 3 条，翻回来仍在", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("enter-selecting"));

    fireEvent.click(rowCheckbox(container, 1));
    await waitFor(() => expect(count()).toBe(1));
    fireEvent.click(rowCheckbox(container, 2));
    await waitFor(() => expect(count()).toBe(2));

    // 翻页：R4 的 bug 就丢在这一步（原来会变成 0 或 1）。
    fireEvent.click(screen.getByText("flip-page"));
    await waitFor(() => expect(rowCheckbox(container, 3)).toBeTruthy());
    expect(count()).toBe(2);

    fireEvent.click(rowCheckbox(container, 3));
    await waitFor(() => expect(count()).toBe(3));
    expect(ids()).toBe("1,2,3");

    // 翻回第 1 页：勾选状态由 selectedIds 反推，不是本地状态。
    fireEvent.click(screen.getByText("flip-page"));
    await waitFor(() => expect(rowCheckbox(container, 1)).toBeTruthy());
    expect(rowCheckbox(container, 1).checked).toBe(true);
    expect(rowCheckbox(container, 2).checked).toBe(true);
  });

  it("全选 N 后取消 1 条 = N-1（不是塌成本页）", async () => {
    const { container } = render(<Harness />);
    fireEvent.click(screen.getByText("enter-selecting"));
    fireEvent.click(rowCheckbox(container, 1));
    fireEvent.click(rowCheckbox(container, 2));
    await waitFor(() => expect(count()).toBe(2));

    // 表头全选都是"本页"语义，先确认它不会把跨页选区清掉。
    fireEvent.click(
      container.querySelector<HTMLElement>("thead .ant-checkbox-input") as HTMLElement,
    );
    await waitFor(() => expect(count()).toBe(0));

    fireEvent.click(
      container.querySelector<HTMLElement>("thead .ant-checkbox-input") as HTMLElement,
    );
    await waitFor(() => expect(ids()).toBe("1,2"));

    // 取消当前页一条：计数只 −1。
    fireEvent.click(rowCheckbox(container, 1));
    await waitFor(() => expect(ids()).toBe("2"));
  });
});
