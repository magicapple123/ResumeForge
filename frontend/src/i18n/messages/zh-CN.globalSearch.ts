// SPDX-License-Identifier: Apache-2.0
/**
 * 全站搜索（`components/GlobalSearch.tsx`）：页头放大镜、⌘/Ctrl+K 浮层的标题与
 * 无障碍名、输入框提示、初始/加载/空/错误四种状态，以及结果分组的标题。
 *
 * 命中条目里的岗位名、简历名、摘要与数据域名都来自接口，属于数据，不在这里。
 */
const globalSearch = {
  // ── 触发入口与浮层骨架 ──────────────────────────────────────
  /** 浮层顶部标题。 */
  "globalSearch.title": "全站搜索",
  /** 放大镜的 Tooltip：顺带说明唤起快捷键。 */
  "globalSearch.trigger.tooltip": "全站搜索（Ctrl/⌘ + K）",
  /** 放大镜按钮没有可见文字，无障碍名就是它的名字。 */
  "globalSearch.trigger.aria": "全站搜索",
  /** 浮层本体（`role="search"`）的无障碍名。 */
  "globalSearch.panel.aria": "全站搜索",
  /** 浮层右上角的关闭按钮。 */
  "globalSearch.close.aria": "关闭搜索",

  // ── 输入框 ──────────────────────────────────────────────────
  /** 占位符：列出这一处能搜到的数据域。 */
  "globalSearch.input.placeholder": "搜索岗位、简历、内推、提醒、面经、台账、资料…",
  /** 输入框的无障碍名。 */
  "globalSearch.input.aria": "搜索关键词",

  // ── 结果区的四种状态 ────────────────────────────────────────
  /** 还没输入关键词：说明从哪搜、会不会联网。 */
  "globalSearch.idle": "输入关键词开始搜索；结果只来自你自己的本机数据，不会联网。",
  "globalSearch.loading": "搜索中…",
  /** 请求失败且异常没有消息时的兜底。 */
  "globalSearch.error.fallback": "搜索失败",
  /** 有结果但三个分组都是空的。 */
  "globalSearch.empty": "没有匹配的内容",
  /** 简历条目既没有公司也没有目标岗位时的显示名。 */
  "globalSearch.resume.fallback": "通用简历",

  // ── 结果分组标题 ────────────────────────────────────────────
  "globalSearch.group.jobs": "岗位",
  "globalSearch.group.resumes": "简历",
  "globalSearch.group.more": "其它",
} as const;

export default globalSearch;
