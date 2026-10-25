# SPDX-License-Identifier: Apache-2.0
"""求职助手的数据域覆盖守卫：**每一张表都要有一个明确交代**。

用户的要求是"一定要保证助手知道简历通内所有信息，并且可以操作每一个数据"。
靠人工对着 41 张表逐个回忆是靠不住的——加一张表、加一个功能，没人会记得回来补工具，
而失败方式是**静默的**：助手只是回答"没有这个信息"，用户看不出这是缺陷。

所以这里把"表 → 覆盖它的工具 / 不暴露的理由"写成一张明表：
- 少写一张表 → 测试红（新增模型时必须回来做决定）；
- 写了一个不存在的工具名 → 测试红（工具改名/删除时立刻发现）；
- 写「不暴露」但理由空洞 → 测试红（防止用一句"暂不支持"糊过去）。

"不暴露"本身是允许的，而且有些是**必须**的：密钥（llm_config_record）、照片、
投递任务的执行日志、回收站等。区别在于——**它得是个决定了的事，不是一个漏了的事**。
"""

from __future__ import annotations

from app.database_migrations import application_tables
from app.services.assistant_tools import tool_names

# 表名 → 覆盖它的助手工具名（元组）；或 "不暴露：<理由>"。
#
# 判断标准：
# - 「知道信息」= 至少有一个工具能读到这张表里的内容；
# - 「操作数据」= 至少有工具能改它（只读也算覆盖，但要在理由里说清是只读）。
COVERAGE: dict[str, tuple[str, ...] | str] = {
    # ===== 设置与密钥：刻意不暴露 =====
    "app_setting": "不暴露：全局设置（数据集、界面偏好）。改动会影响整个应用的行为，"
    "应当由用户在设置页显式操作，助手不代为修改。",
    "llm_config_record": "不暴露：模型配置里含 API Key。助手既不读也不写这份配置，"
    "避免密钥进入对话上下文或被间接改动。",
    "profile_photo": "不暴露：照片是二进制图片。助手无法理解图片内容，换照片在「我的资料」里做。",
    # ===== 资料（个人档案与各分区）=====
    "user_profile": ("get_profile", "update_profile"),
    "education": ("get_profile", "update_profile", "add_profile_entry"),
    "experience": ("get_profile", "update_profile", "add_profile_entry"),
    "campus_experience": ("get_profile", "update_profile", "add_profile_entry"),
    "project": ("get_profile", "update_profile", "add_profile_entry"),
    "award": ("get_profile", "update_profile", "add_profile_entry"),
    # ===== 岗位与匹配 =====
    "job": ("list_jobs", "get_job", "create_job", "update_job"),
    "job_match_analysis": ("get_job", "list_jobs", "list_apply_queue", "list_match_analyses"),
    "job_match_batch": ("list_match_analyses",),
    "candidate_job": (
        "list_candidate_jobs",
        "get_candidate_job",
        "create_candidate_job",
        "update_candidate_job",
        "import_candidate_job",
    ),
    # ===== 简历 =====
    "resume_record": ("list_resumes", "get_resume", "update_resume_layout", "update_resume"),
    "resume_template": (
        "create_format_template",
        "update_format_template",
        "list_format_templates",
    ),
    "resume_generate_task": "不暴露：生成任务的实时进度（已收到多少字符、在做什么）。"
    "它是瞬时的过程状态，界面上已经能看到；助手在任务结束后读的是生成好的简历本身。",
    "resume_delivery_record": "不暴露：这是投递/导出那一刻冻结的简历快照，含简历全文与"
    "照片 base64，属敏感证据记录；摘要（投给了谁、时间、指纹）已由"
    "「GET /api/resumes/{id}/deliveries」供页面查询，助手不需要再读一份。",
    # A1（0061）：职业场景是"本窗口引导配置"，不是业务事实；助手代改会悄悄改变后续
    # 生成上下文，必须由用户在场景入口显式操作。
    "career_scenario": "不暴露：职业场景只影响本窗口的引导与「用于本次生成」的可选表达"
    "偏好，属于界面态；助手代为修改会在用户不知情时改变生成上下文。",
    # A3（0062）：补充事实是私有资料（含证照编号等敏感字段），生成链路自行读取并裁剪；
    # 助手没有对应工具，避免私密字段进入对话上下文。
    "profile_fact": "不暴露：补充事实是用户的私有资料（证照编号等字段默认不外发），"
    "生成链路会按白名单自行读取；助手不读不写，避免私密内容进入对话。",
    # 2026-10-25 灵活化（0063）：字段设置是补充事实的界面偏好（隐藏/自定义字段定义），
    # 属于界面态而非业务事实；助手若代改会悄悄改变用户的事实表单与候选映射。
    "profile_fact_field_pref": "不暴露：补充事实的字段设置是界面偏好（哪些字段隐藏、"
    "有哪些自定义字段），不是业务事实；助手代为修改会悄悄改变用户的事实表单与生成映射。",
    "share_package": ("list_share_packages",),
    # ===== 投递 =====
    "apply_queue_item": ("list_apply_queue",),
    "apply_task": ("list_apply_records",),
    "apply_task_item": ("list_apply_records",),
    "web_form_fill_record": (
        "list_web_form_fills",
        "get_web_form_fill",
    ),
    "web_form_profile_entry": "不暴露：这是用户专门为网申表单录的补充资料"
    "（四六级分数、档案所在地、紧急联系人、父母工作单位、身高视力、入党时间…），"
    "**专供网申填表读取**。里面含证件、家庭与健康类敏感值，暴露给助手会让它们随提问进入"
    "对话上下文并发往模型服务商；而且工具化的读写在网申表单那条链路上已经有了，"
    "助手再读一遍没有增量。用户要看/改去「我的资料 → 网申资料」。",
    "web_form_profile_record": "不暴露：这是网申资料中的教育、经历、作品和联系人补充记录，"
    "可能含个人经历及他人联系方式，只在网申填表链路本地使用；助手不读取也不修改，"
    "用户要看/改去「我的资料 → 网申资料」。",
    "web_form_url_history": "不暴露：这是用户打开过的网申网址历史，可能暴露投递目标与账号上下文；"
    "它只服务于网申浏览器的网址选择和删除，助手不读取也不修改。",
    # ===== 进度、统计、内推 =====
    "application_track": (
        "list_application_tracks",
        "get_application_track",
        "create_application_track",
        "update_application_track",
    ),
    # 事件留痕表只读可见于 cohort 指标（/api/analytics 随看板下发聚合结果），
    # 不单独开工具：单条事件对对话没有增量，聚合口径在 track_events.py 一处。
    "application_track_event": "不暴露：状态变化留痕只以聚合指标（cohort）出现在"
    "统计看板里，单条事件对助手没有增量；写入由进度状态变化的既有写点自动完成，"
    "助手不应代写。",
    "referral": ("list_referrals", "create_referral"),
    "reminder": ("list_reminders", "create_reminder", "update_reminder"),
    # ===== 事实台账 =====
    "claim_record": ("list_claims", "get_claim", "create_claim", "update_claim"),
    # ===== 资料箱、知识库、技能、题库 =====
    "material": ("list_materials", "get_material", "create_material", "update_material"),
    # 文件副本库只读元数据；内容/落盘名/指纹不进对话，预览与删除在页面做。
    "user_file": ("list_user_files",),
    "knowledge_entry": (
        "list_knowledge",
        "get_knowledge",
        "create_knowledge",
        "update_knowledge",
    ),
    "skill": ("list_skills", "get_skill", "create_skill", "update_skill"),
    "question_bank_record": ("list_question_banks",),
    # ===== 面试与演练 =====
    "interview_session": ("list_interview_sessions", "get_interview_report"),
    "interview_message": ("get_interview_report",),
    "interview_experience": ("list_interview_experiences", "create_interview_experience"),
    "interview_review_record": ("list_reviews",),
    "drill_session": ("list_drill_sessions", "get_drill_report"),
    "drill_contract": ("get_drill_report",),
    "drill_turn": ("get_drill_report",),
    # ===== 助手自身的会话与技能 =====
    # 历史对话默认不暴露（内容就在上下文里）；放宽模式（用户知情开启）下开放只读回看。
    "chat_conversation": ("list_chat_conversations",),
    "chat_message": ("get_chat_conversation",),
    "assistant_skill": ("read_skill_knowledge",),
    "assistant_skill_file": ("read_skill_knowledge",),
    # ===== W12 来源/事实锁/用量 + W13 版本/变体 + W17 表达资产：刻意不暴露 =====
    "resume_source": "不暴露：W12 来源实体是制作台「核对这条要点来自哪份资料」的关系数据；"
    "助手已能经 claim_record / 简历正文回答内容问题，来源链属于界面核对流程，"
    "且它记录的是资料引用标识而不是可直接复述的内容。",
    "resume_source_revision": "不暴露：来源修订历史只服务于制作台的 stale 判定与逐条采纳；"
    "单条修订对对话没有增量，暴露它反而要求助手解释「第几版」这种界面概念。",
    "resume_block_source": "不暴露：块与来源的关联行是内部关系表，没有独立内容；"
    "助手读简历正文即可，链路查询在制作台完成。",
    "resume_fact_lock": "不暴露：事实锁是服务端 AI 改写前的硬校验记录。"
    "助手既不读也不改它——让锁定值以「可讨论的字段」进入对话上下文，会诱导模型"
    "把用户的锁定事实当成可改写内容；校验必须由服务端执行而不是由模型自觉。",
    "llm_usage_record": "不暴露：R04 用量账本只存 token/耗时/结束原因等数字，"
    "不含提示词与回复；它服务「用量汇总」界面与诊断，单表读取对助手无增量，"
    "且避免诊断口径混入对话。",
    "resume_version": "不暴露：命名版本是不可变的内容与排版快照，属于制作台的版本工作流；"
    "助手经 list_resumes / get_resume 读当前简历即可，历史快照应在版本面板由用户显式"
    "查看或恢复，避免助手在对话里做不可见的历史覆盖。",
    "resume_variant": "不暴露：岗位变体是面向不同岗位的独立表达稿，内容与当前简历并存；"
    "助手处理「这份简历」时以当前记录为准，变体的派生与同步属于版本工作流，"
    "由用户显式操作。",
    "resume_phrase": "不暴露：私有表达资产是用户收藏的句库，正文只在本机、默认私有；"
    "若暴露给助手，这些话术会随用户提问进入模型服务商的上下文（隐私边界）；"
    "检索与插入都在制作台本地完成，不调用模型、不自动外发。",
    "resume_export_preset": "不暴露：W19 导出预设是用户保存的导出选项（格式组合/命名模板/"
    "后处理），属于交付工作流配置；助手不代为导出、改文件名或改后处理开关，"
    "导出是用户显式动作。",
    "resume_export_artifact": "不暴露：W19 原件归档是导出产物的**文件字节**在磁盘上的登记，"
    "内容含完整个人资料；助手既不读也不删（删除是不可恢复动作，必须由用户在归档列表确认）。",
    "resume_glossary_term": "不暴露：W16 术语表是数据集级的个人译法偏好（人名/机构/公司/技能"
    "的固定译法），只服务于翻译路径的术语一致性；助手不应读写它（否则会随对话改变用户的"
    "固定译名），翻译与术语维护都在本地 UI 完成（不调用模型）。",
    "resume_review_annotation": "不暴露：W18 批注来自**外部收件人**的回传文件，属于不可信输入；"
    "它按对象锚点挂在评审往返流程里，助手既不该读（会把外部文本带进模型上下文），"
    "也不该改状态（解决/重开是收件人与分享人的显式动作）；且批注永不进入简历导出产物。",
}


