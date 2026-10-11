import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EmptyState from "./EmptyState";

describe("EmptyState", () => {
  it("渲染说明文字", () => {
    render(<EmptyState description="还没有填充记录" />);
    expect(screen.getByText("还没有填充记录")).toBeInTheDocument();
  });

  it("提供动作时渲染主动作按钮并回调", () => {
    const onAction = vi.fn();
    render(<EmptyState description="还没有填充记录" actionLabel="去创建" onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "去创建" }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("允许用 children 自定义动作区", () => {
    render(
      <EmptyState description="空">
        <button type="button">自定义入口</button>
      </EmptyState>,
    );
    expect(screen.getByRole("button", { name: "自定义入口" })).toBeInTheDocument();
  });
});
