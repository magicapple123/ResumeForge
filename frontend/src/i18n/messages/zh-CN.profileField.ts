// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的资料」里**系统自带字段**的展示名。
 *
 * 为什么需要这一层：字段名是后端 `definition_catalog` 里的中文（随 `/api/profile/workspace`
 * 下发 `label`），协议值是稳定的 `field_id`（`<分区>.<键>`，如 `educations.school`）。
 * 前端按 `field_id` 映射到语言包；用户自建字段的 `field_id` 以 `custom:` 开头、名字是
 * 用户输入，**不查这张表**。
 *
 * 中文与后端原文逐字一致（替换后中文渲染结果不变）。新增内置字段时这里补一条，映射不到
 * 时调用方回退后端原文，不丢信息。
 */
const profileField = {
  "profileField.basic_info.name": "姓名",
  "profileField.basic_info.gender": "性别",
  "profileField.basic_info.birth_month": "出生年月",
  "profileField.basic_info.phone": "手机",
  "profileField.basic_info.email": "邮箱",
  "profileField.basic_info.city": "城市",
  "profileField.basic_info.target_city": "意向城市",
  "profileField.basic_info.job_intention": "求职意向",
  "profileField.basic_info.homepage": "个人主页",
  "profileField.basic_info.github": "GitHub",
  "profileField.basic_info.photo": "照片",
  "profileField.basic_info.portfolio_url": "作品集链接",
  "profileField.basic_info.political_status": "政治面貌",
  "profileField.basic_info.driver_license": "驾照",
  "profileField.basic_info.available_date": "到岗时间",

  "profileField.educations.school": "学校",
  "profileField.educations.major": "专业",
  "profileField.educations.degree": "学历",
  "profileField.educations.study_form": "学习形式",
  "profileField.educations.degree_type": "学位类型",
  "profileField.educations.department": "院系",
  "profileField.educations.start_date": "开始时间",
  "profileField.educations.end_date": "结束时间",
  "profileField.educations.gpa": "绩点",
  "profileField.educations.rank": "成绩排名",
  "profileField.educations.advisor": "导师",
  "profileField.educations.research_direction": "研究方向",
  "profileField.educations.core_courses": "主修课程",
  "profileField.educations.achievements": "在校成果",

  "profileField.experiences.company": "公司/机构",
  "profileField.experiences.title": "职位/角色",
  "profileField.experiences.start_date": "开始时间",
  "profileField.experiences.end_date": "结束时间",
  "profileField.experiences.description": "工作内容",
  "profileField.experiences.team_size": "团队规模",
  "profileField.experiences.work_type": "工作类型",

  "profileField.projects.name": "项目名称",
  "profileField.projects.role": "角色",
  "profileField.projects.start_date": "开始时间",
  "profileField.projects.end_date": "结束时间",
  "profileField.projects.tech_stack": "技术栈",
  "profileField.projects.description": "项目描述",
  "profileField.projects.highlights": "亮点",
  "profileField.projects.project_size": "项目规模",
  "profileField.projects.public_url": "公开链接",
  "profileField.projects.outcome_type": "成果类型",

  "profileField.skills.name": "技能名称",
  "profileField.skills.level": "熟练度",
  "profileField.skills.category": "技能分类",

  "profileField.campus_experiences.organization": "组织",
  "profileField.campus_experiences.role": "角色",
  "profileField.campus_experiences.start_date": "开始时间",
  "profileField.campus_experiences.end_date": "结束时间",
  "profileField.campus_experiences.description": "经历描述",
  "profileField.campus_experiences.activity_type": "活动类型",

  "profileField.awards.title": "奖项名称",
  "profileField.awards.awarded_at": "获奖时间",
  "profileField.awards.description": "奖项说明",
  "profileField.awards.issuer": "颁发机构",
  "profileField.awards.level": "奖项级别",
  "profileField.awards.award_ratio": "获奖比例",

  "profileField.summary.content": "正文",

  "profileField.publications.title": "标题",
  "profileField.publications.outcome_type": "成果类型",
  "profileField.publications.authorship_rank": "我的署名位次",
  "profileField.publications.authors": "作者",
  "profileField.publications.venue": "期刊/会议",
  "profileField.publications.year": "年份",
  "profileField.publications.status": "状态",
  "profileField.publications.url": "链接",
  "profileField.publications.note": "备注",
  "profileField.publications.doi": "DOI",
  "profileField.publications.volume_pages": "卷期页码",

  "profileField.research_projects.name": "项目名称",
  "profileField.research_projects.role": "担任角色",
  "profileField.research_projects.institution": "所属机构",
  "profileField.research_projects.level": "项目级别",
  "profileField.research_projects.start_date": "开始时间",
  "profileField.research_projects.end_date": "结束时间",
  "profileField.research_projects.description": "项目描述",
  "profileField.research_projects.outcomes": "项目成果",
  "profileField.research_projects.funding": "经费",

  "profileField.patents.title": "名称",
  "profileField.patents.outcome_type": "成果类型",
  "profileField.patents.inventors": "发明人",
  "profileField.patents.inventor_rank": "发明人位次",
  "profileField.patents.patent_number": "专利号",
  "profileField.patents.status": "状态",
  "profileField.patents.application_date": "申请日期",
  "profileField.patents.grant_date": "授权日期",
  "profileField.patents.url": "链接",
  "profileField.patents.country": "国家/地区",

  "profileField.credentials.title": "证书名称",
  "profileField.credentials.credential_type": "证书类型",
  "profileField.credentials.issuer": "颁发机构",
  "profileField.credentials.issued_at": "签发日期",
  "profileField.credentials.expires_at": "到期日期",
  "profileField.credentials.status": "状态",
  "profileField.credentials.note": "备注",
  "profileField.credentials.credential_number": "证书编号",
  "profileField.credentials.verify_url": "核验链接",

  "profileField.languages.language": "语言",
  "profileField.languages.level": "水平/等级",
  "profileField.languages.certificate": "证书",
  "profileField.languages.score": "分数",
  "profileField.languages.obtained_at": "取得时间",
} as const;

export default profileField;
