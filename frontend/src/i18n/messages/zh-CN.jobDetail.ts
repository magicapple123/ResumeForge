// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位详情抽屉：操作入口、投递台准入提示、字段表与三个折叠区。
 *
 * 录入方式（`recognition_source || "手动"`）是后端返回的协议值，保持中文。
 */
const jobDetail = {
  "jobDetail.title": "岗位详情",
  "jobDetail.action.generate": "用 AI 生成简历",
  "jobDetail.action.write": "自行编写简历",
  "jobDetail.action.viewResume": "查看生成的简历",
  "jobDetail.action.readRequirement": "岗位需求解读",
  "jobDetail.hint.readRequirement": "只读招聘原文，总结岗位要什么",
  "jobDetail.hint.matchRunning": "匹配分析正在后台进行，完成后会弹通知提醒",
  "jobDetail.hint.matchIdle": "读取你的资料与简历，判断你够不够",
  "jobDetail.action.analyzing": "分析中…",
  "jobDetail.action.match": "匹配度分析",
  "jobDetail.hint.unsupported": "这个岗位的来源不在投递台支持的招聘网站内，无法自动投递",
  "jobDetail.hint.applyDesk": "加入投递台队列；命中真实缺口或未分析时会先请你确认",
  "jobDetail.action.applyDesk": "加入投递台",
  "jobDetail.action.askAssistant": "咨询求职助手",
  "jobDetail.section.progress": "该岗位的投递进度",
  "jobDetail.action.interview": "模拟面试",
  "jobDetail.action.goApply": "前往投递",
  "jobDetail.action.favorite": "收藏岗位",
  "jobDetail.action.unfavorite": "取消收藏",
  "jobDetail.unsupported.title": "这个岗位不能用投递台自动投递",
  "jobDetail.unsupported.body":
    "投递台只能自动投递「招聘网站上的岗位」——它的来源或「投递链接」必须指向某个已支持的站点。这个岗位两者都指不到，所以「加入投递台」是灰的。要么把它的「投递链接」改成该岗位在招聘网站上的地址（改完即可自动投递），要么直接在上面「前往投递」或到原渠道自行投递。",
  "jobDetail.field.company": "公司",
  "jobDetail.field.location": "工作地点",
  "jobDetail.field.salary": "薪资范围",
  "jobDetail.field.jobType": "岗位类型",
  "jobDetail.field.status": "状态",
  "jobDetail.field.postedAt": "发布时间",
  "jobDetail.field.source": "来源",
  "jobDetail.section.skills": "岗位技能标签",
  "jobDetail.section.description": "岗位描述",
  "jobDetail.section.requirements": "任职要求",
  "jobDetail.section.extra": "其他招聘信息",
  "jobDetail.section.note": "备注",
  "jobDetail.empty.description": "暂无岗位描述",
  "jobDetail.empty.requirements": "暂无任职要求",
  "jobDetail.empty.extra": "暂无其他招聘信息",
  "jobDetail.empty.note": "暂无备注",
  "jobDetail.section.noteImages": "备注图片",
  "jobDetail.alt.noteImage": "备注图片 {index}",
} as const;

export default jobDetail;
