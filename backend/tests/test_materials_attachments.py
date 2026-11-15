# SPDX-License-Identifier: Apache-2.0
"""资料箱附件上传（第 23 条）的后端测试。

覆盖：多格式上传与提取、扫描件 PDF 不做视觉识别、.doc / 超限 / 不支持格式的拒绝、
原件落 user_file、正文里 file_id 的存取，以及历史附件（无 file_id）的只读反查。
"""

from __future__ import annotations

import base64
import hashlib

from app.models.material import Material
from app.models.user_file import UserFile
from app.services import document_text
from app.services.user_files import user_files_dir
from tests.test_document_text import DOCX_MIME, build_docx, build_pdf, data_url

# 1×1 透明 PNG：只要文件头是合法 PNG 签名即可（normalize_image_attachment 不做像素
# 解码，只有 bmp/tiff 才需要 Pillow）。
PNG_1PX = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)
PNG_MIME = "image/png"
# PDF 单页文字默认少于 30 字符会被判成扫描页（见 document_text.IMAGE_PAGE_MIN_CHARS），
# 样张因此写一句足够长的话。
TEXT_MARKER = "Backend engineer hiring note for the platform team in Tianjin"


def _upload(client, name: str, raw: bytes, mime: str):
    return client.post(
        "/api/materials/attachments",
        files={"file": (name, raw, mime)},
    )


