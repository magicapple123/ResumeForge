# SPDX-License-Identifier: Apache-2.0
"""W04 最终交付配置预览 + W16 变体导出/预览（be-export task-9）。

覆盖三组真实行为：

1. **W04 水印/脱敏预览**：``PreviewPdfRequest`` 收下 watermark/redact/redact_options 后，
   预览走的仍是同一条导出管线（脱敏前置、水印后叠加），产物真的变了；但"预览不是导出"
   的三条性质不变——不写副本、不冻结交付、不推进 revision。
2. **W16 变体快照**：``variant_id`` 由 ``document_variants.resolve_variant_export`` 解析
   （be-prov 契约；本文件用 mock 证明路由确实**按名调用**它），导出/预览用变体的内容 +
   版式快照，不读当前记录正文；非法/跨简历 variant 一律 4xx。
3. **单格式导出的交付一致性**：变体导出的 ``X-Content-Sha256`` 是产物字节指纹（与预览
   同一口径），且导出不动记录内容 / revision。
"""

from __future__ import annotations

import hashlib
import io
import json
import zipfile

from app.database import SessionLocal
from app.models.resume_delivery import ResumeDeliveryRecord
from app.services.settings_service import save_export_save_location
from test_pdf_exporter import _text_runs, needs_font
from tests.document_test_support import values

PREVIEW = "/api/resumes/{id}/preview-pdf"
EXPORT = "/api/resumes/{id}/export"
BUNDLE = "/api/resumes/{id}/export-bundle"


def _content(summary: str = "BASE-A") -> dict:
    return {
        "name": "张三",
        "phone": "13800000000",
        "email": "zhangsan@example.com",
        "job_intent": "后端工程师",
        "summary": summary,
        "experience": [
            {
                "id": "expobj0001",
                "company": "示例科技有限公司",
                "role": "后端实习生",
                "description": ["负责合成数据接口"],
            }
        ],
    }


def _create_resume(client, summary: str = "BASE-A") -> int:
    response = client.post(
        "/api/resumes/manual", json={"title": "预览配置测试", "content": _content(summary)}
    )
    assert response.status_code in (200, 201), response.text
    return int(response.json()["id"])


def _delivery_count() -> int:
    with SessionLocal() as db:
        return db.query(ResumeDeliveryRecord).count()


def _text(content: bytes) -> str:
    return " ".join(run[3] for run in _text_runs(content))


def _preview(client, resume_id: int, **body):
    return client.post(PREVIEW.format(id=resume_id), json=body)


def _export(client, resume_id: int, **body):
    return client.post(EXPORT.format(id=resume_id), json=body)


def _create_version_and_variant(client, resume_id: int) -> int:
    """先拍 BASE-A 的命名版本，把记录改成 CURRENT-B，再从版本派生变体（内容仍是 BASE-A）。"""
    created = client.post(f"/api/resumes/{resume_id}/versions", json={"name": "回滚点"})
    assert created.status_code == 201, created.text
    version_id = int(created.json()["id"])
    saved = client.put(f"/api/resumes/{resume_id}", json=_content("CURRENT-B"))
    assert saved.status_code == 200, saved.text
    variant = client.post(
        f"/api/resumes/{resume_id}/variants",
        json={"name": "后端变体", "base_version_id": version_id},
    )
    assert variant.status_code == 201, variant.text
    return int(variant.json()["id"])


# ===== W04：水印 / 脱敏预览 =====


@needs_font
def test_preview_applies_watermark_without_any_export_side_effect(client, tmp_path):
    resume_id = _create_resume(client)
    with SessionLocal() as db:
        save_export_save_location(db, str(tmp_path))
        db.commit()
    before_deliveries = _delivery_count()
    before_revision = client.get(f"/api/resumes/{resume_id}").json()["revision"]

    plain = _preview(client, resume_id, page_limit=1)
    marked = _preview(client, resume_id, page_limit=1, watermark="内部资料")

    assert plain.status_code == 200, plain.text
    assert marked.status_code == 200, marked.text
    assert "内部资料" not in _text(plain.content)
    assert "内部资料" in _text(marked.content)
    assert marked.content != plain.content
    # 预览三性质：内联 no-store、不写副本、不冻结交付、不动 revision。
    assert marked.headers["Cache-Control"] == "no-store"
    assert marked.headers["Content-Disposition"].startswith("inline;")
    assert "X-Saved-To" not in marked.headers
    assert list(tmp_path.iterdir()) == []
    assert _delivery_count() == before_deliveries
    assert client.get(f"/api/resumes/{resume_id}").json()["revision"] == before_revision


@needs_font
def test_preview_redacts_identity_fields_and_honours_options(client):
    resume_id = _create_resume(client)
    plain = _preview(client, resume_id, page_limit=1)
    redacted = _preview(client, resume_id, page_limit=1, redact=True)

    assert plain.status_code == redacted.status_code == 200
    plain_text = _text(plain.content)
    redacted_text = _text(redacted.content)
    assert "13800000000" in plain_text
    assert "13800000000" not in redacted_text
    assert "zhangsan@example.com" in plain_text
    assert "zhangsan@example.com" not in redacted_text
    assert redacted.content != plain.content

    # redact_options 真的被透传：关掉手机号遮罩后手机号保留、姓名仍被遮。
    custom = _preview(
        client, resume_id, page_limit=1, redact=True, redact_options={"mask_phone": False}
    )
    assert custom.status_code == 200, custom.text
    custom_text = _text(custom.content)
    assert "13800000000" in custom_text
    assert "张三" not in custom_text


