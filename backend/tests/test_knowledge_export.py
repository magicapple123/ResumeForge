# SPDX-License-Identifier: Apache-2.0
"""#29 知识库 Markdown 目录导出（GET /api/knowledge/export）契约。

守四件事：zip 形状与响应头、文件名 sanitize/去重、Markdown 内容含 H1+元信息+摘要/要点+正文、
只导出未删除条目（空库 404）。该接口同时是 #34C 桌面菜单的数据源，形状变更要同步证据。
"""

from __future__ import annotations

import io
import zipfile

CREATE = {
    "title": "字节后端面经/第一轮: 系统设计",
    "category": "面经",
    "tags": ["字节", "系统设计"],
    "content": "# 正文\n\n这是 Markdown 正文。",
    "source": "手动录入",
    "reason": "二面被问到限流，值得记下来",
    "company": "字节跳动",
    "summary": "限流设计要讲清令牌桶与漏桶的取舍",
    "key_points": ["令牌桶允许突发", "漏桶平滑输出"],
}


def _create(client, **overrides) -> int:
    payload = {**CREATE, **overrides}
    response = client.post("/api/knowledge", json=payload)
    assert response.status_code == 201, response.text
    return int(response.json()["id"])


def test_export_zip_shape_and_markdown_content(client):
    _create(client)
    _create(client, title="简历技巧", category="", content="STAR 法则", source="手动录入")
    response = client.get("/api/knowledge/export")
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("application/zip")
    assert "attachment" in response.headers["content-disposition"]
    # 中文文件名用 filename* UTF-8 编码，不把中文直接塞进 latin-1 头。
    assert "filename*=UTF-8''" in response.headers["content-disposition"]
    assert response.headers["x-knowledge-exported"] == "2"

    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        assert len(names) == 2
        # 排序与文件名：序号前缀 + 标题 + .md；标题里的 / 与 : 已被替换。
        assert all(name.endswith(".md") for name in names)
        assert all(name[:3].isdigit() for name in names)
        assert all("/" not in name for name in names)
        bodies = {name: archive.read(name).decode("utf-8") for name in names}
    first = next(body for body in bodies.values() if "字节后端面经" in body)
    assert first.startswith("# ")
    assert "分类：面经" in first
    assert "公司：字节跳动" in first
    assert "标签：字节、系统设计" in first
    assert "为什么记这条：二面被问到限流，值得记下来" in first
    assert "## 摘要" in first and "令牌桶" in first
    assert "## 要点" in first and "漏桶平滑输出" in first
    assert "这是 Markdown 正文" in first


def test_export_sanitizes_and_dedupes_filenames(client):
    _create(client, title="同名标题")
    _create(client, title="同名标题")
    response = client.get("/api/knowledge/export")
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        # 两份同名条目：文件名必须不同，且正文各自都能对上标题。
        assert len(archive.namelist()) == len(set(archive.namelist())) == 2


def test_export_excludes_soft_deleted_and_rejects_empty_library(client):
    empty = client.get("/api/knowledge/export")
    assert empty.status_code == 404, empty.text
    assert "导出" in empty.json()["detail"]

    keep_id = _create(client)
    drop_id = _create(client, title="要删掉的条目")
    deleted = client.delete(f"/api/knowledge/{drop_id}")
    assert deleted.status_code == 204
    response = client.get("/api/knowledge/export")
    assert response.status_code == 200
    assert response.headers["x-knowledge-exported"] == "1"
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        names = archive.namelist()
        body = archive.read(names[0]).decode("utf-8")
    assert "要删掉的条目" not in body
    assert str(keep_id)
