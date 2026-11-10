# SPDX-License-Identifier: Apache-2.0
"""外部简历只读快照的全链路测试（清单 `21.6 的上传 / 隔离 / 删除恢复 / 检查 / 备份）。

跑在真实 FastAPI 应用 + 真实 SQLite（`conftest.clean_db` 每例重建表结构）上：
上传真的写磁盘副本、删除真的走回收站、备份真的打包并重新导入。**不 mock 解析层**——
PDF/DOCX 字节由 `tests.test_document_text` 的构造器手工拼出来。

覆盖的验收点（对应清单 `21.6）：

- 上传 pdf / docx / txt → 行落库、text 非空、text_chars 与正文一致；同内容重复上传
  命中 sha，不产生第二份物理文件；
- 扫描件 PDF → 行照建、text == ""、返回 warning；分析接口 has_text=False；
- 隔离：不出现在 `/api/resumes`、`GET /api/resumes/{外部 id}` 404、PATCH 不接受
  `resume_id` 这类字段；
- 删除 → 列表消失 → 回收站恢复 → 仍在列表；物理文件**始终存在**（软删与彻底删除都不删）；
- 文本检查：有占位符就报出来；无 JD 时关键词分项不出现；有 JD 时覆盖率 = 命中/目标；
- 备份：导出包里 external_resume 行与 user_files 原件都在；导入后新库能读到这条行。
"""

from __future__ import annotations

import hashlib
import json
import zipfile

from app.database import engine
from app.dataset_registry import dataset_database_file
from app.models.external_resume import ExternalResume
from app.models.job import Job
from app.models.resume import ResumeRecord
from app.models.user_file import UserFile
from app.services.data_backup import create_backup_archive
from app.services.datasets import import_dataset
from app.services.user_files import user_files_dir
from tests.test_document_text import build_docx, build_pdf

RESUME_TXT = "\n".join(
    [
        "张三",
        "手机：13800138000 邮箱：zhangsan@example.com",
        "负责了后端接口开发",
        "2024 年接口耗时下降 30%",
        "【待补】项目经历",
    ]
)
PDF_TEXT = "Zhang San Backend Engineer 13800138000"


def _upload(client, content, filename, *, mime="text/plain", name="", job_id=None):
    data = {"name": name}
    if job_id is not None:
        data["job_id"] = str(job_id)
    return client.post(
        "/api/external-resumes",
        files={"file": (filename, content, mime)},
        data=data,
    )


def _row(db_session, resume_id: int) -> ExternalResume:
    return db_session.query(ExternalResume).filter(ExternalResume.id == resume_id).one()


def _copy_files(content: bytes):
    """该内容对应的磁盘副本（按 sha 前缀定位；副本名由服务端生成）。"""
    directory = user_files_dir(engine)
    prefix = hashlib.sha256(content).hexdigest()[:16]
    return sorted(directory.glob(f"{prefix}-*"))


# ===== 上传 =====


def test_upload_txt_extracts_text_and_registers_user_file(client, db_session):
    response = _upload(client, RESUME_TXT.encode("utf-8"), "my-resume.txt", name="外部简历 A")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["name"] == "外部简历 A"
    assert body["has_text"] is True
    assert body["text_chars"] == len(RESUME_TXT)
    assert body["text"] == RESUME_TXT
    assert body["warnings"] == []

    row = _row(db_session, body["id"])
    user_file = db_session.get(UserFile, row.file_id)
    assert user_file is not None
    assert user_file.source_type == "external_resume"
    assert user_file.sha256 == hashlib.sha256(RESUME_TXT.encode("utf-8")).hexdigest()
    assert _copy_files(RESUME_TXT.encode("utf-8"))


def test_upload_pdf_and_docx_extract_text(client):
    pdf = build_pdf(PDF_TEXT)
    docx = build_docx("李四", "求职意向：后端开发工程师", "负责了订单服务")

    pdf_body = _upload(client, pdf, "external.pdf", mime="application/pdf").json()
    docx_body = _upload(
        client,
        docx,
        "external.docx",
        mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ).json()

    assert "Zhang San Backend Engineer" in pdf_body["text"]
    assert pdf_body["text_chars"] == len(pdf_body["text"])
    assert "求职意向：后端开发工程师" in docx_body["text"]
    assert docx_body["text_chars"] == len(docx_body["text"])


def test_scan_pdf_creates_row_with_empty_text_and_warning(client, db_session):
    """扫描件：行照建、text=="", 返回 warning；原件仍可下载。"""
    scan = build_pdf(blank=True)

    response = _upload(client, scan, "scan.pdf", mime="application/pdf")

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["has_text"] is False
    assert body["text"] == ""
    assert body["text_chars"] == 0
    assert body["warnings"] == ["这份文件没有文字层，暂时无法检查内容"]
    assert _row(db_session, body["id"]).text == ""

    original = client.get(f"/api/external-resumes/{body['id']}/file")
    assert original.status_code == 200
    assert original.content == scan
    assert "inline" in original.headers["content-disposition"]


