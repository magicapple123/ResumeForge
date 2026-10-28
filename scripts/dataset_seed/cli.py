# SPDX-License-Identifier: Apache-2.0
"""测试数据集的装配流程：建库 → 逐域造数 → 打包 → 可选自检。"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from sqlalchemy import text

from dataset_seed import (
    archive,
    claims,
    files,
    interview,
    jobs,
    knowledge,
    profile,
    resumes,
    scenarios,
    tracker,
    webform,
)
from dataset_seed.base import upgrade_schema

# 导入后**必须**读得出来的接口。选的是"打开某个页面就会打的一枪"，不是全量接口：
# 数据只要与 schema 有一处不符，这些端点就会 500，而那正是要抓的东西。
CHECKS = [
    "/api/health",
    "/api/profile",
    "/api/profile/workspace",
    "/api/profile/groups",
    "/api/profile/current/projection",
    "/api/profile/photos",
    "/api/webform/extra-profile",
    "/api/jobs?page=1&page_size=20",
    "/api/jobs/1",
    "/api/candidate-jobs",
    "/api/resumes?page=1&page_size=20",
    "/api/resumes/1",
    "/api/resumes/1/export?format=html",
    "/api/resumes/templates",
    "/api/claims",
    "/api/claims/1",
    "/api/materials",
    "/api/materials/1",
    "/api/knowledge",
    "/api/knowledge/1",
    "/api/interview-experiences",
    "/api/tracker",
    "/api/tracker/export?format=csv",
    "/api/reminders",
    "/api/referrals",
    "/api/apply/queue",
    "/api/apply/records?page=1&page_size=10",
    "/api/apply/tasks",
    "/api/assistant/conversations",
    "/api/assistant/conversations/1",
    "/api/assistant/skills",
    "/api/user-files",
    "/api/webform/records",
    "/api/webform/records/1",
    "/api/career-scenarios",
    "/api/career-scenarios?include_archived=true",
    "/api/drill",
    "/api/drill/1",
    "/api/drill/2",
    "/api/interview/question-banks",
    "/api/interview/reviews",
    "/api/stats",
    "/api/analytics/dashboard?trend_months=6",
    "/api/search?q=会员",
    "/api/trash",
]


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="生成可导入简历通的测试数据集（zip）")
    parser.add_argument("--out", required=True, help="工作库路径（该文件必须不存在）")
    parser.add_argument("--zip", required=True, help="导出的压缩包路径")
    parser.add_argument("--check", action="store_true", help="写完后把只读接口跑一遍")
    return parser


def _assert_fresh(path: Path) -> None:
    """拒绝写进已有库：那份库可能是用户的真实数据，覆盖是不可逆的。"""
    if path.exists():
        raise SystemExit(f"目标库已存在，拒绝覆盖：{path}\n请换一个 --out 路径后重试。")


def _counts() -> dict[str, int]:
    from dataset_seed.base import engine

    wanted = {
        "岗位": "job",
        "备选岗位": "candidate_job",
        "简历": "resume_record",
        "资料条目": "profile_entry",
        "投递方案": "profile_group",
        "自建板块": "profile_custom_section",
        "事实台账": "claim_record",
        "资料箱": "material",
        "知识库": "knowledge_entry",
        "面经": "interview_experience",
        "求职进度": "application_track",
        "内推": "referral",
        "提醒": "reminder",
        "投递队列": "apply_queue_item",
        "我的文件": "user_file",
        "网申填表记录": "web_form_fill_record",
        "网申分组": "web_form_profile_record",
        "职业场景": "career_scenario",
        "模拟面试": "drill_session",
        "题库历史": "question_bank_record",
        "复盘历史": "interview_review_record",
    }
    with engine.connect() as conn:
        return {
            label: conn.execute(text(f'SELECT COUNT(*) FROM "{table}"')).scalar_one()
            for label, table in wanted.items()
        }


def _materialize_files() -> None:
    """把资料箱/岗位备注里的图片 data URL 落成 user_files 磁盘副本。

    不做这一步，「我的文件」是空的、备份包里的 ``asset_manifest`` 也会声明 0 个附件——
    导入后用户点开「我的文件」只会看到空态，而这恰好是附件回填链路的验证点。
    """
    from app.database import SessionLocal
    from app.services.user_files import backfill_missing_copies

    with SessionLocal() as db:
        created = backfill_missing_copies(db)
    print(f"我的文件：回填 {created} 个附件副本")


def run_checks() -> int:
    """用 TestClient 走一遍只读接口，返回失败条数。"""
    from app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app, client=("127.0.0.1", 50000), raise_server_exceptions=False)
    failures: list[str] = []
    for path in CHECKS:
        response = client.get(path)
        if response.status_code >= 400:
            failures.append(f"{response.status_code} {path} :: {response.text[:180]}")
    if failures:
        print("自检未通过：", file=sys.stderr)
        for item in failures:
            print("  " + item.replace("\n", " "), file=sys.stderr)
        return len(failures)
    print(f"自检通过：{len(CHECKS)} 个只读接口全部正常。")
    return 0


def main(argv: list[str] | None = None) -> int:
    arguments = build_parser().parse_args(argv)
    out = Path(arguments.out).expanduser().resolve()
    _assert_fresh(out)
    out.parent.mkdir(parents=True, exist_ok=True)

    upgrade_schema()
    profile.seed()
    jobs.seed()
    resumes.seed()
    claims.seed()
    knowledge.seed()
    tracker.seed()
    interview.seed()
    scenarios.seed()
    webform.seed()
    files.seed()
    _materialize_files()

    counts = _counts()
    print("已写入：" + "、".join(f"{label} {value}" for label, value in counts.items()))
    archive_path = archive.build(out.parent, Path(arguments.zip).expanduser().resolve())
    print(f"压缩包：{archive_path}（{archive_path.stat().st_size / 1024:.0f} KB）")

    if arguments.check:
        return run_checks()
    return 0
