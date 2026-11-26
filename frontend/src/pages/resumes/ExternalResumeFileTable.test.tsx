// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历「文件行」表格的三个纯前端行为（T09 / R9-1、R9-2、R9-3）。
 *
 * 面板那一层（取数、URL、删除）在 `ExternalResumePanel.test.tsx`；这里只钉表格自己的三件事：
 *
 * 1. **文件名可点**：有文字 → 打开「文本」页，没文字 → 打开「原件」页（文本页对扫描件
 *    必然是一片空白）；
 * 2. **列头三态**：无序 → 升 → 降 → 回默认，方向序列必须与列的默认方向一致（时间列
 *    默认降序，否则第一次点击会被 antd 当成"取消排序"，用户看到的是"点了没反应"）；
 * 3. **分页**：只有超过一页才出现分页器，否则每几份简历就多一行控件。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeItem } from "../../api/externalResumes";
import type { BatchSelection } from "../../hooks/useBatchSelection";
import { t } from "../../i18n";
import ExternalResumeFileTable, {
  DEFAULT_EXTERNAL_SORT_STATE,
  parseExternalSort,
} from "./ExternalResumeFileTable";
import type { ExternalSortState } from "./ExternalResumeFileTable";

function item(overrides: Partial<ExternalResumeItem> = {}): ExternalResumeItem {
  return {
    id: 1,
    file_id: 11,
    name: "external-a.txt",
    mime: "text/plain",
    text_chars: 120,
    has_text: true,
    job_id: null,
    job_title: "",
    created_at: "2026-11-10T10:00:00",
    updated_at: "2026-11-10T10:00:00",
    warnings: [],
    ...overrides,
  };
}

/** 非多选态的 `BatchSelection`：表格只读 `selecting` / `selectedIds` / `setSelected`。 */
function batchStub(selecting = false): BatchSelection<number> {
  return {
    selecting,
    selectedIds: new Set<number>(),
    selectedCount: 0,
    isSelected: () => false,
    toggle: vi.fn(),
    toggleAll: vi.fn(),
    setSelected: vi.fn(),
    selectPage: vi.fn(),
    enterSelecting: vi.fn(),
    exitSelecting: vi.fn(),
  };
}

const noop = () => undefined;

function renderTable(ui: ReactElement) {
  return render(<AntdApp>{ui}</AntdApp>);
}

/** 一份带齐所有稳定回调的表格；每个用例只覆盖自己关心的那几个。 */
function table(overrides: Record<string, unknown> = {}) {
  return (
    <ExternalResumeFileTable
      items={[item()]}
      loading={false}
      batch={batchStub()}
      batchActions={[]}
      navigate={noop}
      sortState={DEFAULT_EXTERNAL_SORT_STATE}
      onSortChange={noop}
      page={1}
      pageSize={20}
      total={1}
      onPageChange={noop}
      onOpenText={noop}
      onOpenOriginal={noop}
      onOpenCheck={noop}
      onUseForInterview={noop}
      onDelete={noop}
      {...overrides}
    />
  );
}

afterEach(cleanup);

describe("parseExternalSort · URL → 排序状态", () => {
  it("合法的一对值原样变成显式排序", () => {
    expect(parseExternalSort("name", "asc")).toEqual({
      field: "name",
      order: "asc",
      explicit: true,
    });
  });

  it("缺一个、或值不在白名单里，一律回落默认（不把脏参数发给后端）", () => {
    expect(parseExternalSort(null, "asc")).toEqual(DEFAULT_EXTERNAL_SORT_STATE);
    expect(parseExternalSort("name", null)).toEqual(DEFAULT_EXTERNAL_SORT_STATE);
    expect(parseExternalSort("drop table", "asc")).toEqual(DEFAULT_EXTERNAL_SORT_STATE);
    expect(parseExternalSort("name", "sideways")).toEqual(DEFAULT_EXTERNAL_SORT_STATE);
  });
});

describe("ExternalResumeFileTable · 文件名可点（R9-2）", () => {
  it("有文字的文件名点开「文本」页", () => {
    const onOpenText = vi.fn();
    const onOpenOriginal = vi.fn();
    renderTable(table({ onOpenText, onOpenOriginal }));

    fireEvent.click(screen.getByRole("button", { name: "external-a.txt" }));

    expect(onOpenText).toHaveBeenCalledTimes(1);
    expect(onOpenOriginal).not.toHaveBeenCalled();
  });

  it("没有文字层的文件名点开「原件」页（文本页对扫描件是空白）", () => {
    const onOpenText = vi.fn();
    const onOpenOriginal = vi.fn();
    renderTable(
      table({
        items: [
          item({ has_text: false, text_chars: 0, name: "scan.pdf", mime: "application/pdf" }),
        ],
        onOpenText,
        onOpenOriginal,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "scan.pdf" }));

    expect(onOpenOriginal).toHaveBeenCalledTimes(1);
    expect(onOpenText).not.toHaveBeenCalled();
  });
});

describe("ExternalResumeFileTable · 列头三态（R9-3）", () => {
  const fileHeader = () =>
    screen.getByRole("columnheader", { name: new RegExp(t("resumesPage.external.column.file")) });

  /** 用受控状态重渲染，模拟面板把新排序写回 URL 再传下来。 */
  function renderWithSort(onSortChange: (next: ExternalSortState) => void) {
    const view = (state: ExternalSortState) => table({ sortState: state, onSortChange });
    const rendered = renderTable(view(DEFAULT_EXTERNAL_SORT_STATE));
    return (state: ExternalSortState) => rendered.rerender(<AntdApp>{view(state)}</AntdApp>);
  }

  it("无序 → 升序 → 降序 → 回默认", () => {
    const onSortChange = vi.fn();
    const setSort = renderWithSort(onSortChange);

    fireEvent.click(fileHeader());
    expect(onSortChange).toHaveBeenLastCalledWith({ field: "name", order: "asc", explicit: true });

    setSort({ field: "name", order: "asc", explicit: true });
    fireEvent.click(fileHeader());
    expect(onSortChange).toHaveBeenLastCalledWith({ field: "name", order: "desc", explicit: true });

    setSort({ field: "name", order: "desc", explicit: true });
    fireEvent.click(fileHeader());
    // 第三次取消排序：回落默认（后端缺省就是 `created_at desc`），URL 里不再带参数。
    expect(onSortChange).toHaveBeenLastCalledWith(DEFAULT_EXTERNAL_SORT_STATE);
  });

  it("时间列默认降序，所以第一次点击是降序而不是「取消」", () => {
    const onSortChange = vi.fn();
    renderTable(table({ onSortChange }));

    fireEvent.click(
      screen.getByRole("columnheader", {
        name: new RegExp(t("resumesPage.external.column.created")),
      }),
    );

    expect(onSortChange).toHaveBeenLastCalledWith({
      field: "created_at",
      order: "desc",
      explicit: true,
    });
  });
});

describe("ExternalResumeFileTable · 分页（R9）", () => {
  it("一页装得下就不出现分页器", () => {
    const { container } = renderTable(table({ total: 20 }));
    expect(container.querySelector(".ant-pagination")).toBeNull();
  });

  it("超过一页才出现，翻页把页码回传给面板", () => {
    const onPageChange = vi.fn();
    const { container } = renderTable(table({ total: 120, onPageChange }));

    expect(container.querySelector(".ant-pagination")).not.toBeNull();
    fireEvent.click(screen.getByTitle("2"));

    // antd 的 `onChange` 带两个参数（页码 + 每页条数），面板只关心第一个。
    expect(onPageChange.mock.calls[0][0]).toBe(2);
  });
});
