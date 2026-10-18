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
export const EDITOR_FIELD_SCROLL_OPTIONS = {
  behavior: "smooth",
  block: "center",
  scrollMode: "if-needed",
} as const;
