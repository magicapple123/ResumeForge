// SPDX-License-Identifier: Apache-2.0
/**
 * 「从预览点某一栏进来」时把字段带到可视区中央的滚动选项。
 *
 * 三件事：
 * - `block: "center"`：字段落在可视区中央，上下文（上一条、下一条）都看得见；
 * - `scrollMode: "if-needed"`：**已经在可视区就完全不滚**——否则用户点了一个就在眼前的
 *   字段，界面却跳一下，比不滚更让人困惑；
 * - `behavior: "smooth"`：平滑滚动给了"我跳到了哪里"一个可追踪的过渡。
 *
 * 单独成文件而不是挂在 `ResumeEditorModal` 上：组件文件只导出组件，热更新才不会因为
 * 多了一个非组件导出而整棵子树重挂。导出也让测试能钉住这三个取值——jsdom 没有布局，
 * 滚动本身观察不到。
 */
import type { FormInstance } from "antd";

export const EDITOR_FIELD_SCROLL_OPTIONS = {
  behavior: "smooth",
  block: "center",
  scrollMode: "if-needed",
} as const;

/**
 * 把某个字段滚到可视区中央并聚焦，返回一个取消函数。
 *
 * 这是"定位到输入框"的**唯一**实现：两个入口都走它——打开面板时的 `initialTarget`
 * （从预览外部进来），以及制作台里点纸面字段时的 `pickTarget`（面板已经开着）。
 * 抄成两份的话，两处的"滚几次、什么时候聚焦"迟早不一样，而这类差异只在真机上才看得出来。
 *
 * 为什么要 `setTimeout` + 一次 `requestAnimationFrame`：表单刚挂载时行高还没稳定
 * （TextArea 的 autoSize、图片的加载），第一枪可能落在旧位置；下一帧补一次，
 * `scrollMode: "if-needed"` 保证已经对准时它什么也不做。
 */
export function scrollAndFocusEditorField(
  form: FormInstance,
  name: (string | number)[],
): () => void {
  let cancelled = false;
  let rafId = 0;
  const timer = window.setTimeout(() => {
    if (cancelled) return;
    form.scrollToField(name, EDITOR_FIELD_SCROLL_OPTIONS);
    const field = form.getFieldInstance(name) as { focus?: () => void } | undefined;
    field?.focus?.();
    rafId = window.requestAnimationFrame(() => {
      if (cancelled) return;
      form.scrollToField(name, EDITOR_FIELD_SCROLL_OPTIONS);
    });
  });
  return () => {
    cancelled = true;
    window.clearTimeout(timer);
    if (rafId) window.cancelAnimationFrame(rafId);
  };
}
