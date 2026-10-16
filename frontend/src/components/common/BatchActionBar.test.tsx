/** BatchActionBar：计数、操作区透传与退出。 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(cleanup);
import BatchActionBar from "./BatchActionBar";

describe("BatchActionBar", () => {
  it("显示已选计数并透传操作按钮", () => {
    const onExit = vi.fn();
    const onDelete = vi.fn();
    render(
      <BatchActionBar count={3} onExit={onExit}>
        <button type="button" onClick={onDelete}>
          删除所选
        </button>
      </BatchActionBar>,
    );

    expect(screen.getByText("已选 3 项")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "退出多选" }));
    expect(onExit).toHaveBeenCalledTimes(1);
  });
});

describe("全选本页（pageSelectAll）", () => {
  it("传入 pageSelectAll 时渲染全选本页复选框并回传勾选状态", () => {
    const onToggle = vi.fn();
    render(
      <BatchActionBar
        count={1}
        pageSelectAll={{ allSelected: false, someSelected: true, onToggle }}
        onExit={() => {}}
      >
        <button type="button">操作</button>
      </BatchActionBar>,
    );
    expect(screen.getByRole("checkbox", { name: /全选本页/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox", { name: /全选本页/ }));
    expect(onToggle).toHaveBeenCalledWith(true);
  });

  it("不传 pageSelectAll 时不出现全选本页（表格类自带表头全选）", () => {
    render(<BatchActionBar count={0} onExit={() => {}} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("pageSelectAllLabelHidden 时勾选框不带文字、仍可通过 aria-label 命中并回传勾选（简历中心）", () => {
    const onToggle = vi.fn();
    render(
      <BatchActionBar
        count={1}
        pageSelectAll={{ allSelected: false, someSelected: true, onToggle }}
        pageSelectAllLabelHidden
        onExit={() => {}}
      />,
    );
    const checkbox = screen.getByRole("checkbox", { name: /全选本页/ });
    // 文字入口已移除：勾选框的可见文本为空，含义由 hover title 提示。
    expect(checkbox.closest("label")).toHaveTextContent("");
    fireEvent.click(checkbox);
    expect(onToggle).toHaveBeenCalledWith(true);
  });
});
