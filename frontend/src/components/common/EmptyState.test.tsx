// SPDX-License-Identifier: Apache-2.0
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

  it("inline 时不套 .rf-state 外壳（紧凑容器里不撑高行），仍渲染 antd Empty", () => {
    const { container } = render(<EmptyState description="表里没有数据" inline />);

    expect(container.querySelector(".rf-state")).toBeNull();
    expect(container.querySelector(".ant-empty")).not.toBeNull();
    expect(screen.getByText("表里没有数据")).toBeInTheDocument();
  });

  it("没有任何动作时不渲染空的 .rf-state-actions 容器", () => {
    const { container } = render(<EmptyState description="空" />);
    expect(container.querySelector(".rf-state-actions")).toBeNull();
  });
});