@needs_font
def test_preview_still_rejects_export_only_envelope_fields(client):
    """W04 只放开 watermark/redact；``format``/``record_delivery`` 仍是导出专有，schema 层 422。"""
    resume_id = _create_resume(client)
    for payload in (
        {"page_limit": 1, "format": "html"},
        {"page_limit": 1, "record_delivery": True},
    ):
        response = _preview(client, resume_id, **payload)
        assert response.status_code == 422, f"{payload} 应当被拒：{response.text}"


# ===== W16：变体导出 / 预览 =====


def test_export_uses_variant_content_snapshot(client):
    resume_id = _create_resume(client)
    variant_id = _create_version_and_variant(client, resume_id)
    before = client.get(f"/api/resumes/{resume_id}").json()

    response = _export(client, resume_id, format="md", variant_id=variant_id)

    assert response.status_code == 200, response.text
    text = response.content.decode("utf-8")
    assert "BASE-A" in text, text[:500]
    assert "CURRENT-B" not in text
    # 单格式导出的交付指纹就是产物字节；与预览同一口径。
    assert response.headers["X-Content-Sha256"] == hashlib.sha256(response.content).hexdigest()
    after = client.get(f"/api/resumes/{resume_id}").json()
    assert values(after["content"]) == values(before["content"])
    assert after["revision"] == before["revision"]


@needs_font
def test_preview_uses_variant_content_snapshot(client):
    resume_id = _create_resume(client)
    variant_id = _create_version_and_variant(client, resume_id)

    plain = _preview(client, resume_id, page_limit=1)
    variant = _preview(client, resume_id, page_limit=1, variant_id=variant_id)

    assert plain.status_code == 200, plain.text
    assert variant.status_code == 200, variant.text
    assert variant.content != plain.content
    assert "BASE-A" in _text(variant.content)
    assert "CURRENT-B" not in _text(variant.content)
    assert variant.headers["Cache-Control"] == "no-store"


def test_export_unknown_variant_is_404(client):
    resume_id = _create_resume(client)
    response = _export(client, resume_id, format="md", variant_id=99999)
    assert response.status_code == 404, response.text


@needs_font
def test_preview_unknown_variant_is_404(client):
    resume_id = _create_resume(client)
    response = _preview(client, resume_id, page_limit=1, variant_id=99999)
    assert response.status_code == 404, response.text


def test_export_calls_the_provider_resolver_by_name(client, monkeypatch):
    """be-prov 的 resolve_variant_export 是唯一解析入口：路由必须**按名调用**它。"""
    resume_id = _create_resume(client)
    from app.services.resume import document_variants

    calls: list[tuple[int, int]] = []

    def fake_resolve_export(db, record, variant_id):  # noqa: ANN001 - 模拟契约签名
        calls.append((int(getattr(record, "id", record)), int(variant_id)))
        return {"content": _content("MOCK-VARIANT"), "layout": {}}

    monkeypatch.setattr(
        document_variants, "resolve_variant_export", fake_resolve_export, raising=False
    )
    response = _export(client, resume_id, format="md", variant_id=42)

    assert response.status_code == 200, response.text
    assert "MOCK-VARIANT" in response.content.decode("utf-8")
    assert calls == [(resume_id, 42)]


def test_export_maps_provider_version_not_found_to_404(client, monkeypatch):
    resume_id = _create_resume(client)
    from app.services.resume import document_variants

    def explode(db, record, variant_id):  # noqa: ANN001 - 模拟契约签名
        raise document_variants.VersionNotFound("岗位变体不存在")

    monkeypatch.setattr(document_variants, "resolve_variant_export", explode, raising=False)
    response = _export(client, resume_id, format="md", variant_id=7)
    assert response.status_code == 404, response.text


# ===== W16：成套导出（ExportBundleRequest.variant_id）=====


def test_bundle_uses_variant_content_snapshot(client):
    resume_id = _create_resume(client)
    variant_id = _create_version_and_variant(client, resume_id)

    response = client.post(
        BUNDLE.format(id=resume_id),
        json={"formats": ["md"], "variant_id": variant_id},
    )

    assert response.status_code == 200, response.text
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["variant_id"] == variant_id
    member = next(name for name in archive.namelist() if name.endswith(".md"))
    text = archive.read(member).decode("utf-8")
    assert "BASE-A" in text
    assert "CURRENT-B" not in text
    assert manifest["snapshot"]["content_sha256"]
    # 变体快照的产物也带真实资源清单（W19）：字体/渲染器/模板都不为空。
    item = manifest["files"][0]
    assert item["font"]["font_scale"] == "standard"
    assert item["renderer"]["app_version"]
    assert item["template"]


def test_bundle_unknown_variant_is_4xx(client):
    resume_id = _create_resume(client)
    response = client.post(
        BUNDLE.format(id=resume_id), json={"formats": ["md"], "variant_id": 99999}
    )
    assert 400 <= response.status_code < 500, response.text
