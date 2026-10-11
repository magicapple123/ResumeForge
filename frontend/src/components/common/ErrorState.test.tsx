import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorState from "./ErrorState";

describe("ErrorState", () => {
  it("错误出现时通过 role=alert 对读屏器可感知", () => {
    render(<ErrorState description="读取填充记录失败" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("读取填充记录失败")).toBeInTheDocument();
  });

  it("提供 onRetry 时渲染重试按钮并回调", () => {
    const onRetry = vi.fn();
    render(<ErrorState description="加载失败" onRetry={onRetry} />);
    fireEvent.click(screen.getByRole("button", { name: "重 试" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("重试中不重复触发", () => {
    const onRetry = vi.fn();
    render(<ErrorState description="加载失败" onRetry={onRetry} retrying />);
    // antd loading 按钮在 DOM 里会多渲染一份同名节点（防点击外壳），不做单一节点假设；
    // 「重试中不可再触发」用点击后零回调来钉，不依赖 disabled 属性挂在哪一份上。
    fireEvent.click(screen.getAllByRole("button", { name: /重\s*试/ })[0]);
    expect(onRetry).not.toHaveBeenCalled();
  });
});
