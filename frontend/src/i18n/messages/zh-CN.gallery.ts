// SPDX-License-Identifier: Apache-2.0
/**
 * 「简历模板一览」弹窗（`TemplateGalleryModal`）里剩余的界面文案。
 *
 * 只收之前写在组件里的字面量；`gallery.preview.demo` / `gallery.fontScale.label` /
 * `gallery.fontScale.scope` / `gallery.preview.retry` / `gallery.zoom.hint` 这五条
 * 早已在 `zh-CN.params.ts` 里，本包不重复登记（同名 key 合并时会互相覆盖）。
 *
 * 术语：**模板** = 外观骨架；**大图** = 模板整页渲染，与简历页的「简历制作台」不是同一个入口。
 */
const gallery = {
  // ── 弹窗标题与空态 ─────────────────────────────────────────
  "gallery.title": "选择简历模板",
  "gallery.empty.noTemplates": "还没有可选模板",
  /**
   * 工具条上两条说明之间的分隔号：中文用全角分号，英文用半角分号 + 空格。
   * 标点随语言变化，不能留在代码里拼（与 `interviewReview.alert.viewing` 的括号同一个道理）。
   */
  "gallery.toolbar.separator": "；",

  // ── 字号档位（受控：改它 = 改当前这份简历）──────────────────
  "gallery.fontScale.small": "小字号",
  "gallery.fontScale.standard": "标准",
  "gallery.fontScale.large": "大字号",

  // ── 模板卡片：状态标签与兜底说明 ───────────────────────────
  "gallery.badge.custom": "自制",
  "gallery.status.inUse": "使用中",
  "gallery.status.current": "当前使用",
  "gallery.action.use": "用这个模板",
  /** 目录没有下发 description 时的兜底（自制模板通常没有说明）。 */
  "gallery.card.customDescription": "你自制的模板",

  // ── 取数与缩略图失败 ───────────────────────────────────────
  "gallery.catalog.loadFailed": "读取模板清单失败",
  "gallery.preview.failed": "预览渲染失败",
  /** 缩略图 iframe 的无障碍名。 */
  "gallery.preview.iframeTitle": "{name} 预览",

  // ── 大图 ───────────────────────────────────────────────────
  /** 卡片预览区的无障碍名：点它打开大图。 */
  "gallery.zoom.openAria": "查看{name}模板大图",
  /** 大图弹窗标题（已经知道是哪套模板）。 */
  "gallery.zoom.titleWithName": "{name} · 完整预览",
  /** 大图弹窗标题（模板名还没取到）。 */
  "gallery.zoom.title": "完整预览",
  /** 大图 iframe 的无障碍名。 */
  "gallery.zoom.frameTitle": "模板完整预览",
} as const;

export default gallery;
