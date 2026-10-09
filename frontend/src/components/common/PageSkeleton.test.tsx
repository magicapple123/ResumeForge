/** PageSkeleton：rows / avatar / card 三个变体的渲染结果。 */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PageSkeleton from "./PageSkeleton";

afterEach(() => {
  cleanup();
});

describe("PageSkeleton", () => {
  it("默认：带 16px 内边距的卡片容器，段落 6 行、无头像", () => {
    const { container } = render(<PageSkeleton />);

    const holder = container.firstElementChild as HTMLElement;
    expect(holder.style.padding).toBe("16px");
    expect(container.querySelector(".ant-skeleton")).not.toBeNull();
    expect(container.querySelector(".ant-skeleton-with-avatar")).toBeNull();
    expect(container.querySelectorAll(".ant-skeleton-paragraph > li").length).toBe(6);
  });

  it("rows 与 avatar 变体生效", () => {
    const { container } = render(<PageSkeleton rows={3} avatar />);

    expect(container.querySelector(".ant-skeleton-with-avatar")).not.toBeNull();
    expect(container.querySelectorAll(".ant-skeleton-paragraph > li").length).toBe(3);
  });

  it("card=false：不套内边距容器，Skeleton 直接是根元素", () => {
    const { container } = render(<PageSkeleton card={false} />);

    expect(container.firstElementChild?.classList.contains("ant-skeleton")).toBe(true);
  });
});
