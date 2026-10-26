# SPDX-License-Identifier: Apache-2.0
"""演示数据集脚本：守两件事——它能跑通，以及它造出来的数据确实全是虚构的。

为什么值得一个测试：
- README 与文档里的截图来自这份数据，而截图里的东西会被所有人看到。一旦有人图省事把自己的
  真实姓名/手机号/公司填进脚本（或从真实库里导了一份进来），泄露就发生在**公开的仓库首页**上，
  而且不会有任何别的检查发现它；
- 这个脚本同时是"演示数据是否符合当前 schema"的自检入口。它第一次跑就抓出过 5 个接口 500
  （`job.keywords` 写成字符串数组、`claim_record.interview_details` 写成列表、
  `chat_message.status` 用了不存在的枚举值），而这类错误在真实用户那里表现为"某个页面打不开"。

脚本在导入时就会写库（它是一次性工具，不是库），所以这里**用子进程调用**，绝不 import。
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
SCRIPT = REPO_ROOT / "scripts" / "seed_demo_data.py"

# 虚构数据的标记：脚本里每一条人名、公司、学校都必须带上它。示例：
# 「张示例」「示例科技有限公司」「示例大学」。
FICTIONAL_MARKER = "示例"


@pytest.fixture(scope="module")
def demo_db(tmp_path_factory: pytest.TempPathFactory) -> Path:
    """跑一次脚本（带自检），返回生成的演示库路径。"""
    target = tmp_path_factory.mktemp("demo") / "demo.db"
    env = dict(os.environ, PYTHONUTF8="1")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--out", str(target), "--check"],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )
    assert result.returncode == 0, (
        f"演示数据脚本失败（退出码 {result.returncode}）\n"
        f"stdout:\n{result.stdout[-4000:]}\n"
        f"stderr:\n{result.stderr[-4000:]}"
    )
    assert target.exists(), "脚本报告成功，但没有生成数据库文件"
    return target


def _rows(db: Path, sql: str) -> list[tuple]:
    connection = sqlite3.connect(db)
    try:
        return connection.execute(sql).fetchall()
    finally:
        connection.close()


def test_script_reports_the_endpoint_check(demo_db: Path):
    """自检必须真的跑过只读接口，而不是只打印一行"已写入"。"""
    env = dict(os.environ, PYTHONUTF8="1")
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--out", str(demo_db)],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    assert "演示数据集已写入" in result.stdout


def test_demo_persona_covers_the_main_pages(demo_db: Path):
    """演示数据要够填满主要页面，否则截图会大片留白（等于没有截图）。"""
    expectations = {
        "user_profile": 1,
        "job": 12,
        "resume_record": 3,
        "claim_record": 6,
        "material": 5,
        "knowledge_entry": 6,
        "application_track": 8,
        "interview_experience": 3,
        "reminder": 6,
        "referral": 2,
        "apply_queue_item": 4,
        "assistant_skill": 2,
        "chat_conversation": 1,
        "candidate_job": 2,
    }
    counts = {
        table: _rows(demo_db, f'select count(*) from "{table}"')[0][0]  # noqa: S608 - 表名来自固定字典
        for table in expectations
    }
    assert counts == expectations


def test_every_person_and_organisation_is_marked_fictional(demo_db: Path):
    """所有会被截图看到的名称都必须带虚构标记——这是防"误填真实资料"的闸门。"""
    names = [row[0] for row in _rows(demo_db, "select name from user_profile")]
    assert names and all(FICTIONAL_MARKER in name for name in names), names

    for table, column in (
        ("job", "company"),
        ("education", "school"),
        ("experience", "company"),
        ("application_track", "company"),
        ("referral", "referrer_name"),
        ("interview_experience", "company"),
        ("candidate_job", "company"),
    ):
        # 注意这里查的是**机构与人的名字**，不含 `project.name` 与 `award.name`：那两项是
        # "做过的一件事"和"拿过的奖项"（校园招聘会策划 / 校级优秀学生干部），本来就不该叫
        # "示例某某"，硬套标记只会让简历样例读起来像模板。
        values = [
            row[0]
            for row in _rows(demo_db, f'select "{column}" from "{table}"')  # noqa: S608 - 固定表列名
            if row[0]
        ]
        assert values, f"{table}.{column} 为空，演示数据没有覆盖到"
        bad = [value for value in values if FICTIONAL_MARKER not in value]
        assert not bad, f"{table}.{column} 里有不带虚构标记的值：{bad}"


def test_contacts_are_obviously_placeholders(demo_db: Path):
    """联系方式必须一眼就是假的：手机号固定 0000，邮箱走 example.com 保留域。"""
    profile = _rows(demo_db, "select name, phone, email, personal_website from user_profile")[0]
    _, phone, email, website = profile

    assert re.fullmatch(r"1\d{2}-0000-0000", phone), phone
    assert email.endswith("@example.com"), email
    assert urlsplit(website).hostname == "example.com", website


def test_job_links_point_at_placeholder_paths(demo_db: Path):
    """投递台只认招聘网站来源，所以演示岗位里要有站点链接；但它必须是**示例路径**，
    不能是一条真实在招的岗位（那会让"示例数据"变成对某个真实职位的暗示）。"""
    urls = [row[0] for row in _rows(demo_db, "select source_url from job where source_url <> ''")]
    assert urls, "演示岗位里没有任何站点链接，投递台截图会全是「来源不支持」"
    for url in urls:
        assert re.search(r"/job_detail/demo\d+\.html$", url), url


def test_no_api_key_is_stored(demo_db: Path):
    """截图里会出现设置页：演示配置绝不能带一个看起来像真的密钥。"""
    settings = dict(_rows(demo_db, "select key, value from app_setting"))
    llm = json.loads(settings["llm_config"])
    assert llm["api_key"] == ""
    assert llm["base_url"].startswith("https://")


def test_job_recognition_source_is_in_the_backend_whitelist(demo_db: Path):
    """演示岗位的来源值必须落在后端白名单里。

    这条守卫来自一连串真实故障：演示数据先是一律写英文旧值 `"text"` / `"collect"`，
    后来又被改成 `"手动添加"`——**三个都不在** `schemas/job.py` 的 `RECOGNITION_SOURCES` 里。
    后果有两层：岗位广场的「采集 / 手动」角标把它们全判成手动（官网截图上是错的），
    以及读取路径上 `JobOut` 校验失败会让**整份岗位列表 500**。
    """
    from app.schemas.job import RECOGNITION_SOURCES

    values = {row[0] for row in _rows(demo_db, "select distinct recognition_source from job")}
    unknown = sorted(value for value in values if value not in RECOGNITION_SOURCES)
    assert not unknown, f"演示岗位用了白名单之外的来源值：{unknown}"
    # 至少要有采集来的岗位：全是「手动填写」说明推导逻辑退化了（角标又会全歪）。
    assert "岗位采集" in values, f"演示数据里没有采集来源的岗位：{values}"


def test_section_order_uses_supported_keys(demo_db: Path):
    """演示库里的分区顺序只能用真实存在的键。

    这里曾经写成 ["education", "experience", "projects", "campus", "skills", "awards"]——
    前三个是**不存在的键**（真实键名是 experiences / educations / campus_experiences），
    规范化时会被整条丢弃，于是 6 条里只有 3 条生效。后果不是报错，而是**演示库的分区顺序
    看起来像被人手动拖乱了**，而且存的顺序优先于默认顺序，它会一直盖住产品设计的那个顺序——
    README 与官网的截图正是从这份数据来的，所以歪的是对外展示的那一面。
    """
    (raw,) = _rows(demo_db, "select section_order from user_profile")[0]
    stored = json.loads(raw)

    from app.schemas.profile import PROFILE_SECTION_KEYS

    unknown = [key for key in stored if key not in PROFILE_SECTION_KEYS]
    assert not unknown, f"section_order 里有不存在的键：{unknown}"
    assert "basic_info" not in stored, "basic_info 固定在最前，不该写进存起来的顺序里"


def test_new_profile_model_is_populated(demo_db: Path):
    """R-46 之后新界面不读旧六表：演示数据必须把同一份虚构资料写进 F1 新模型。

    背景（真实故障）：demo_data/profile.py 只写旧六表，而新资料模型按产品决定不读旧表，
    于是展示库打开资料页是空的、AI 生成直接 400「个人资料为空」。这条守卫同时钉住：

    - 默认组 + 工作区状态 + 参与清单（新资料页的骨架）；
    - profile_entry 里真有条目，且姓名是虚构的「张示例」（不是空表或真实姓名）；
    - 自建大字段/小字段（profile_custom_section / profile_custom_field）与条目值也写进去了，
      否则「资料页截图」会看不到 F3 的自建分区能力。
    """
    assert _rows(demo_db, "select count(*) from profile_group")[0][0] == 1
    group = _rows(demo_db, "select name, is_default, group_id from profile_group")[0]
    assert group[0] == "默认组" and group[1] == 1

    state = _rows(demo_db, "select current_group_id, default_group_id from profile_workspace_state")
    assert len(state) == 1, state
    assert state[0][0] == state[0][1] == group[2]

    member_count = _rows(demo_db, "select count(*) from profile_group_member")[0][0]
    assert member_count >= 13, f"默认组只参与了 {member_count} 个分区"

    entries = [
        (section_key, json.loads(raw_values))
        for section_key, raw_values in _rows(
            demo_db, 'select section_key, "values" from profile_entry'
        )
    ]
    assert len(entries) >= 10, f"新资料模型只有 {len(entries)} 条条目"
    section_keys = {row[0] for row in entries}
    assert {"basic_info", "educations", "experiences", "projects", "skills"} <= section_keys, (
        section_keys
    )

    basic = next(values for key, values in entries if key == "basic_info")
    assert "张示例" in basic.values(), basic
    experience_values = " ".join(
        str(value) for key, values in entries if key == "experiences" for value in values.values()
    )
    assert "示例科技有限公司" in experience_values, experience_values

    sections = _rows(demo_db, "select key, name from profile_custom_section")
    assert sections, "自建大字段没有写进演示数据"
    custom_keys = {row[0] for row in sections}
    custom_entries = [values for key, values in entries if key in custom_keys]
    assert custom_entries, "自建大字段下没有任何条目"
    custom_text = " ".join(str(value) for values in custom_entries for value in values.values())
    assert "example.com" in custom_text, custom_entries

    fields = _rows(demo_db, "select section_key, label from profile_custom_field")
    assert any(row[1] == "作品链接" for row in fields), fields


def test_profiles_two_models_share_the_same_fictional_persona(demo_db: Path):
    """新旧两套资料必须同源：旧六表与 profile_entry 的姓名/经历一致，不能各写一份。"""
    old_name = _rows(demo_db, "select name from user_profile")[0][0]
    entries = [
        (section_key, json.loads(raw_values))
        for section_key, raw_values in _rows(
            demo_db, 'select section_key, "values" from profile_entry'
        )
    ]
    basic = next(values for key, values in entries if key == "basic_info")
    assert old_name in basic.values()
    experience_text = " ".join(
        str(value) for key, values in entries if key == "experiences" for value in values.values()
    )
    assert "示例科技有限公司" in experience_text
