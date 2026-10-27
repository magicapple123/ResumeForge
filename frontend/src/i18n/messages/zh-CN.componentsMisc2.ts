// SPDX-License-Identifier: Apache-2.0
/**
 * 零散界面文案：岗位要求参考面板、页头模型切换下拉、一键脱敏弹窗与内推管理面板。
 *
 * 四个文件同属"没有独立领域命名空间"的收尾批次，因此合并成一个包；按文件分区块，
 * 前缀分别是 `jobReference` / `modelProfile` / `redaction` / `referral`。
 */
const componentsMisc2 = {
  // 岗位要求参考面板（`JobRequirementPanel`）：只展示岗位快照，不参与简历保存。
  "componentsMisc2.jobReference.ariaLabel": "岗位要求参考：{title}",
  "componentsMisc2.jobReference.eyebrow": "岗位要求参考",
  "componentsMisc2.jobReference.location": "地点",
  "componentsMisc2.jobReference.type": "类型",
  "componentsMisc2.jobReference.salary": "薪资",
  "componentsMisc2.jobReference.description": "岗位职责",
  "componentsMisc2.jobReference.emptyDescription": "暂无岗位职责",
  "componentsMisc2.jobReference.requirements": "任职要求",
  "componentsMisc2.jobReference.emptyRequirements": "暂无任职要求",
  "componentsMisc2.jobReference.skills": "技能标签",
  "componentsMisc2.jobReference.emptySkills": "暂无技能标签",
  "componentsMisc2.jobReference.other": "其他信息",
  "componentsMisc2.jobReference.emptyOther": "暂无其他信息",

  // 页头模型切换下拉（`ModelProfileSelect`）：切换与双击测连接的反馈。
  "componentsMisc2.modelProfile.ariaLabel": "当前模型配置",
  "componentsMisc2.modelProfile.placeholder": "选择模型配置",
  "componentsMisc2.modelProfile.switched": "已切换到配置「{name}」",
  "componentsMisc2.modelProfile.switchFailed": "切换模型配置失败",
  "componentsMisc2.modelProfile.testFailed": "「{name}」连接失败：{reason}",
  "componentsMisc2.modelProfile.testOkLatency": "「{name}」连接正常（{latency}ms）",
  "componentsMisc2.modelProfile.testOk": "「{name}」连接正常",
  "componentsMisc2.modelProfile.unknownReason": "未知原因",

  // 一键脱敏弹窗（`RedactionModal`）：遮罩范围在 `REDACTION_FIELDS` 里已有 key。
  "componentsMisc2.redaction.title": "一键脱敏",
  "componentsMisc2.redaction.scope": "遮罩范围",
  "componentsMisc2.redaction.preview": "预览脱敏",
  "componentsMisc2.redaction.download": "下载脱敏版（PDF）",
  "componentsMisc2.redaction.previewFailed": "脱敏预览失败",
  "componentsMisc2.redaction.downloadFailed": "下载脱敏版失败",
  "componentsMisc2.redaction.savedTo": "已同时保存到 {path}",
  "componentsMisc2.redaction.downloadStarted": "脱敏版已开始下载",
  "componentsMisc2.redaction.field.name": "姓名",
  "componentsMisc2.redaction.field.phone": "手机",
  "componentsMisc2.redaction.field.email": "邮箱",
  "componentsMisc2.redaction.field.company": "最近公司",

  // 内推管理面板（`ReferralPanel`）：读写反馈、图片备注上传与分页合计。
  // 内推状态等协议值的显示名不在这里，仍由 `referralForm` / `referralDetail` 提供。
  "componentsMisc2.referral.loadFailed": "读取内推失败",
  "componentsMisc2.referral.imageTypeError": "只能上传 png/jpg/webp/gif/bmp/tiff 图片",
  "componentsMisc2.referral.imageSizeError": "单张图片不能超过 2 MB",
  "componentsMisc2.referral.imageCountLimit": "最多上传 {count} 张备注图片",
  "componentsMisc2.referral.uploadFailed": "上传图片失败",
  "componentsMisc2.referral.created": "已新建内推",
  "componentsMisc2.referral.updated": "已更新内推",
  "componentsMisc2.referral.saveFailed": "保存内推失败",
  "componentsMisc2.referral.deleted": "已删除这条内推",
  "componentsMisc2.referral.deleteFailed": "删除失败",
  "componentsMisc2.referral.batchDeleted": "已删除 {count} 条内推，可在「回收站」里恢复",
  "componentsMisc2.referral.batchDeleteFailed": "批量删除失败，请重试",
  "componentsMisc2.referral.empty": "还没有内推记录，把找人内推的机会记下来吧",
  "componentsMisc2.referral.paginationTotal": "共 {count} 条",
  "componentsMisc2.referral.batchNoun": "条内推",
} as const;

export default componentsMisc2;
