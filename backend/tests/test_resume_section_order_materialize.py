# SPDX-License-Identifier: Apache-2.0
"""P0-5：板块顺序在**创建时物化**（卡片显示的顺序 == 真实渲染顺序）。

为什么要这一组用例：`format_config.section_order` 有三种形态（键不存在 = 内置默认；
键存在 = 这份简历的顺序；`profile_section_order` 只是"新建时的默认值来源"），混用任意两种
就会出现"卡片显示资料顺序、导出的 PDF 按内置默认排"——而这类问题**不报错**，用户只会说
"导出的和看到的不一样"。

两条写入路径各钉一遍：

1. 空白简历（`POST /resumes/manual`）：缺省时用资料顺序物化；等于内置默认则**不写键**；
   请求体里显式给的那份**永远赢**。
2. 生成落库（`save_record`，SSE 与后台任务共用）：前端通常已经写好快照（`buildSectionOrderConfig`），
   后端只补"缺这个键"的情况，**绝不覆盖**已有快照。
"""

from __future__ import annotations

from app.services.resume.resume_record import save_record
from app.services.resume.resume_sections import DEFAULT_SECTION_ORDER

# 资料页里把「项目经历」拖到最前的那一份（`basic_info` 是页眉，永远在第一）。
PROFILE_KEYS = [
    "basic_info",
    "projects",
    "educations",
    "experiences",
    "skills",
    "campus_experiences",
    "awards",
    "summary",
]

# 资料页把「项目经历」拖到最前 → 翻译过来项目第一，其余照资料里的先后。
# W14：资料页没有科研三栏目 → 补齐时**追加在末尾**（不插进用户已排好的七项中间）。
PROJECTS_FIRST = [
    "projects",
    "education",
    "experience",
    "skills",
    "campus_experience",
    "awards",
    "summary",
    "publications",
    "research_projects",
    "patents",
]


def _set_profile_order(client, keys: list[str]) -> None:
    """通过真实接口改资料顺序（校验器会把 `basic_info` 归位、未知键丢掉）。"""
    response = client.patch("/api/profile", json={"section_order": keys})
    assert response.status_code == 200, response.text


def _create_manual(client, **overrides) -> dict:
    payload = {"content": {"name": "张三"}, **overrides}
    response = client.post("/api/resumes/manual", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_manual_resume_materializes_profile_order(client):
    """资料顺序与内置默认不同 → 新建简历带上那份快照（不再靠 UI 的默认值临时生效）。"""
    _set_profile_order(client, ["basic_info", *PROFILE_KEYS[1:]])

    record = _create_manual(client)

    assert record["format_config"]["section_order"] == PROJECTS_FIRST


def test_manual_resume_materializes_ten_keys_when_profile_is_old_default(client):
    """资料页仍是旧七分区默认顺序 → 物化成 10 键（科研三栏目追加在末尾）。

    W14 之前"等于默认就不写键"；现在资料页无法表达科研板块，翻译结果不等于 10 键默认，
    因此会物化一份显式顺序——旧七项的先后完全不变，科研板块排在最后。
    """
    _set_profile_order(
        client,
        [
            "basic_info",
            "educations",
            "experiences",
            "projects",
            "skills",
            "campus_experiences",
            "awards",
            "summary",
        ],
    )

    record = _create_manual(client)

    assert record["format_config"]["section_order"] == [
        "education",
        "experience",
        "projects",
        "skills",
        "campus_experience",
        "awards",
        "summary",
        "publications",
        "research_projects",
        "patents",
    ]


def test_manual_resume_explicit_format_config_wins(client):
    """请求体显式给了顺序 → 用它，不被资料顺序覆盖。"""
    _set_profile_order(client, ["basic_info", *PROFILE_KEYS[1:]])

    record = _create_manual(client, format_config={"section_order": ["awards", "summary"]})

    # 落库前过 `validated_format_config`：补成完整排列（缺的按默认补在后面）。
    assert record["format_config"]["section_order"] == [
        "awards",
        "summary",
        "education",
        "experience",
        "projects",
        "publications",
        "research_projects",
        "patents",
        "skills",
        "campus_experience",
    ]


# ===== 生成落库（两条链路共用的 save_record）=====


def _save_generated(db_session, format_config):
    return save_record(
        db_session,
        {"name": "李四"},
        [],
        None,
        "",
        "test-model",
        False,
        "balanced",
        format_config=format_config,
    )


def test_generated_resume_gets_the_default_order_when_absent(db_session):
    """生成链路没带顺序（旧前端 / 兜底）→ 补上资料顺序，与卡片显示的一致。"""
    from app.services.profile.profile_service import get_or_create_profile

    profile = get_or_create_profile(db_session)
    profile.section_order = ["basic_info", *PROFILE_KEYS[1:]]
    db_session.commit()

    record = _save_generated(db_session, None)

    assert record.format_config["section_order"] == PROJECTS_FIRST


def test_generated_resume_keeps_the_snapshot_the_frontend_wrote(db_session):
    """前端已经写好快照 → **原样保留**（后端只补缺，不覆盖）。"""
    from app.services.profile.profile_service import get_or_create_profile

    profile = get_or_create_profile(db_session)
    profile.section_order = ["basic_info", *PROFILE_KEYS[1:]]
    db_session.commit()

    record = _save_generated(db_session, {"section_order": ["awards", *DEFAULT_SECTION_ORDER[1:]]})

    assert record.format_config["section_order"][0] == "awards"
