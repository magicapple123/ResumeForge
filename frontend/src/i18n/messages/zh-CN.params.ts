// SPDX-License-Identifier: Apache-2.0
/**
 * 本批（模板预览口径 · 参数复位 · 写作增强提示 · 精确预览补页）新增的界面文案。
 *
 * 为什么又开一个文件：`zh-CN.ts` 只剩十几行余量（单文件 500 行零豁免），
 * `zh-CN.workbench.ts` 也已 200 行出头。拆法保持不变：扁平点分 key、一个默认导出、
 * `as const`；`zh-CN.ts` 末尾展开合并，`MessageKey` 仍是合并后的字面量联合。
 *
 * 写作口径见 `docs/ui-copy-guide.md`：标题 ≤7 字、正文 ≤30 字、不用感叹号；
 * 按钮写具体动作。
 */
const params = {
  // ── 模板一览（选择简历模板）───────────────────────────────
  /** 缩略图口径：从"用你的简历"改成"内置示例"，必须说清，否则用户会以为自己看的是本人简历。 */
  "gallery.preview.demo": "缩略图用的是内置示例内容，不读取你的简历",
  /** 字号档位的作用范围：只改这一份，不追溯历史简历。 */
  "gallery.fontScale.scope": "字号只改当前这份简历，其它简历不受影响",
  /** 缩略图渲染失败后的重试按钮：失败是逐张的，重试会重新取一遍。 */
  "gallery.preview.retry": "重试",
  /** 档位控件的无障碍名（视觉上它就贴在缩略图旁边，没有可见标题）。 */
  "gallery.fontScale.label": "模板字号",
  /** 大图里的说明：为什么纸张是 1–3 页。 */
  "gallery.zoom.hint": "按你设定的最大篇幅排版，整页缩放到窗口宽度",

  // ── 参数复位（每个参数右侧的 ↺）────────────────────────────
  /** 悬停说明：回到"刚打开这份简历时"的值，而不是模板默认值。 */
  "workbench.param.restoreToOpened": "恢复到打开这份简历时的值",
  /** 无障碍名：按钮上只有一个图标，必须把参数名念出来。 */
  "workbench.param.restoreToOpenedAria": "把{label}恢复到打开时的值",
  /** 复位成功的 Toast。 */
  "workbench.param.restored": "已恢复到打开时的值",
  /** 行距的标签（原先写在控件里，复位按钮的无障碍名也要用它，所以收进语言包一处）。 */
  "workbench.param.line-height": "行距",

  // ── 写作增强的使用提示 ─────────────────────────────────────
  /** 右键菜单里的入口名（它原来是编辑器里的一个页签）。 */
  "writing.menu.entry": "写作增强",
  /** 弹窗标题下的一句说明（有可写选区）：结果是直接写回你选中的那一段。 */
  "writing.modal.hint-apply": "结果会写回你刚才选中的那一段；不满意可以直接关掉，原文一字不动。",
  /** 弹窗标题下的一句说明（右键落在不可编辑的位置）：没有可写目标，只能复制。 */
  "writing.modal.hint-copy":
    "这里没有可写回的输入框，结果只放进剪贴板；点「复制」再自己粘到想放的位置。",
  "writing.hint.title": "三步用法：贴一段原文 → 选一个动作 → 生成后点「回填」",
  "writing.hint.body":
    "原样保留数字与专有名词；结果写回你刚选中的那一段，不会改掉简历里的其它字段。没有可写回的目标时，动作会变成「复制」。",
  "writing.hint.star": "把「负责××」改成有情境、有动作、有结果的句子",
  "writing.hint.phrases": "同一段经历出三个版本：STAR / 简历 / 面试口述",
  "writing.hint.polish": "内容不动，只换语气：大厂 / 简洁干练 / 应届生",
  "writing.hint.translate": "只换语言不改事实，适合投递英文岗位",
  /** 结果块的动作按钮：有可写选区时回填。 */
  "writing.action.apply": "回填",
  "writing.apply.success": "已回填到你选中的位置",
  /** 回填失败：写不进去时不能报成功，否则用户以为正文已经改了。 */
  "writing.apply.failed":
    "没能写回原来的位置：那段文字可能已被改动或超出长度限制，可以改动作重试。",
  /** 没有可写选区时的退路：复制到剪贴板。 */
  "writing.action.copy": "复制",
  "writing.copy.success": "已复制，粘贴到想放的位置即可",
  "writing.copy.failed": "复制失败，请手动选中结果文字复制",

  // ── 简历列表右键的「复制」子菜单 ──────────────────────────
  /** 子菜单标题（右键菜单里的一个折叠项）。 */
  "resumes.copy.menu": "复制",
  "resumes.copy.title": "复制标题",
  "resumes.copy.job": "复制目标岗位",
  "resumes.copy.company": "复制公司名",
  "resumes.copy.note": "复制备注",
  "resumes.copy.row": "复制整行为一行（可直接粘进表格）",
  /** 复制成功：`{field}` 是字段名（标题 / 目标岗位 / 公司名 / 备注 / 整行）。 */
  "resumes.copy.done": "已复制{field}",
  /** 复制失败：说清下一步（手选文字），不谎报成功。 */
  "resumes.copy.failed": "复制失败，请在浏览器里手动选中文字复制",
  /** 提示语里用到的字段名（与菜单文案分开：这里是"复制了什么"，不是"点哪个按钮"）。 */
  "resumes.copy.field.title": "标题",
  "resumes.copy.field.job": "目标岗位",
  "resumes.copy.field.company": "公司名",
  "resumes.copy.field.note": "备注",
  "resumes.copy.field.row": "整行",
  /** 整行摘要里的来源列：AI 生成 / 手动创建（与列表的「来源」列同一口径）。 */
  "resumes.copy.source.ai": "AI 生成",
  "resumes.copy.source.manual": "手动创建",

  // ── 精确预览的提示 ─────────────────────────────────────────
  /** 溢出提示的标题：按当前设置需要几页、上限几页。 */
  "exact.overflow.title": "按当前设置约需 {needed} 页（上限 {limit} 页）。",
  /** 旧后端提示（没有 `X-Resume-Pages-Needed` 响应头时）。 */
  "exact.stale.title": "这版 PDF 可能不是按你设定的字号排的",
  "exact.stale.body":
    "运行中的后端是旧版本（没有返回「按当前设置约需几页」），旧版本会自动缩小字号。完全退出应用后重新启动，精确预览就会严格按滑杆上的值排版。",
  /** 重排中的状态行（与画布上的遮罩同一句）。 */
  "exact.status.busy": "正在按新设置重新排版…",
  "exact.status.pages": "精确预览 · 实际 {pages} 页（上限 {limit} 页）",
  "exact.openNewTab": "在新标签打开",
} as const;

export default params;
