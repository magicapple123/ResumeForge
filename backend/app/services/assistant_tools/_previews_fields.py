# SPDX-License-Identifier: Apache-2.0
"""写工具预览的字段中文标签表：把工具入参 key 映射成预览里展示的字段名。

纯搬迁自 ``previews.py``：标签表与预览函数分开，改字段展示名不必碰预览逻辑
（``previews.py`` 只保留通用助手与各域 preview_* 函数）。"""

_JOB_FIELDS = {
    "title": "岗位名称",
    "company": "公司",
    "location": "地点",
    "salary": "薪资",
    "job_type": "类型",
    "description": "职责",
    "requirements": "任职要求",
    "additional_info": "补充信息",
    "source_url": "投递链接",
    "posted_at": "发布时间",
    "status": "状态",
    "favorite": "收藏",
    "note": "备注",
}
_TRACK_FIELDS = {
    "company": "公司",
    "title": "岗位",
    "status": "状态",
    "stage_note": "阶段说明",
    "applied_at": "投递日期",
    "status_date": "状态日期",
    "next_action": "下一步",
    "next_action_date": "下一步日期",
    "note": "备注",
    "evidence": "依据摘录",
    "job_id": "关联岗位 id",
    "resume_id": "关联简历 id",
}
_PROFILE_FIELDS = {
    "name": "姓名",
    "gender": "性别",
    "birth_year": "出生年份",
    "phone": "电话",
    "email": "邮箱",
    "city": "所在城市",
    "target_city": "期望城市",
    "job_intent": "求职意向",
    "personal_website": "个人网站",
    "github": "GitHub",
    "summary": "个人总结",
}
_MATERIAL_FIELDS = {
    "title": "标题",
    "category": "分类",
    "content": "正文",
    "url": "链接",
    "note": "备注",
}
_CLAIM_FIELDS = {
    "title": "标题",
    "subject": "主体",
    "source_fact": "原始事实",
    "candidate_wording": "简历表述",
    "responsibility_level": "承担程度",
    "boundary": "个人边界",
    "risk_notes": "风险点",
}
_CANDIDATE_FIELDS = {"title": "岗位名称", "company": "公司", "raw_text": "原文", "note": "备注"}
_SKILL_FIELDS = {
    "name": "名称",
    "description": "适用场景",
    "prompt": "提示词",
    "enabled": "启用",
    "files": "知识文件",
}
_TEMPLATE_FIELDS = {
    "name": "版式名称",
    "description": "说明",
    "template": "模板",
    "page_limit": "页数上限",
    "font_scale": "字号系数",
}
_KNOWLEDGE_FIELDS = {
    "title": "标题",
    "category": "分类",
    "tags": "标签",
    "content": "正文",
    "source": "来源",
}
