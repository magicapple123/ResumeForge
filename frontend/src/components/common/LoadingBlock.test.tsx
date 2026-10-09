/** LoadingBlock：独立居中模式与嵌套包裹模式的最小行为。 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import LoadingBlock from "./LoadingBlock";

afterEach(() => {
  cleanup();
});

describe("LoadingBlock", () => {
  it("默认渲染：居中的 Spin，最小高度读 CSS 变量", () => {
    const { container } = render(<LoadingBlock />);

    const holder = container.firstElementChild as HTMLElement;
    expect(holder).not.toBeNull();
    expect(holder.style.display).toBe("flex");
    expect(holder.style.minHeight).toBe("var(--rf-loading-min-h)");
    expect(holder.querySelector(".ant-spin")).not.toBeNull();
  });

  it("minHeight 覆盖默认值，size 透传给 Spin", () => {
    const { container } = render(<LoadingBlock minHeight={240} size="large" />);

    const holder = container.firstElementChild as HTMLElement;
    expect(holder.style.minHeight).toBe("240px");
    expect(holder.querySelector(".ant-spin-lg")).not.toBeNull();
  });

  it("传入 children 时进入嵌套包裹模式：内容仍在、Spin 套在外面、文案可见", () => {
    render(
      <LoadingBlock tip="加载中">
        <div>表格内容</div>
      </LoadingBlock>,
    );

    expect(screen.getByText("表格内容")).toBeInTheDocument();
    // antd 6 嵌套模式的结构：section 外壳 + container 内容区。
    expect(document.querySelector(".ant-spin-section")).not.toBeNull();
    expect(document.querySelector(".ant-spin-container")).not.toBeNull();
    expect(screen.getByText("加载中")).toBeInTheDocument();
  });
});
