// SPDX-License-Identifier: Apache-2.0
/**
 * 进度记录的新建 / 编辑表单：字段标签、必填提示、状态与渠道下拉、日期说明。
 *
 * 状态与渠道的取值是**协议值**（英文 code，见 `types/tracker.ts`，与后端逐字对应），
 * 本文件只负责它们的显示名：两张 `Record<…, MessageKey>` 表 + 使用处 `t()`，
 * `types/tracker.ts` 一个字都没改。`offer` 的两种语言写法恰好相同（中文招聘语境里
 * 本来就说 Offer），已在 `guards/equalityExemptions.ts` 里登记为语言无关词。
 */
const trackerForm = {
  "trackerForm.title.create": "添加进度",
  "trackerForm.title.edit": "编辑进度",
  "trackerForm.action.save": "保存进度",
  "trackerForm.field.company": "公司",
  "trackerForm.field.title": "岗位",
  "trackerForm.field.status": "当前状态",
  "trackerForm.field.stageNote": "阶段说明",
  "trackerForm.field.appliedAt": "投递日期",
  "trackerForm.field.statusDate": "状态更新日期",
  "trackerForm.field.nextAction": "下一步",
  "trackerForm.field.nextActionDate": "截止日期",
  "trackerForm.field.channel": "投递渠道",
  "trackerForm.field.job": "关联岗位",
  "trackerForm.field.link": "关联链接",
  "trackerForm.field.resume": "使用的简历",
  "trackerForm.field.note": "备注",
  "trackerForm.required.company": "请填写公司名称",
  "trackerForm.required.title": "请填写岗位名称",
  "trackerForm.placeholder.company": "例如 示例科技",
  "trackerForm.placeholder.title": "例如 后端开发实习生",
  "trackerForm.placeholder.nextAction": "例如 确认面试时间",
  "trackerForm.placeholder.job": "选择要关联的岗位（输入关键词搜索）",
  "trackerForm.placeholder.link": "例如 https://jobs.example.com/apply",
  "trackerForm.placeholder.resume": "选择这次投递使用的简历版本（输入关键词搜索）",
  /** 简历下拉的两组（T6）：内部简历走制作台，外部简历是别处生成的原件。 */
  "trackerForm.resume.group.internal": "内部简历",
  "trackerForm.resume.group.external": "外部简历",
  /** 换岗位后已选值保留、但不再属于「本岗位 + 通用」时的标注。 */
  "trackerForm.resume.notInJob": "（不属于当前岗位）",
  /** 回查 404（简历已删）时接在标题快照后面的标注。 */
  "trackerForm.resume.deleted": "（已删除）",
  "trackerForm.hint.stageNote": "第几轮、什么形式，例如「二面」「HR 面」",
  "trackerForm.hint.appliedAt": "留空表示日期不详——该记录不计入投递趋势与周内分布。",
  "trackerForm.action.fillToday": "填今天",
  "trackerForm.hint.statusDate": "通知上写的那天",
  "trackerForm.hint.nextActionDate": "过期会标红",
  "trackerForm.hint.channel": "选填。这是「从哪投的」，不是记录怎么进系统的；不确定就保留「未知」",
  "trackerForm.hint.job": "选填。关联后可在岗位详情里看到这条进度",
  "trackerForm.hint.link":
    "选填。招聘页 / 网申页 / 面试会议链接；选择关联岗位后，这里还是空的时候会自动带上岗位的投递链接",
  "trackerForm.hint.resume":
    "选填。内部简历会留一份投递快照；外部简历只记关联与文件名（原件即证据，不再另存）。改简历不影响已留记录",
  "trackerForm.status.applied": "已投递",
  "trackerForm.status.screening": "筛选中",
  "trackerForm.status.assessment": "测评/笔试",
  "trackerForm.status.interview": "面试",
  "trackerForm.status.offer": "Offer",
  "trackerForm.status.rejected": "已结束",
  "trackerForm.status.unknown": "待确认",
  "trackerForm.channel.unknown": "未知",
  "trackerForm.channel.referral": "内推",
  "trackerForm.channel.official_website": "官网",
  "trackerForm.channel.job_platform": "招聘平台",
  "trackerForm.channel.headhunter": "猎头/中介",
  "trackerForm.channel.other": "其他",
  "trackerForm.toast.saved": "已保存",
  "trackerForm.toast.added": "已添加",
  "trackerForm.toast.existing": "已打开已有求职进度",
  "trackerForm.error.saveFailed": "保存失败",
  "trackerForm.error.linkInvalid": "请填写完整网址，例如 https://example.com/apply",
  "trackerForm.error.linkProtocol": "只支持 http:// 或 https:// 开头的链接",
  "trackerForm.error.linkTooLong": "链接最长 {max} 个字符",
} as const;

export default trackerForm;
