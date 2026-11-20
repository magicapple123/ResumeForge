// SPDX-License-Identifier: Apache-2.0
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import EmptyState, { EmptyWatermark } from "./EmptyState";

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

  it("不传 image 时两种档位都用产品线稿（inline 只是尺寸小一档）", () => {
    // 契约在 2026-11-20 再收一档：inline 的判据从"换一张图"变成"不套 .rf-state 外壳"，
    // 插图全站统一为线稿水印，紧凑位置只把尺寸收到 48px。
    const block = render(<EmptyState description="空" />);
    const blockMark = block.container.querySelector('[data-testid="rf-empty-watermark"]');
    expect(blockMark?.getAttribute("width")).toBe("72");

    const compact = render(<EmptyState inline description="空" />);
    const compactMark = compact.container.querySelector('[data-testid="rf-empty-watermark"]');
    expect(compactMark?.getAttribute("width")).toBe("48");
    // inline 没有 `.rf-state` 外壳，antd 默认插画位是 100px；必须显式收到 48，否则行高反而变高。
    expect(compact.container.querySelector<HTMLElement>(".ant-empty-image")?.style.height).toBe(
      "48px",
    );
  });

  it("传 image 时用自定义插图替换 antd 默认插图", () => {
    const { container } = render(
      <EmptyState image={<EmptyWatermark />} description="没有符合筛选条件的资料" />,
    );
    const watermark = container.querySelector('[data-testid="rf-empty-watermark"]');
    expect(watermark).not.toBeNull();
    // 72px 是验收口径；宽高必须相等，否则线稿会被拉长（实测 antd 容器会把 svg 拉到 125px）。
    expect(watermark?.getAttribute("width")).toBe("72");
    expect(watermark?.getAttribute("height")).toBe("72");
    expect((watermark as HTMLElement).style.opacity).toBe("0.55");
  });
});