def test_same_content_twice_does_not_duplicate_the_physical_file(client, db_session):
    content = RESUME_TXT.encode("utf-8")
    # 测试数据目录跨用例共享（同一 worker 内），所以比较"新增了几份"而不是总数。
    before = set(_copy_files(content))

    first = _upload(client, content, "a.txt")
    after_first = set(_copy_files(content))
    second = _upload(client, content, "b.txt")

    assert first.status_code == 201 and second.status_code == 201
    rows = db_session.query(ExternalResume).order_by(ExternalResume.id).all()
    assert [row.name for row in rows] == ["a.txt", "b.txt"]
    assert rows[0].file_id == rows[1].file_id
    assert db_session.query(UserFile).count() == 1
    assert len(after_first - before) == 1
    assert set(_copy_files(content)) == after_first


def test_upload_rejects_bad_input(client):
    assert _upload(client, b"", "empty.txt").status_code == 422
    unsupported = _upload(client, b"GIF89a", "resume.png", mime="image/png")
    assert unsupported.status_code == 422
    assert "不支持导入" in unsupported.json()["detail"]
    legacy = _upload(client, b"old word", "resume.doc")
    assert legacy.status_code == 422
    assert "docx" in legacy.json()["detail"]
    corrupt = _upload(client, b"%PDF-1.4 broken", "broken.pdf", mime="application/pdf")
    assert corrupt.status_code == 422
    too_large = _upload(client, b"x" * (10 * 1024 * 1024 + 1), "huge.txt")
    assert too_large.status_code == 413


# ===== 列表 / 改名 / 关联岗位 / 详情 =====


def test_list_search_patch_and_job_link(client, db_session):
    job = Job(title="后端工程师", company="示例公司")
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)

    created = _upload(client, RESUME_TXT.encode("utf-8"), "resume.txt", job_id=job.id).json()
    listing = client.get("/api/external-resumes").json()
    assert listing["total"] == 1
    assert listing["items"][0]["job_title"] == "后端工程师"
    assert client.get("/api/external-resumes", params={"keyword": "不存在"}).json()["total"] == 0

    renamed = client.patch(
        f"/api/external-resumes/{created['id']}",
        json={"name": "投递用的简历", "job_id": None},
    )
    assert renamed.status_code == 200, renamed.text
    body = renamed.json()
    assert body["name"] == "投递用的简历"
    assert body["job_id"] is None and body["job_title"] == ""

    detail = client.get(f"/api/external-resumes/{created['id']}").json()
    assert detail["text"] == RESUME_TXT

    forbidden = client.patch(f"/api/external-resumes/{created['id']}", json={"resume_id": 1})
    assert forbidden.status_code == 422
    missing_job = client.patch(f"/api/external-resumes/{created['id']}", json={"job_id": 999999})
    assert missing_job.status_code == 422


# ===== 隔离：两张表 id 空间独立 =====


def test_external_resume_is_invisible_to_resume_endpoints(client, db_session):
    db_session.add(ResumeRecord(title="内部生成的简历"))
    db_session.commit()
    external = _upload(client, RESUME_TXT.encode("utf-8"), "outside.txt").json()

    resumes = client.get("/api/resumes").json()
    assert [item["title"] for item in resumes["items"]] == ["内部生成的简历"]
    # 两张表 id 空间独立：外部简历的 id 在 /api/resumes/{id} 上不存在（没有同名行时 404）。
    if external["id"] not in {item["id"] for item in resumes["items"]}:
        assert client.get(f"/api/resumes/{external['id']}").status_code == 404
    # 反向：内部简历不会出现在外部简历列表里。
    assert client.get("/api/external-resumes").json()["total"] == 1


def test_deleted_resume_is_404_everywhere(client):
    created = _upload(client, RESUME_TXT.encode("utf-8"), "gone.txt").json()
    assert client.delete(f"/api/external-resumes/{created['id']}").status_code == 204

    assert client.get(f"/api/external-resumes/{created['id']}").status_code == 404
    assert client.get(f"/api/external-resumes/{created['id']}/file").status_code == 404
    assert client.get(f"/api/external-resumes/{created['id']}/analysis").status_code == 404
    assert client.delete(f"/api/external-resumes/{created['id']}").status_code == 404


# ===== 删除 / 回收站恢复 / 物理文件不删 =====