def test_every_application_table_has_a_decision():
    """新增一张表就必须在这里做一个决定：给它工具，或者写明为什么不给。"""
    tables = set(application_tables())
    missing = sorted(tables - set(COVERAGE))
    assert not missing, (
        "这些表既没有对应的助手工具、也没有写明不暴露的理由："
        f"{missing}。新增模型后请到 tests/test_assistant_coverage.py 的 COVERAGE 里做决定。"
    )
    stale = sorted(set(COVERAGE) - tables)
    assert not stale, f"COVERAGE 里有已经不存在于数据库的表：{stale}"


def test_named_tools_actually_exist():
    """写了工具名就得真的有这个工具——改名字时这里立刻红。"""
    known = set(tool_names())
    for table, value in COVERAGE.items():
        if isinstance(value, str):
            continue
        unknown = [name for name in value if name not in known]
        assert not unknown, f"表 {table} 写的工具不存在：{unknown}"


def test_not_exposed_entries_carry_a_real_reason():
    """「不暴露」是允许的，但必须说明为什么——否则它就从"决定"退化成"漏了"。"""
    for table, value in COVERAGE.items():
        if not isinstance(value, str):
            continue
        assert value.startswith("不暴露："), f"表 {table} 的说明不是「不暴露：…」格式"
        reason = value.removeprefix("不暴露：").strip()
        assert len(reason) >= 10, f"表 {table} 的不暴露理由太短，等于没写：{reason!r}"
        assert "暂不" not in reason[:6], f"表 {table} 用了「暂不支持」这类没信息量的说法"


