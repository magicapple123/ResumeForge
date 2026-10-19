/**
 * 快捷键落点（R8）：翻页靠点分页按钮、数据集下拉靠登记。
 *
 * 这两个落点的共同要求是「没有落点时明确返回 false」——调用方据此不拦截按键。
 * 吞掉一个什么都没发生的按键，比按了没反应更糟。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clickPaginationStep,
  registerDatasetMenuHandler,
  triggerDatasetMenu,
} from "./runtimeTargets";

afterEach(() => {
  document.body.innerHTML = "";
  registerDatasetMenuHandler(null);
});

describe("clickPaginationStep", () => {
  it("没有分页时返回 false（不拦截按键）", () => {
    expect(clickPaginationStep("next")).toBe(false);
  });

  it("点下一页按钮并返回 true", () => {
    const onClick = vi.fn();
    document.body.innerHTML = `
      <ul class="ant-pagination">
        <li class="ant-pagination-next"><button type="button">next</button></li>
      </ul>`;
    document.querySelector(".ant-pagination-next button")!.addEventListener("click", onClick);

    expect(clickPaginationStep("next")).toBe(true);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("按钮已禁用时返回 false", () => {
    document.body.innerHTML = `
      <ul class="ant-pagination">
        <li class="ant-pagination-prev ant-pagination-disabled"><button>prev</button></li>
      </ul>`;

    expect(clickPaginationStep("prev")).toBe(false);
  });
});

describe("数据集下拉落点", () => {
  it("没登记时返回 false", () => {
    expect(triggerDatasetMenu()).toBe(false);
  });

  it("登记后触发，注销后不再触发", () => {
    const open = vi.fn();
    registerDatasetMenuHandler(open);
    expect(triggerDatasetMenu()).toBe(true);
    expect(open).toHaveBeenCalledTimes(1);

    registerDatasetMenuHandler(null);
    expect(triggerDatasetMenu()).toBe(false);
  });
});
