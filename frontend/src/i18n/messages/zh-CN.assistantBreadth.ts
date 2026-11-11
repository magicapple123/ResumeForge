// SPDX-License-Identifier: Apache-2.0
/**
 * 助手拓宽（#18A/#18B/#18C）：任务条、今日简报卡、视角切换器的界面文案。
 *
 * 只放界面文案；任务标题 / 简报条目内容来自后端数据（不翻译）。视角的显示名也在这里，
 * 后端只下发协议值 id——同一句文案不在前后端各维护一份。
 */
const assistantBreadth = {
  "assistantBreadth.tasks.title": "助手任务",
  "assistantBreadth.tasks.hint":
    "助手把跨轮的批量活放在这里跑；进度按步骤保存，应用重启后仍能查到，可暂停或取消。",
  "assistantBreadth.tasks.show": "展开任务",
  "assistantBreadth.tasks.hide": "收起任务",
  "assistantBreadth.tasks.pause": "暂停",
  "assistantBreadth.tasks.aria": "助手创建的任务",

  "assistantBreadth.digest.title": "今日简报",
  "assistantBreadth.digest.refresh": "重新生成",
  "assistantBreadth.digest.refreshing": "正在生成…",
  "assistantBreadth.digest.generatedAt": "更新于 {time}",
  "assistantBreadth.digest.error": "简报生成失败，请稍后重试",
  "assistantBreadth.digest.empty": "今天没有需要你处理的事。",
  "assistantBreadth.digest.changes": "异动 {count} 条",
  "assistantBreadth.digest.changesDetail": "JD 变更 {jdChanged} 条、无回音 {stale} 条",
  "assistantBreadth.digest.more": "还有 {count} 条",
  "assistantBreadth.digest.section.worth_jobs": "值得投的新岗位",
  "assistantBreadth.digest.section.stale_applications": "7 天无回音",
  "assistantBreadth.digest.section.interviews": "面试倒计时",
  "assistantBreadth.digest.section.expired_jobs": "已过期 / 已下架",
  "assistantBreadth.digest.section.funnel": "本周投递漏斗",
  "assistantBreadth.digest.score": "参考分 {score}",
  "assistantBreadth.digest.scoreHint":
    "参考分由本地规则估算，仅供排序参考，不代表投递成功率；是否可投以匹配结论为准。",
  "assistantBreadth.digest.staleDays": "{days} 天未回音",
  "assistantBreadth.digest.daysUntil": "{days} 天后",
  "assistantBreadth.digest.today": "今天",
  "assistantBreadth.digest.interviewToday": "今天有 {count} 场面试",
  "assistantBreadth.digest.funnel.applied": "投递 {count}",
  "assistantBreadth.digest.funnel.succeeded": "成功 {count}",
  "assistantBreadth.digest.funnel.failed": "失败 {count}",
  "assistantBreadth.digest.funnel.interviewing": "面试中 {count}",
  "assistantBreadth.digest.hint":
    "简报只读现有数据（匹配分析、投递记录、求职进度、岗位状态），不会额外抓取招聘页。",

  "assistantBreadth.persona.label": "视角",
  "assistantBreadth.persona.default": "通用",
  "assistantBreadth.persona.hr_scan": "HR 六秒扫描",
  "assistantBreadth.persona.interviewer": "面试官追问",
  "assistantBreadth.persona.headhunter": "猎头判断",
  "assistantBreadth.persona.hint": "视角只改变助手的看问题方式与输出结构，工具与权限不变。",
  "assistantBreadth.persona.switched": "已切换视角：{name}",
  "assistantBreadth.persona.error": "切换视角失败，请稍后重试",
  "assistantBreadth.persona.needsConversation": "发送第一条消息后才能切换视角",
  "assistantBreadth.persona.aria": "助手视角",
} as const;

export default assistantBreadth;
