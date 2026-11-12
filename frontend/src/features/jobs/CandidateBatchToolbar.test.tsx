// SPDX-License-Identifier: Apache-2.0
/**
 * 备选岗位批量工具条：分组显隐与勾选框三态。
 *
 * 用户反馈驱动（2026，三轮口径演化，以最新为准）：
 * 1. 进入多选模式**立即显示**批量操作区（选了卡片才冒出来被反馈"操作逻辑混乱"），
 *    未选中时按钮禁用；退出多选后整组消失；
 * 2. 「全选全部」只在多选模式出现（跨页选择是批量操作的一部分）；
 * 3. 批量导入入口已移除（产品决策；单条「导入到岗位」仍在卡片菜单）；
 * 4. 「全选本页」勾选框三态口径是「本页」：checked=本页全选中、
 *    indeterminate=本页部分选中、再点一次=清空本页选择。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CandidateBatchToolbar from "./CandidateBatchToolbar";

afterEach(() => {
  cleanup();
});

type RenderProps = Partial<Parameters<typeof CandidateBatchToolbar>[0]>;

function renderToolbar(overrides: RenderProps = {}) {
  const props = {
    selectedCount: 0,
    pageCount: 5,
    allSelected: false,
    someSelected: false,
    selecting: true,
    batchAction: null as "import" | "delete" | null,
    onToggleAll: vi.fn(),
    onDelete: vi.fn(),
    onClear: vi.fn(),
    onExit: vi.fn(),
    totalCount: 20,
    ...overrides,
  };
  render(<CandidateBatchToolbar {...props} />);
  return props;
}

describe("CandidateBatchToolbar 显隐规则（进入多选即显示批量操作区）", () => {
  it("多选模式未选中：批量操作区出现但禁用（导出 CSV/批量删除/清空选择），退出多选可用", () => {
    renderToolbar({ onExportCsv: vi.fn() });
    expect(screen.getByText("全选本页")).toBeInTheDocument();
    expect(screen.getByText("已选 0 / 20 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "退出多选" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /导出\s*CSV/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "批量删除" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "清空选择" })).toBeDisabled();
  });

  it("多选模式选中条目后：批量删除/清空选择/导出 CSV 全部可用", () => {
    renderToolbar({ selectedCount: 2, someSelected: true, onExportCsv: vi.fn() });
    expect(screen.getByRole("button", { name: "批量删除" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "清空选择" })).toBeEnabled();
    expect(screen.getByRole("button", { name: /导出\s*CSV/ })).toBeEnabled();
  });

  it("批量导入入口不再存在（已按产品决策移除）", () => {
    renderToolbar({ selectedCount: 2, someSelected: true });
    expect(screen.queryByRole("button", { name: "批量导入" })).toBeNull();
  });

  it("非多选模式：整组不渲染（工具栏由抽屉在多选模式才挂载，此处防御性断言）", () => {
    renderToolbar({
      selecting: false,
      selectedCount: 2,
      someSelected: true,
      onExportCsv: vi.fn(),
      onSelectAllPages: vi.fn(),
    });
    expect(screen.queryByRole("button", { name: "退出多选" })).toBeNull();
    expect(screen.queryByRole("button", { name: "批量删除" })).toBeNull();
    expect(screen.queryByRole("button", { name: "清空选择" })).toBeNull();
    expect(screen.queryByRole("button", { name: "全选全部" })).toBeNull();
    expect(screen.queryByRole("button", { name: /导出\s*CSV/ })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "全选本页" })).toBeNull();
  });

  it("多选模式且 totalCount>0：「全选全部」出现", () => {
    renderToolbar({ onSelectAllPages: vi.fn() });
    expect(screen.getByRole("button", { name: "全选全部" })).toBeInTheDocument();
  });

  it("点击退出多选回调 onExit（退出后由抽屉清空选择、工具栏回到普通模式）", () => {
    const props = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
    expect(props.onExit).toHaveBeenCalledTimes(1);
  });
});

describe("CandidateBatchToolbar 全选本页三态（口径=本页）", () => {
  it("本页全部选中：checked 亮起，再点一次=清空本页选择（onToggleAll(false)）", () => {
    const props = renderToolbar({
      selectedCount: 5,
      pageCount: 5,
      allSelected: true,
      someSelected: true,
    });
    const checkbox = screen.getByRole("checkbox", { name: "全选本页" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    fireEvent.click(checkbox);
    expect(props.onToggleAll).toHaveBeenCalledWith(false);
  });

  it("本页部分选中：indeterminate 半选态", () => {
    renderToolbar({ selectedCount: 2, pageCount: 5, someSelected: true });
    const checkbox = screen.getByRole("checkbox", { name: "全选本页" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(true);
  });

  it("本页未选中：未勾选且非半选，点击=全选本页（onToggleAll(true)）", () => {
    const props = renderToolbar();
    const checkbox = screen.getByRole("checkbox", { name: "全选本页" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    expect(checkbox.indeterminate).toBe(false);
    fireEvent.click(checkbox);
    expect(props.onToggleAll).toHaveBeenCalledWith(true);
  });

  it("跨页全选全部后本页自然全选中：勾选框 checked 亮起而非半选", () => {
    // 全部 20 条选中（跨页），本页 5 条全在其中 → checked 应为 true。
    renderToolbar({ selectedCount: 20, pageCount: 5, allSelected: true, someSelected: true });
    const checkbox = screen.getByRole("checkbox", { name: "全选本页" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.indeterminate).toBe(false);
  });
});
