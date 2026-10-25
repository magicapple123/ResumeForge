# SPDX-License-Identifier: Apache-2.0
"""W21-SCN：跨功能的**场景级**集成验证（E01/E04/E06/E07/E09/E11）。

这一层不重复单元测试：它把用户会真实走过的几条链路串起来跑一遍，并把"证据"落到
可复跑的命令与输出上。逐场景：

- E01 旧记录完整编辑：POST /manual 造**旧形状**（无 id/point_ids）→ GET（不得在读取时
  生成身份字段、不得写库）→ PUT /content（带 expected_revision）→ GET 一致 →
  POST /preview-pdf 传未保存 content（不得落库、不得推进 revision、PDF 里有新内容）。
  导出的两条分支都要钉住：**带 content** 时 PDF 用草稿、库内记录与 revision 不动
  （W19 同快照口径）；**不带 content** 时仍走已保存记录（"不传就不猜"的反向回归）。
- E04 并发冲突：两个"窗口"基于同一 revision 条件写；后到的那个 409 + 业务码 +
  当前 revision，库内保留先写者的内容。
- E06 备份状态：隔离库里存在成功 marker 但快照不存在 → protected=False /
  snapshot_state=empty（"有历史成功记录"不等于"现在受保护"）。
- E07 静态资源边界：完整边界由 tests/test_static_spa.py 覆盖（20+ 用例，含
  ?path= 注入、符号链接、MIME、405、SPA 回退）；这里只做端到端旁证，不复制其夹具。
- E09 搜索正文抓取默认关闭：GET /settings/search 与 schema/服务默认值都是
  fetch_pages=0（抓正文要用户显式打开）。
- E11 备份恢复演练：真实子进程跑 scripts/backup_restore_drill.py（合成数据 +
  仓库外临时目录），断言退出码 0 且报告逐项通过。

数据全合成；不碰 backend/data；不启动服务；不改产品源码。
"""

from __future__ import annotations

import copy
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from app.models.resume import ResumeRecord
from test_pdf_exporter import _text_runs, needs_font
from test_preview_pdf import PREVIEW

REPO_ROOT = Path(__file__).resolve().parents[2]
DRILL_ENTRY = REPO_ROOT / "scripts" / "backup_restore_drill.py"

# 旧形状内容：没有 id / point_ids，也没有新版才有的可选字段（模拟历史记录）。
OLD_SHAPE_CONTENT = {
    "name": "示例旧记录",
    "phone": "138-0000-0000",
    "email": "sample.old@example.com",
    "city": "示例市",
    "job_intent": "示例岗位",
    "summary": "旧形状记录的原始总结。",
    "education": [{"school": "示例大学", "major": "示例专业", "degree": "本科"}],
    "experience": [
        {"company": "示例科技有限公司", "role": "示例岗位", "description": ["旧记录要点一"]}
    ],
    "skills": [{"name": "示例技能", "level": "熟练"}],
}

IDENTITY_KEYS = ("id", "point_ids")
CONTENT_SECTIONS = ("education", "experience", "campus_experience", "projects", "skills", "awards")


# ===== 共用小工具 =====


