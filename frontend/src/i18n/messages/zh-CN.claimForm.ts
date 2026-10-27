// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账表单：字段标签、说明、占位符与提示。
 *
 * **协议值不在本文件**：`category` / `responsibility_level` / `verification_status` 的
 * 取值本身就是中文（`项目经历`、`参与`、`待确认`），它们直接提交给后端并参与校验。
 * 翻译它们会写坏数据——要改必须先把那套枚举换成 ASCII code 再在前端做显示名映射，
 * 那是独立一批（与 `customGroupName` 同类的契约改造），不是文案迁移。
 */
const claimForm = {
  "claimForm.title.edit": "编辑台账",
  "claimForm.title.create": "新建台账",
  "claimForm.action.save": "保存台账",
  "claimForm.toast.saved": "已保存这条台账条目",
  "claimForm.toast.created": "已加入事实台账",
  "claimForm.toast.saveFailed": "保存失败",

  "claimForm.field.title": "标题",
  "claimForm.placeholder.title": "便于检索的名字，例如「校园检索平台的检索接口」",
  "claimForm.field.category": "分类",
  "claimForm.field.subject": "主体",
  "claimForm.hint.subject":
    "这条主张关于谁：公司名 / 项目名 / 学校名 / 技能名。生成简历时据此回指到对应经历。",
  "claimForm.placeholder.subject": "例如「校园知识检索平台」",
  "claimForm.field.sourceFact": "原始事实",
  "claimForm.hint.sourceFact": "照实写，不做包装。它是之后核对一切表述的基准。",
  "claimForm.required.sourceFact": "请写清原始事实",
  "claimForm.placeholder.sourceFact": "我实际做了什么、做到了什么程度",
  "claimForm.field.wording": "简历表述",
  "claimForm.hint.wording":
    "准备写进简历的版本。不得比原始事实更强；还没核实的内容请用【待补：缺什么】标记。",
  "claimForm.placeholder.wording": "例如「实现检索接口并联调上线」",
  "claimForm.field.responsibility": "承担程度",
  "claimForm.field.verification": "核实状态",
  "claimForm.field.lastVerified": "最近核实",
  "claimForm.field.boundary": "个人边界",
  "claimForm.hint.boundary":
    "团队做了什么、你做了什么。已确认的条目会进正式简历，这句就是面试时的防线。",
  "claimForm.placeholder.boundary": "例如「接口由本人实现，检索算法由另一位同学负责」",
  "claimForm.field.allowedUses": "可用范围",
  "claimForm.placeholder.allowedUses": "回车添加，例如「AI 岗简历」「HR 开场白」。留空表示不限。",

  "claimForm.evidence.title": "证据来源（只记去哪儿能找到，不要粘贴内容）",
  "claimForm.placeholder.evidence": "链接、文件名或「导师证明可提供」",
  "claimForm.evidence.public": "公开",
  "claimForm.evidence.private": "不公开",
  "claimForm.evidence.removeAria": "删除这条证据",
  "claimForm.evidence.add": "添加证据来源",

  "claimForm.interview.title": "面试细节（能答上追问的部分；强主张尤其要填）",
  "claimForm.field.decisions": "做过的决策",
  "claimForm.field.difficulties": "难点",
  "claimForm.field.howVerified": "怎么验证",
  "claimForm.field.result": "结果",
  "claimForm.placeholder.result": "没有可靠数字时写定性结果，不要编造",
  "claimForm.field.riskNotes": "风险备注",
  "claimForm.hint.riskNotes": "面试里可能被追问什么、哪里还站不住。",
  "claimForm.hint.onePerLine": "每行一条",
  "claimForm.placeholder.riskNotes": "回车添加，例如「指标口径未说明」",
} as const;

export default claimForm;
