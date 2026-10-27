// SPDX-License-Identifier: Apache-2.0
/**
 * 一次粘贴里识别出多份招聘信息时的确认面板（`MultiJobDraftList`）：
 * 顶部说明、每条草案的标题与摘录、单独编辑入口，以及底部的保存动作。
 */
const jobsUi = {
  /** 顶部说明的标题：识别出几份（`{engine}` 是识别方式，由弹窗传入）。 */
  "jobsUi.alert.title": "识别出 {count} 份招聘信息（{engine}）",
  /** 顶部说明的正文：讲清「确认拆分对不对、取消勾选」与保存后的去处。 */
  "jobsUi.alert.description":
    "确认拆分是否正确，取消勾选不想保存的那些。保存后它们会各自成为岗位广场里的一条岗位。",
  /** 草案既没有岗位名也没有公司名时的标题；`{index}` 是序号，用来区分同批的多条。 */
  "jobsUi.draft.untitled": "未命名岗位 {index}",
  /** 「单独编辑」的 Tooltip。 */
  "jobsUi.card.editHint": "只把这一份填进表单，方便逐字段修改后再保存",
  /** 把某一条单独填进表单的按钮。 */
  "jobsUi.card.editSingle": "单独编辑",
  /** 草案缺少岗位描述时的标记。 */
  "jobsUi.card.missingDescription": "缺少岗位描述",
  /** 识别原文的摘录行（`{excerpt}` 已按长度截断）。 */
  "jobsUi.card.excerpt": "原文：{excerpt}",
  /** 底部主按钮：把勾选的几条保存成岗位。 */
  "jobsUi.action.saveSelected": "保存勾选的 {count} 份为岗位",
  /** 底部次按钮：回到原文继续改。 */
  "jobsUi.action.backToEdit": "返回修改原文",
} as const;

export default jobsUi;
