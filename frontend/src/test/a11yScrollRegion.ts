// SPDX-License-Identifier: Apache-2.0
/**
 * 表格横向滚动区的可访问性断言（C-20 收尾核验用）。
 *
 * antd 只在传了 `scroll.x` 时把表格包进带 `overflow-x: auto` 的 `.ant-table-content`，
 * 却不给这个容器 `tabindex`。可滚动区域里如果又没有任何可聚焦元素，键盘用户既拿不到
 * 焦点也滚不动——命中 axe 的 `scrollable-region-focusable`（WCAG 2.1.1，检查项
 * `focusable-content`，impact serious）。
 *
 * jsdom 不算布局：`scrollWidth` / `clientWidth` 恒为 0、`getBoundingClientRect()` 全零，
 * axe 的 `get_scroll(node, 13)` 因此永远判不出"可滚动"，这条规则在单测里**不会真的命中**。
 * 真正验规则本身的是真实浏览器里的 `tests/smoke/a11y.spec.ts`。单测能做的是把
 * "结构上不允许出现无键盘入口的滚动区"钉住，两种合规做法都接受：
 *
 *   1) 0 行时不传 `scroll.x`——DOM 里干脆没有横向滚动区（JobTable 的修法，也顺带
 *      去掉了空表上那条用不上的滚动条）；
 *   2) 给 `.ant-table-content` 补 `tabIndex=0` + `role="region"` + `aria-label`
 *      （ResumeTable 的修法，保留定宽横滚）。
 */
import { expect } from "vitest";

/**
 * 断言 `root` 里的 `.ant-table-content` 不是"可横滚、却进不去"的容器。
 *
 * @param root 查询根：普通组件传 `render()` 返回的 `container`；
 *             渲染在 portal（Modal / Drawer）里的传 `document`。
 */
export function expectNoUnfocusableScroller(root: ParentNode): void {
  const content = root.querySelector<HTMLElement>(".ant-table-content");
  expect(content, "应渲染 .ant-table-content 滚动容器").not.toBeNull();

  if (!content?.style.overflowX) {
    // 合规做法 1：没有横向滚动区，也就没有"滚不到"的问题。
    expect(content?.getAttribute("tabindex")).toBeNull();
    return;
  }
  // 合规做法 2：有横向滚动区 → 必须能被 Tab 到。
  expect(content, "横向滚动区没有键盘入口").toHaveAttribute("tabindex", "0");
}
