// SPDX-License-Identifier: Apache-2.0
/**
 * 从资料生成台账草稿的弹窗：标题、说明、占位符、按钮、空态与提示。
 *
 * 分类下拉的显示名走 `claimDraftModal.category.*`（`ClaimDraftModal.tsx` 里的
 * `CATEGORY_LABEL_KEYS` 以协议值为键）；`types/claim.ts` 的中文枚举本身是提交后端的
 * 协议值，一个字都没改。
 */
const claimDraftModal = {
  "claimDraftModal.title": "从资料生成事实台账草稿",
  "claimDraftModal.intro":
    "粘贴一段经历、项目说明或获奖情况。提取出来的条目一律是「待确认」，请逐条核对后再标为已确认。",

  "claimDraftModal.category.education": "教育经历",
  "claimDraftModal.category.internship": "实习/工作",
  "claimDraftModal.category.project": "项目经历",
  "claimDraftModal.category.campus": "校园经历",
  "claimDraftModal.category.skills": "专业技能",
  "claimDraftModal.category.awards": "荣誉奖项",
  "claimDraftModal.category.other": "其他",

  "claimDraftModal.placeholder.subject": "主体（可留空，例如项目名）",
  "claimDraftModal.placeholder.rawText":
    "把资料原文贴在这里，越具体越好；没写到的东西不会被补出来。",
  "claimDraftModal.action.generate": "生成草稿",
  "claimDraftModal.action.saveSelected": "保存勾选的 {count} 条",

  "claimDraftModal.empty.noDrafts": "还没有草稿",
  "claimDraftModal.placeholder.title": "标题",
  "claimDraftModal.placeholder.sourceFact": "原始事实",
  "claimDraftModal.placeholder.candidateWording": "简历表述（未核实的内容请保留【待补】标记）",

  "claimDraftModal.toast.pasteFirst": "请先粘贴要整理的资料",
  "claimDraftModal.toast.noDrafts": "这段资料里没有提取出可核对的主张",
  "claimDraftModal.toast.pickAtLeastOne": "请至少勾选一条",
  "claimDraftModal.toast.saved": "已加入事实台账 {count} 条，状态都是「待确认」",
  "claimDraftModal.error.generateFailed": "生成草稿失败",
  "claimDraftModal.error.saveFailed": "保存失败",
} as const;

export default claimDraftModal;