def _sha(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


# ===== 多格式上传 =====


def test_text_formats_are_stored_and_extracted(client, db_session):
    cases = [
        ("note.txt", TEXT_MARKER.encode("utf-8"), "text/plain"),
        ("note.md", ("# " + TEXT_MARKER).encode("utf-8"), "text/markdown"),
        ("data.json", ('{"title": "' + TEXT_MARKER + '"}').encode("utf-8"), "application/json"),
        ("rows.csv", ("name," + TEXT_MARKER + "\n1,2\n").encode("utf-8"), "text/csv"),
        ("jd.pdf", build_pdf(TEXT_MARKER), "application/pdf"),
        ("jd.docx", build_docx(TEXT_MARKER), DOCX_MIME),
    ]
    for name, raw, mime in cases:
        response = _upload(client, name, raw, mime)
        assert response.status_code == 200, (name, response.text)
        payload = response.json()
        assert payload["file_id"] > 0, name
        assert payload["name"] == name
        assert payload["size_bytes"] == len(raw)
        assert TEXT_MARKER in payload["text"], (name, payload["text"])
        assert payload["data_url"] == ""
        assert payload["warnings"] == []
        row = db_session.get(UserFile, payload["file_id"])
        assert row is not None
        assert row.sha256 == _sha(raw)
        assert row.source_type == "material"
        assert row.size == len(raw)


def test_image_upload_returns_limited_data_url_and_stores_original(client, db_session):
    response = _upload(client, "证书.png", PNG_1PX, PNG_MIME)
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["file_id"] > 0
    assert payload["text"] == ""
    assert payload["data_url"].startswith("data:image/png;base64,")
    assert base64.b64decode(payload["data_url"].split(",", 1)[1]) == PNG_1PX

    row = db_session.get(UserFile, payload["file_id"])
    assert row is not None
    assert row.mime == PNG_MIME
    stored = user_files_dir(db_session.get_bind()) / row.disk_name
    assert stored.is_file()
    assert stored.read_bytes() == PNG_1PX


def test_same_file_uploaded_twice_keeps_one_physical_copy(client, db_session):
    first = _upload(client, "重复.txt", b"same bytes", "text/plain")
    second = _upload(client, "重复.txt", b"same bytes", "text/plain")
    assert first.status_code == 200 and second.status_code == 200
    assert first.json()["file_id"] == second.json()["file_id"]
    rows = db_session.query(UserFile).filter(UserFile.sha256 == _sha(b"same bytes")).all()
    assert len(rows) == 1


# ===== 扫描件 PDF：不做视觉识别，如实返回警告 =====


def test_scanned_pdf_does_not_render_pages_and_reports_a_warning(client, monkeypatch):
    def fail_render(*_args, **_kwargs):
        raise AssertionError("资料箱附件不应渲染扫描页（视觉识别是面试材料链路的职责）")

    monkeypatch.setattr(document_text, "render_pdf_page_images", fail_render)

    response = _upload(client, "扫描件.pdf", build_pdf(blank=True), "application/pdf")
    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["file_id"] > 0
    assert payload["text"] == ""
    # 不能返回"提取成功"的假象：warnings 必须说明没提取到文字及其原因。
    assert payload["warnings"], "扫描件 PDF 必须给警告而不是静默成功"
    assert any("扫描件" in item or "文字层" in item for item in payload["warnings"])


# ===== 拒绝路径 =====


def test_legacy_doc_is_rejected_with_docx_hint(client):
    response = _upload(client, "旧版.doc", b"\xd0\xcf\x11\xe0legacy", "application/msword")
    assert response.status_code == 422
    detail = response.json()["detail"]
    assert ".docx" in detail


def test_unsupported_extension_is_rejected(client):
    response = _upload(client, "run.exe", b"MZ...", "application/octet-stream")
    assert response.status_code == 422
    assert "支持" in response.json()["detail"]


def test_nine_mb_attachment_passes_the_body_gate(client):
    """9 MB 附件必须真的传得上去（第 23 条验收「10 MB 的 PDF/Word 真能用」的回归点）。

    历史契约是「先撞全局 8 MB 请求体闸门」，于是 `accept` 里写着支持 PDF/Word、
    8–10 MB 的文件却在到端点之前就被中间件拒了，提示还与真实原因不符。
    附件路径现已单独放宽到 12 MB（`MAX_ATTACHMENT_UPLOAD_MB`），这条用例守住它。
    """
    response = _upload(client, "nine.txt", b"y" * (9 * 1024 * 1024), "text/plain")
    assert response.status_code == 200, response.text
    assert response.json()["file_id"]


def test_oversize_attachment_is_rejected_by_the_endpoint_not_the_middleware(client):
    """超过端点上限时，拒绝者必须是端点自己（不是中间件）。

    区分两者很重要：中间件拒会回「请求体过大，最大允许 N MB」，那说明放宽没生效；
    端点拒回「文件超过 50 MB，无法上传」，这才是设计里的行为。

    这里用 monkeypatch 把阈值调到 1 MB 再传 10.5 MB：**不**为了验证一条分支真的去
    构造 50 MB 请求体（那会让这条用例吃掉几百 MB 内存），但"谁拒的"这个判据完全等价。
    """
    from app.api import materials as materials_api

    monkeypatch_target = 1024 * 1024
    original = materials_api.MAX_MATERIAL_ATTACHMENT_BYTES
    materials_api.MAX_MATERIAL_ATTACHMENT_BYTES = monkeypatch_target
    try:
        response = _upload(
            client, "big.txt", b"x" * (10 * 1024 * 1024 + 200_000), "text/plain"
        )
    finally:
        materials_api.MAX_MATERIAL_ATTACHMENT_BYTES = original
    assert response.status_code == 413
    detail = response.json()["detail"]
    assert "文件超过 50 MB" in detail
    assert "请求体过大" not in detail


def test_endpoint_size_guard_uses_the_fifty_mb_limit(client):
    """资料箱附件上限已放宽到 50 MB（T02），且**不再**等于面试材料的 10 MB。

    两者刻意分开：面试材料链路仍然只收 10 MB（那条链路把整份文本塞进提示词），资料箱
    收的是扫描件原件，体积随页数线性增长。
    """
    from app.api import materials as materials_api
    from app.services.document_text import MAX_MATERIAL_FILE_BYTES

    assert materials_api.MAX_MATERIAL_ATTACHMENT_BYTES == 50 * 1024 * 1024
    assert materials_api.MAX_MATERIAL_ATTACHMENT_BYTES > MAX_MATERIAL_FILE_BYTES
    assert materials_api._ATTACHMENT_TOO_LARGE == "文件超过 50 MB，无法上传"


def test_attachment_between_ten_and_fifty_mb_is_actually_parsed(client):
    """10–50 MB 之间的一份材料必须真的能解析（T02 返工 1）。

    反证过的坑：端点已经放行 50 MB，但解析层 ``extract_material_text`` 里还留着
    10 MB 的硬闸门，于是 12 MB 的扫描件传完了却回一句"文件超过 10 MB，无法导入"。
    只断言常量大小（上面那条用例）抓不到这种"两道闸门各按各的"，必须真的走一遍上传。
    """
    # 造一份 >10 MB 的 PDF，但**不把正文写成 10 MB**：正文只留几行 TEXT_MARKER，
    # 体积靠 build_pdf(pad_bytes=…) 在内容流末尾追加的 PDF 注释填充。早先这里写的是
    # 13 MB 重复正文，pypdf 要抽 20 万次文本操作，单条用例 458 秒——把 CI 的两个作业
    # 顶过了 45 分钟上限。文件真的 >10 MB、正文真的抽得出，两个意图都还在。
    raw = build_pdf(" ".join([TEXT_MARKER] * 3), pad_bytes=11 * 1024 * 1024)
    assert len(raw) > document_text.MAX_MATERIAL_FILE_BYTES

    response = _upload(client, "big-scan.pdf", raw, "application/pdf")

    assert response.status_code == 200, response.text
    payload = response.json()
    assert payload["size_bytes"] == len(raw)
    assert "Backend engineer hiring note" in payload["text"]


def test_broken_pdf_returns_a_readable_reason(client):
    response = _upload(client, "broken.pdf", b"%PDF-1.4 broken", "application/pdf")
    assert response.status_code == 422
    assert "PDF" in response.json()["detail"]


# ===== material.files 里的 file_id + 历史附件只读反查 =====


def _create_material(client, files: list[dict]) -> dict:
    response = client.post(
        "/api/materials",
        json={"title": "附件测试", "files": files},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_file_id_round_trips_through_material_crud(client):
    upload = _upload(client, "接口治理结案.md", b"# " + TEXT_MARKER.encode(), "text/markdown")
    uploaded = upload.json()
    created = _create_material(
        client,
        [
            {
                "name": uploaded["name"],
                "mime_type": uploaded["mime_type"],
                "size_bytes": uploaded["size_bytes"],
                "text": uploaded["text"],
                "data_url": uploaded["data_url"],
                "file_id": uploaded["file_id"],
            }
        ],
    )
    assert created["files"][0]["file_id"] == uploaded["file_id"]

    detail = client.get(f"/api/materials/{created['id']}").json()
    assert detail["files"][0]["file_id"] == uploaded["file_id"]
    assert TEXT_MARKER in detail["files"][0]["text"]

    # 原件可从 user_file 原始内容接口取到（「另存为」走的就是它）。
    raw = client.get(f"/api/user-files/{uploaded['file_id']}/raw")
    assert raw.status_code == 200
    assert raw.content == b"# " + TEXT_MARKER.encode()


def test_historical_image_gets_file_id_only_in_the_response(client, db_session):
    """旧版只给图片存了副本、files 里没有 file_id：详情响应补上，但不写库。"""
    from app.services.material_files import save_file_copies as _save_file_copies

    legacy = Material(
        title="历史图片",
        files=[
            {
                "name": "历史截图.png",
                "mime_type": PNG_MIME,
                "size_bytes": len(PNG_1PX),
                "text": "",
                "data_url": data_url(PNG_1PX, PNG_MIME),
            }
        ],
    )
    db_session.add(legacy)
    db_session.commit()
    db_session.refresh(legacy)
    _save_file_copies(db_session, legacy)

    detail = client.get(f"/api/materials/{legacy.id}").json()
    file_id = detail["files"][0]["file_id"]
    assert file_id is not None
    assert file_id > 0

    # 只读：库里那份 JSON 仍然没有 file_id（下次还能按同一个逻辑再查）。
    db_session.expire_all()
    stored = db_session.get(Material, legacy.id)
    assert stored is not None
    assert stored.files[0].get("file_id") is None

    # 历史文本附件从来没有原件：保持 None（前端只显示「复制」）。
    legacy_text = Material(
        title="历史文本",
        files=[
            {"name": "笔记.md", "mime_type": "text/markdown", "size_bytes": 12, "text": "# 笔记"}
        ],
    )
    db_session.add(legacy_text)
    db_session.commit()
    db_session.refresh(legacy_text)
    detail_text = client.get(f"/api/materials/{legacy_text.id}").json()
    assert detail_text["files"][0]["file_id"] is None


def test_file_id_only_attachment_is_accepted_by_material_payload(client):
    """扫描件 PDF：没有 text、没有 data_url，只有 file_id 时也允许保存（可另存为）。"""
    upload = _upload(client, "扫描件2.pdf", build_pdf(blank=True), "application/pdf")
    uploaded = upload.json()
    created = _create_material(
        client,
        [
            {
                "name": uploaded["name"],
                "mime_type": "application/pdf",
                "size_bytes": uploaded["size_bytes"],
                "text": "",
                "data_url": "",
                "file_id": uploaded["file_id"],
            }
        ],
    )
    assert created["files"][0]["file_id"] == uploaded["file_id"]