def test_delete_restore_and_purge_never_touch_the_physical_file(client, db_session):
    content = RESUME_TXT.encode("utf-8")
    created = _upload(client, content, "keep-me.txt").json()
    disk_path = user_files_dir(engine) / db_session.query(UserFile).one().disk_name
    assert disk_path.is_file()

    assert client.delete(f"/api/external-resumes/{created['id']}").status_code == 204
    assert client.get("/api/external-resumes").json()["total"] == 0

    trash = client.get("/api/trash").json()
    mine = [item for item in trash["items"] if item["type"] == "external_resume"]
    assert [item["id"] for item in mine] == [created["id"]]
    assert mine[0]["title"] == "keep-me.txt"

    restored = client.post(f"/api/trash/external_resume/{created['id']}/restore")
    assert restored.status_code == 204
    assert client.get("/api/external-resumes").json()["total"] == 1
    assert disk_path.is_file()

    # 彻底删除（清空回收站里这一条）：行没了，但物理文件与 user_file 登记都还在。
    assert client.delete(f"/api/external-resumes/{created['id']}").status_code == 204
    assert client.delete(f"/api/trash/external_resume/{created['id']}").status_code == 204
    assert db_session.query(ExternalResume).count() == 0
    assert db_session.query(UserFile).count() == 1
    assert disk_path.is_file()


# ===== 文本检查 =====


def test_analysis_without_jd_has_itemized_checks_but_no_keyword_section(client):
    created = _upload(client, RESUME_TXT.encode("utf-8"), "check.txt").json()

    body = client.get(f"/api/external-resumes/{created['id']}/analysis").json()

    assert body["has_text"] is True
    assert body["text_chars"] == len(RESUME_TXT)
    keys = [check["key"] for check in body["checks"]]
    assert keys == ["placeholder", "quantification", "contact", "length", "weak_wording"]
    assert "score" not in body


def test_analysis_uses_linked_job_description_for_keyword_coverage(client, db_session):
    job = Job(
        title="后端工程师",
        company="示例公司",
        description="岗位要求：熟悉 Python、FastAPI、Kubernetes，有高并发经验",
    )
    db_session.add(job)
    db_session.commit()
    db_session.refresh(job)
    created = _upload(
        client,
        "使用 Python 与 FastAPI 开发订单服务".encode(),
        "python-resume.txt",
        job_id=job.id,
    ).json()

    body = client.get(f"/api/external-resumes/{created['id']}/analysis").json()
    keyword = next(check for check in body["checks"] if check["key"] == "keywords")
    keywords = keyword["keywords"]

    assert keywords["target"], "JD 应能抽出目标词"
    assert keywords["missing"] == [
        word for word in keywords["target"] if word not in keywords["matched"]
    ]
    assert keywords["coverage_ratio"] == round(
        len(keywords["matched"]) / len(keywords["target"]), 3
    )


def test_analysis_of_scan_pdf_does_not_claim_it_passed(client):
    created = _upload(client, build_pdf(blank=True), "scan2.pdf", mime="application/pdf").json()

    body = client.get(f"/api/external-resumes/{created['id']}/analysis").json()

    assert body["has_text"] is False
    assert body["checks"] == []
    assert body["warnings"]


def test_missing_text_is_re_extracted_from_the_original_file(client, db_session):
    """正文为空但原件还在（例如升级前的老行 / 手工清空）：按 file_id 重提取一次并回写。"""
    created = _upload(client, RESUME_TXT.encode("utf-8"), "heal.txt").json()
    row = _row(db_session, created["id"])
    row.text = ""
    row.text_chars = 0
    db_session.commit()

    body = client.get(f"/api/external-resumes/{created['id']}/analysis").json()

    assert body["has_text"] is True
    db_session.expire_all()
    healed = _row(db_session, created["id"])
    assert healed.text == RESUME_TXT
    assert healed.text_chars == len(RESUME_TXT)


# ===== 备份：行与原件都在，导入后读得到 =====


def test_backup_contains_row_and_original_file_and_import_reads_it(client, db_session, tmp_path):
    content = RESUME_TXT.encode("utf-8")
    _upload(client, content, "backup-me.txt").json()
    disk_name = db_session.query(UserFile).one().disk_name

    archive = create_backup_archive(engine, tmp_path / "staging")
    with zipfile.ZipFile(archive) as handle:
        manifest = json.loads(handle.read("manifest.json"))
        members = set(handle.namelist())

    assert manifest["tables"]["external_resume"] == 1
    assert f"user_files/{disk_name}" in members

    restored = import_dataset(archive, "外部简历备份导入", engine, tmp_path / "import")
    with dataset_database_file(restored["id"]).open("rb") as handle:
        assert handle.read(16) == b"SQLite format 3\x00"
    # 导入后的库与包内行数一致（列表页读的就是这张表）。
    import sqlite3

    with sqlite3.connect(dataset_database_file(restored["id"])) as connection:
        assert connection.execute("SELECT COUNT(*) FROM external_resume").fetchone()[0] == 1
        assert connection.execute("SELECT COUNT(*) FROM user_file").fetchone()[0] == 1
