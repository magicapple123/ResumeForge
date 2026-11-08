// SPDX-License-Identifier: Apache-2.0
/**
 * 投递交付单（T09）：三态徽标、稳定码展示名、各区块字段名与验收动作。
 *
 * 三态与优先级由后端给（waiting_human > has_doubts > ready），前端只做"协议值 → 展示名"，
 * 不重算——所以本包只存文案，不存任何判定规则。
 */
const deliveryReceipt = {
  /** 抽屉里可展开的交付单区块标题。 */
  "deliveryReceipt.title": "投递交付单",
  /** 三态徽标（协议值 state 的展示名）。 */
  "deliveryReceipt.state.waiting_human": "卡在人手上",
  "deliveryReceipt.state.has_doubts": "有疑点",
  "deliveryReceipt.state.ready": "可验收",
  /** 后端新增、前端还没登记的三态值：如实显示原码，不猜。 */
  "deliveryReceipt.stateUnknown": "未识别状态",
  /** state_reasons / human_steps 的稳定码展示名；未登记的码由调用方回退显示原码。 */
  "deliveryReceipt.reason.captcha_required": "要手动过验证码",
  "deliveryReceipt.reason.login_required": "要登录才能继续",
  "deliveryReceipt.reason.reupload_resume": "要重新上传简历",
  "deliveryReceipt.reason.answer_screening_questions": "要回答筛选题",
  "deliveryReceipt.reason.fill_required_field": "有必填字段没填上",
  "deliveryReceipt.reason.confirm_in_browser": "要在浏览器里确认",
  "deliveryReceipt.reason.doubts_present": "事实台账有疑点",
  "deliveryReceipt.reason.snapshot_missing": "没有投递快照",
  "deliveryReceipt.reason.artifact_missing": "导出快照缺产物",
  "deliveryReceipt.reason.page_limit": "页数超过目标页数",
  /** 区块标题。 */
  "deliveryReceipt.section.delivery": "投的是哪一版",
  "deliveryReceipt.section.fill": "填了哪些字段",
  "deliveryReceipt.section.doubts": "事实台账疑点",
  "deliveryReceipt.section.humanSteps": "距提交还差",
  "deliveryReceipt.section.followup": "跟进计划",
  /** 投递快照字段。 */
  "deliveryReceipt.field.job": "投给谁",
  "deliveryReceipt.field.resume": "简历版本",
  "deliveryReceipt.field.pages": "导出页数",
  "deliveryReceipt.field.pagesValue": "{pages} 页（上限 {limit} 页）",
  "deliveryReceipt.field.format": "导出格式",
  "deliveryReceipt.field.createdAt": "投出时间",
  "deliveryReceipt.field.resumeChanged": "投出后简历改过",
  "deliveryReceipt.field.requestParams": "请求参数",
  /** apply 路径的快照本来就没有产物信息：如实说"未记录"，不补造也不判缺件。 */
  "deliveryReceipt.field.notRecorded": "未记录",
  /** 填充记录。 */
  "deliveryReceipt.fill.matched": "匹配到填表记录",
  "deliveryReceipt.fill.unknown": "未匹配到填表记录（可能是一键投递）",
  "deliveryReceipt.fill.count": "填写 {filled}/{total} 个字段",
  "deliveryReceipt.fill.failed": "{count} 个字段失败",
  /** 疑点数与人工步骤。 */
  "deliveryReceipt.doubts.count": "疑点 {count} 条",
  "deliveryReceipt.humanSteps.none": "没有人工步骤",
  /** 跟进计划。 */
  "deliveryReceipt.followup.due": "跟进提醒：{date}",
  "deliveryReceipt.followup.none": "还没有跟进提醒",
  /** 验收。 */
  "deliveryReceipt.ack.action": "确认看过这张交付单",
  "deliveryReceipt.ack.done": "已验收",
  "deliveryReceipt.ack.hint": "验收只是记录你看过，不会改动求职进度里的阶段。",
  "deliveryReceipt.ack.toast": "已记录这张交付单验收",
  "deliveryReceipt.ack.error": "这张交付单没有验收上，请重试一次",
  /** 没有投递快照（历史记录常见）：如实说明，不补造。 */
  "deliveryReceipt.empty.snapshot": "这条记录还没有投递快照，历史记录或未冻结快照的投递会这样。",
  /** 读取失败。 */
  "deliveryReceipt.error.load": "交付单没有读出来，请重试一次",
} as const;

export default deliveryReceipt;