def _create_legacy_resume(client) -> int:
    response = client.post(
        "/api/resumes/manual",
        json={"job_id": None, "title": "W21 场景 · 旧形状", "content": OLD_SHAPE_CONTENT},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _row(db_session, record_id: int) -> ResumeRecord:
    db_session.expire_all()
    row = db_session.get(ResumeRecord, record_id)
    assert row is not None
    return row


def _detail(client, record_id: int) -> dict:
    response = client.get(f"/api/resumes/{record_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _assert_no_identity_fields(content: dict) -> None:
    """旧形状内容在任何出口都不许凭空出现 id / point_ids。"""
    for key in IDENTITY_KEYS:
        assert key not in content, f"顶层出现 {key}"
    for section in CONTENT_SECTIONS:
        for index, item in enumerate(content.get(section) or []):
            for key in IDENTITY_KEYS:
                assert key not in item, f"{section}[{index}] 出现 {key}"


def _pdf_text(content: bytes) -> str:
    return "".join(run[3] for run in _text_runs(content))


# ===== E01：旧记录完整编辑 =====


def test_e01_legacy_shape_editing_round_trip(client, db_session):
    """旧形状 → GET 不生成身份字段也不写库 → 条件保存 → GET 一致。"""
    record_id = _create_legacy_resume(client)
    before = _row(db_session, record_id)
    content_before = copy.deepcopy(before.content)
    updated_before = before.updated_at
    _assert_no_identity_fields(content_before)

    # GET：读出旧形状，绝不在读取路径上"补齐"身份字段。
    detail = _detail(client, record_id)
    assert detail["revision"] == 0
    _assert_no_identity_fields(detail["content"])
    assert detail["content"]["summary"] == OLD_SHAPE_CONTENT["summary"]

    # GET 不写库：内容与 updated_at 都不许变（W01 的硬性质）。
    after_get = _row(db_session, record_id)
    assert after_get.content == content_before
    assert after_get.updated_at == updated_before

    # 条件保存：旧形状内容 + expected_revision=0 → 200 且版本 +1。
    edited = copy.deepcopy(content_before)
    edited["summary"] = "W21 场景：旧形状记录在制作台编辑后的总结。"
    edited["experience"][0]["description"] = ["W21 场景：编辑后的要点"]
    saved = client.put(
        f"/api/resumes/{record_id}/content",
        json={"content": edited, "expected_revision": detail["revision"]},
    )
    assert saved.status_code == 200, saved.text
    body = saved.json()
    assert body["revision"] == 1
    assert body["content"]["summary"] == edited["summary"]
    _assert_no_identity_fields(body["content"])

    # GET 一致：同一份内容、同一版本，且身份字段仍不存在。
    again = _detail(client, record_id)
    assert again["revision"] == 1
    assert again["content"]["summary"] == edited["summary"]
    assert again["content"]["experience"][0]["description"] == ["W21 场景：编辑后的要点"]
    _assert_no_identity_fields(again["content"])
    row = _row(db_session, record_id)
    assert row.revision == 1
    assert row.content["summary"] == edited["summary"]


@needs_font
def test_e01_unsaved_preview_does_not_persist_or_bump_revision(client, db_session):
    """未保存 content 的精确预览：PDF 里是新内容，库里一个字节不动、revision 不涨。"""
    record_id = _create_legacy_resume(client)
    before = _row(db_session, record_id)
    content_before = copy.deepcopy(before.content)
    revision_before = before.revision

    draft = copy.deepcopy(content_before)
    draft["summary"] = "W21 场景：这条总结还没保存，只出现在预览里。"
    response = client.post(
        PREVIEW.format(id=record_id),
        json={"page_limit": 1, "content": draft},
    )
    assert response.status_code == 200, response.text
    assert "还没保存，只出现在预览里" in _pdf_text(response.content)

    after = _row(db_session, record_id)
    assert after.revision == revision_before  # 预览不推进版本
    assert after.content == content_before  # 预览不落库
    # 不带覆盖的预览回到记录里的那一版（缓存/覆盖没有串）。
    plain = client.post(PREVIEW.format(id=record_id), json={"page_limit": 1})
    assert plain.status_code == 200, plain.text
    assert "还没保存，只出现在预览里" not in _pdf_text(plain.content)

    # 反向回归（W19 之后仍然成立的那一半）：**不带 content** 的导出按已保存记录走，
    # 不拿预览草稿去猜。带 content 的同快照分支由下一条用例钉住——两条必须同时在场，
    # 否则"预览=下载"与"下载忽略草稿"都可能在没人发现的情况下被改回去。
    exported = client.post(
        f"/api/resumes/{record_id}/export",
        json={"format": "pdf", "page_limit": 1},
    )
    assert exported.status_code == 200, exported.text
    export_text = _pdf_text(exported.content)
    assert "旧形状记录的原始总结" in export_text
    assert "还没保存，只出现在预览里" not in export_text


@needs_font
def test_e01_export_with_draft_content_keeps_library_untouched(client, db_session):
    """W19 同快照口径：导出带未保存 content → PDF 含草稿，库内记录与版本一个字节不动。

    与上一条互补：上一条守"不传 content 就按已保存记录导"，这一条守"传了就按草稿导"。
    两条同时钉住，才能同时防住两种回归——"预览是草稿、下载是旧记录"（W04 的原始缺口）
    与"导出把草稿顺手落库/推 revision"（预览与下载共用一条管线后新增的风险）。
    """
    from app.models.resume_delivery import ResumeDeliveryRecord

    record_id = _create_legacy_resume(client)
    before = _row(db_session, record_id)
    content_before = copy.deepcopy(before.content)
    revision_before = before.revision
    updated_before = before.updated_at

    draft = copy.deepcopy(content_before)
    draft["summary"] = "W21 E01：这条总结只存在于草稿，下载到的 PDF 应当带上它。"
    exported = client.post(
        f"/api/resumes/{record_id}/export",
        json={"format": "pdf", "page_limit": 1, "content": draft},
    )
    assert exported.status_code == 200, exported.text
    text = _pdf_text(exported.content)
    assert "只存在于草稿" in text  # 下载到的就是草稿那一版
    assert "旧形状记录的原始总结" not in text  # 不是库里已保存的那一版
    # 交付指纹必须就是本次响应体的字节：缓存/重算都不能让头与文件指向两份内容。
    assert exported.headers["X-Content-Sha256"] == hashlib.sha256(exported.content).hexdigest()

    # 库内记录不动：revision / 正文 / updated_at 全都不变。
    after = _row(db_session, record_id)
    assert after.revision == revision_before
    assert after.content == content_before
    assert after.updated_at == updated_before
    # 默认不冻结投递快照：一次草稿下载不是"正式投递存档"，不该在账本里留下证据行。
    assert db_session.query(ResumeDeliveryRecord).count() == 0

    # 紧接着再导一次"不带 content"：回到已保存记录那一版——草稿没有被上一次导出留住。
    saved = client.post(
        f"/api/resumes/{record_id}/export",
        json={"format": "pdf", "page_limit": 1},
    )
    assert saved.status_code == 200, saved.text
    saved_text = _pdf_text(saved.content)
    assert "旧形状记录的原始总结" in saved_text
    assert "只存在于草稿" not in saved_text
    assert saved.headers["X-Content-Sha256"] != exported.headers["X-Content-Sha256"]


# ===== E04：并发条件写冲突 =====


def test_e04_stale_conditional_write_conflicts_without_overwriting(client, db_session):
    """两个窗口基于同一 revision：后写者 409 + 当前 revision，库内保留先写者内容。"""
    record_id = _create_legacy_resume(client)
    base = _detail(client, record_id)
    assert base["revision"] == 0

    window_a = copy.deepcopy(base["content"])
    window_a["summary"] = "W21 E04：窗口 A 的修改"
    window_b = copy.deepcopy(base["content"])
    window_b["summary"] = "W21 E04：窗口 B 的修改"

    first = client.put(
        f"/api/resumes/{record_id}/content",
        json={"content": window_b, "expected_revision": base["revision"]},
    )
    assert first.status_code == 200, first.text
    assert first.json()["revision"] == 1

    stale = client.put(
        f"/api/resumes/{record_id}/content",
        json={"content": window_a, "expected_revision": base["revision"]},
    )
    assert stale.status_code == 409, stale.text
    body = stale.json()
    assert body["code"] == "resume_revision_conflict"
    assert body["revision"] == 1  # 告诉前端"当前是哪一版"
    assert body["detail"] == "这份简历已被其他窗口修改"

    row = _row(db_session, record_id)
    assert row.revision == 1
    assert row.content["summary"] == "W21 E04：窗口 B 的修改"
    assert "窗口 A" not in json.dumps(row.content, ensure_ascii=False)

    # 冲突之后带上正确 revision 仍可继续写（不是永久锁死）。
    retry = client.put(
        f"/api/resumes/{record_id}/content",
        json={"content": window_a, "expected_revision": body["revision"]},
    )
    assert retry.status_code == 200, retry.text
    assert retry.json()["revision"] == 2


# ===== E06：备份保护状态 =====


def test_e06_success_marker_without_snapshot_is_not_protected(tmp_path, monkeypatch):
    """有成功 marker、但快照不存在 → 不得显示"受保护"；历史 last_success 仍保留。"""
    from app.database import build_engine
    from app.services.data_backup.auto_backup import dataset_scope_directory
    from app.services.data_backup.status import backup_status

    monkeypatch.setattr(
        "app.config.get_settings",
        lambda: SimpleNamespace(auto_backup_interval_days=7),
    )
    engine = build_engine(f"sqlite:///{(tmp_path / 'scope.db').as_posix()}")
    try:
        with engine.begin() as connection:
            connection.exec_driver_sql("CREATE TABLE probe (id INTEGER PRIMARY KEY)")
        directory = dataset_scope_directory(engine)
        directory.mkdir(parents=True, exist_ok=True)
        (directory / ".last-run.json").write_text(
            json.dumps(
                {
                    "last_attempt": 1_000,
                    "last_success": 1_000,
                    "consecutive_failures": 0,
                    "last_error": "",
                }
            ),
            encoding="utf-8",
        )
        status = backup_status(engine, now=1_100)
        assert status["last_success"] == 1_000  # 历史事实必须保留
        assert status["last_attempt"] == 1_000
        assert status["snapshot_state"] == "empty"  # 目录可读、但确实没有快照
        assert status["snapshot_count"] == 0
        assert status["snapshots"] == []
        assert status["protected"] is False  # 关键：不能因为 marker 说有成功就报受保护
    finally:
        engine.dispose()


# ===== E07：静态资源边界（旁证） =====


def test_e07_api_paths_never_fall_back_to_the_frontend_shell(client):
    """纯 API 模式下未知 API 路径必须是 404 JSON，不能回退成前端 index。

    完整静态资产边界（根文件 ?path= 注入、符号链接、MIME、405、deep link 回退）由既有
    tests/test_static_spa.py 的 20+ 用例覆盖；这里只做端到端旁证，不复制它的 dist 夹具
    （任务允许"若复用成本高，记录由该文件覆盖"）。
    """
    response = client.get("/api/definitely-not-a-route-w21-scenario")
    assert response.status_code == 404, response.text
    assert response.headers.get("content-type", "").startswith("application/json")
    assert "<html" not in response.text.lower()


# ===== E09：搜索正文抓取默认关闭 =====


def test_e09_page_fetch_defaults_to_off(client, db_session):
    """抓取正文（fetch_pages）默认必须为 0：要抓正文得用户显式打开。"""
    from app.schemas.setting import SearchConfig
    from app.services.settings_service import get_search_config

    response = client.get("/api/settings/search")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["fetch_pages"] == 0
    assert payload["max_results"] >= 1

    assert SearchConfig().fetch_pages == 0
    assert get_search_config(db_session).fetch_pages == 0

    # 显式打开后能存下来（证明关闭不是"写不进去"的假默认）。
    opened = dict(payload)
    opened["fetch_pages"] = 2
    written = client.put("/api/settings/search", json=opened)
    assert written.status_code == 200, written.text
    assert written.json()["fetch_pages"] == 2


# ===== E11：备份恢复演练（真实子进程） =====


@pytest.fixture(scope="module")
def drill_evidence(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """在子进程里跑一次完整演练（合成数据、仓库外临时目录），返回报告与产物路径。"""
    work_dir = tmp_path_factory.mktemp("w21-drill") / "work"
    report_path = work_dir.parent / "drill-report.json"
    env = dict(os.environ, PYTHONUTF8="1")
    completed = subprocess.run(
        [
            sys.executable,
            str(DRILL_ENTRY),
            "--work-dir",
            str(work_dir),
            "--json-out",
            str(report_path),
        ],
        cwd=str(REPO_ROOT),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        env=env,
        timeout=300,
        check=False,
    )
    assert report_path.is_file(), (
        f"演练没有写出汇总报告（退出码 {completed.returncode}）\n"
        f"stdout:\n{completed.stdout[-3000:]}\nstderr:\n{completed.stderr[-3000:]}"
    )
    return {
        "completed": completed,
        "report": json.loads(report_path.read_text(encoding="utf-8")),
        "work_dir": work_dir,
        "report_path": report_path,
    }


def test_e11_backup_restore_drill_passes_every_check(drill_evidence):
    """E11：完整备份 → 隔离恢复演练退出码 0，且报告逐项通过。"""
    completed = drill_evidence["completed"]
    report = drill_evidence["report"]
    assert completed.returncode == 0, (
        f"演练退出码 {completed.returncode}\nstdout:\n{completed.stdout[-3000:]}\n"
        f"stderr:\n{completed.stderr[-3000:]}"
    )
    assert report["ok"] is True
    assert report["total"] >= 100
    assert report["passed"] == report["total"]
    failed = [check for check in report["checks"] if not check["ok"]]
    assert failed == [], f"演练存在失败检查：{failed[:5]}"
    keys = {check["key"] for check in report["checks"]}
    # 五组 R01 要求都真的被跑到（不是"报告写了个 ok 但没检查"）。
    for prefix in ("export.", "restore."):
        assert any(key.startswith(prefix) for key in keys), prefix
    assert any(key.startswith("restore.reject.") for key in keys)
    assert report["work_dir"], "报告必须写明证据目录"
    assert drill_evidence["work_dir"].exists()
