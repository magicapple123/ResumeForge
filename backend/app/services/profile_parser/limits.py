"""解析结果的长度和数量边界。"""

_PARSED_BASIC_FIELD_LIMITS = {
    "name": 64,
    "gender": 64,
    "birth_year": 32,
    "phone": 32,
    "email": 128,
    "city": 64,
    "target_city": 64,
    "job_intent": 128,
    "personal_website": 256,
    "github": 256,
}
# ⚠️ **这张表是白名单**：``_bound_parse_result`` 只按这里的键构造结果，**没有列进去的字段会被
# 静默丢弃**——粘贴识别看起来"没认出来"，而没有任何报错。所以往 ``EducationIn`` 加字段时，
# 要同时做三件事，缺一不可：
#   1. 在 ``EducationIn`` 加字段（否则保存时 422）；
#   2. 在**这张表**加一行（否则识别结果在收窄时被静默丢弃）；
#   3. 在 ``prompts/profile_text_extract.md`` 的输出形状里加上（否则模型根本不会输出这个键）。
# ``tests/test_profile_text_parser.py`` 钉住了 1↔2 这两边。
#
# 历史教训：``department`` / ``study_mode`` / ``degree_type`` / ``cet4_score`` / ``cet6_score``
# 都曾只做了第 1 步——字段在界面与 schema 里，粘贴识别却一直认不出来，而且**不报错**。
_PARSED_ENTRY_FIELD_LIMITS = {
    "educations": {
        "reference_file_name": 255,
        "reference_content": 200_000,
        "school": 128,
        "major": 128,
        "degree": 32,
        # 院系 / 全日制 / 学位类型：网申表单把"学历"拆成三个独立下拉，粘贴识别要能认出来。
        "department": 128,
        "study_mode": 32,
        "degree_type": 32,
        "start_date": 32,
        "end_date": 32,
        "gpa": 64,
        # 四六级分数：网申表单普遍问具体分数，所以粘贴识别要能认出来。
        "cet4_score": 16,
        "cet6_score": 16,
        "courses": 200_000,
        "achievements": 200_000,
    },
    "experiences": {
        "reference_file_name": 255,
        "reference_content": 200_000,
        "company": 128,
        "role": 128,
        "start_date": 32,
        "end_date": 32,
        "description": 200_000,
    },
    "campus_experiences": {
        "reference_file_name": 255,
        "reference_content": 200_000,
        "organization": 128,
        "role": 128,
        "start_date": 32,
        "end_date": 32,
        "description": 200_000,
    },
    "projects": {
        "reference_file_name": 255,
        "reference_content": 200_000,
        "name": 128,
        "role": 64,
        "start_date": 32,
        "end_date": 32,
        "tech_stack": 10_000,
        "description": 200_000,
        "highlights": 200_000,
    },
    "skills": {"name": 64, "level": 32},
    "awards": {"name": 128, "date": 32, "description": 2_000},
}
_MAX_PARSED_SECTION_ITEMS = 200
