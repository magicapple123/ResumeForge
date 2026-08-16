## 个人资料（唯一事实来源，严禁虚构资料以外的内容）

```json
{{ profile_json }}
```

## 目标岗位

- 公司：{{ job.company }}
- 职位：{{ job.title }}
- 地点：{{ job.location }}{% if job.salary %}
- 薪资：{{ job.salary }}{% endif %}

## 岗位 JD

{{ jd }}

## 定制要求

{{ tone_guide }}

## 输出 JSON 结构

严格按照以下结构输出（数组内对象字段与示例一致）：

```json
{
  "name": "姓名",
  "gender": "性别",
  "birth_year": "出生年份",
  "phone": "手机号",
  "email": "邮箱",
  "city": "所在城市",
  "job_intent": "求职意向（针对目标岗位填写）",
  "summary": "个人总结，2-3 句话，突出与岗位的匹配度",
  "education": [
    {
      "school": "学校", "major": "专业", "degree": "学历", "start_date": "开始时间", "end_date": "结束时间",
      "gpa": "绩点/排名", "courses": ["核心课程"], "achievements": ["在校成果，每条一个字符串"]
    }
  ],
  "experience": [
    {
      "company": "公司", "role": "职位", "start_date": "开始时间", "end_date": "结束时间",
      "description": ["工作内容，每条一个要点，针对 JD 优化措辞"]
    }
  ],
  "projects": [
    {
      "name": "项目名", "role": "担任角色", "start_date": "开始时间", "end_date": "结束时间",
      "tech_stack": ["技术栈"],
      "description": ["项目描述，每条一个要点"],
      "highlights": ["项目亮点/成果，针对 JD 突出量化结果"]
    }
  ],
  "skills": [{"name": "技能名", "level": "熟练/掌握/了解"}],
  "awards": [{"name": "奖项名", "date": "时间", "description": "说明"}]
}
```

现在请生成简历 JSON。
