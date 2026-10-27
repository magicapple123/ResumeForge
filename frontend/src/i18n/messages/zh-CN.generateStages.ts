// SPDX-License-Identifier: Apache-2.0
/**
 * 生成弹窗的三个阶段组件：进行中（阶段条 + 进度行 + 后台提示 + 两个动作）、
 * 失败（错误标题 + 返回重试 / 重新生成）、预览（去简历中心 / 重新生成 / 完成）。
 *
 * 阶段条的标题来自 `appConfig.progressStage.*`（阶段表只存 key）；进度行里的
 * `{message}` 是后端 `progress` 事件原文，属于协议值，只插值不翻译。
 */
const generateStages = {
  // ── 生成进行中 ──────────────────────────────────────────────
  /** 后端还没回填 progress 文案时的兜底。 */
  "generateStages.progress.preparing": "正在准备…",
  /** 进度行：后端 progress 文案 + 已接收字数。 */
  "generateStages.progress.status": "{message} · 已接收 {count} 字",
  /** 说明关掉弹窗不会中断生成。 */
  "generateStages.progress.backgroundAlert":
    "生成已在后台开始：现在关闭弹窗不会中断，完成后会自动提醒并打开结果。",
  /** 关弹窗 = 转后台继续（不是取消）。 */
  "generateStages.action.continueInBackground": "后台继续（关闭弹窗）",
  "generateStages.action.cancel": "取消生成",

  // ── 生成失败 ────────────────────────────────────────────────
  /** 后端没有给错误文本时的标题兜底。 */
  "generateStages.error.title": "生成失败",
  /** 回到配置阶段重新开始。 */
  "generateStages.error.back": "返回重试",
  /** 原地再生成一次；失败态与预览态共用。 */
  "generateStages.action.regenerate": "重新生成",

  // ── 生成预览 ────────────────────────────────────────────────
  /** 预览阶段的主出口：去简历中心继续处理这份简历。 */
  "generateStages.preview.goResumes": "去简历中心",
  /** 预览阶段的收尾按钮。 */
  "generateStages.preview.done": "完成",
} as const;

export default generateStages;