def test_core_user_facing_domains_are_readable():
    """这几个域是用户最常问的，**必须**有工具能读到，不接受"不暴露"。"""
    must_be_readable = (
        "job",
        "resume_record",
        "application_track",
        "candidate_job",
        "claim_record",
        "knowledge_entry",
        "material",
        "skill",
        "interview_session",
        "drill_session",
        "referral",
        "reminder",
    )
    for table in must_be_readable:
        value = COVERAGE[table]
        assert not isinstance(value, str), f"{table} 是核心数据域，必须能被助手读到"


def test_assistant_never_gets_a_delete_tool():
    """助手不提供删除类工具是产品决定（删除只能在页面或回收站里做）。

    这条守卫的意义：将来有人"顺手"加了个 delete_xxx，这里会红。
    """
    forbidden = [name for name in tool_names() if "delete" in name or "remove" in name]
    assert not forbidden, f"助手不应有删除类工具：{forbidden}"


def test_the_learning_path_stays_off_every_assistant_tool():
    """**学到的字段也只能待在网申那条链路上**，不能因为"它现在自动增长了"就漏进助手。

    ``learnable()`` 的产物会被写进 ``web_form_profile_entry``，而那张表的内容会随用户每次
    填表**自动变多**——所以"助手读不到"这条边界不能靠"用户没录"来成立，必须靠结构。
    这里从**工具**那一侧钉住：任何工具都不接受网申**资料**里的字段做参数，也不返回它们。

    边界演化（2026-10-09 放宽模式）：网申**填充记录**（``WebFormFillRecord``，操作日志）
    在用户知情开启放宽模式后开放了只读工具（``requires_relaxed=True``），但网申**资料**
    表（profile_entry / profile_record / url_history）在任何模式下都不允许出现。
    读源码里的表名与工具签名，比调用每个工具更稳：调用要造数据，而这里要证明的是
    "根本不存在这条通路"。
    """
    import inspect

    from app.services.assistant_tools import _registry

    # 放宽模式下合法接触网申**填充记录**的两个工具——它们只能碰这一张表。
    _ALLOWED_WEBFORM_TOOLS = {"list_web_form_fills", "get_web_form_fill"}

    for tool in _registry._TOOLS:
        source = inspect.getsource(tool.handler)
        assert "web_form_profile_entry" not in source, f"{tool.name} 读到了网申资料表"
        assert "web_form_profile_record" not in source, f"{tool.name} 读到了网申资料表"
        assert "web_form_url_history" not in source, f"{tool.name} 读到了网申网址历史"
        if tool.name in _ALLOWED_WEBFORM_TOOLS:
            # 门控必须钉死：没开放宽模式就不下发（双保险，下发处另有断言）。
            assert tool.requires_relaxed, f"{tool.name} 必须标记 requires_relaxed"
            continue
        assert "web_form" not in source, f"{tool.name} 碰了网申资料那条链路"
