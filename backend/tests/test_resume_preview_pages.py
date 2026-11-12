# SPDX-License-Identifier: Apache-2.0
"""精确预览的逐页位图端点（P3-2）：`POST …/preview-pages` + 两个 GET 的契约。

这一批把「精确预览」从"iframe 装浏览器 PDF 查看器"换成"服务端渲染 WebP + 前端逐页
`<img>`"。换掉的直接原因是那两条无用滚动条与纸边深色描边都画在**查看器自己的文档**里、
外层 CSS 够不到；顺带解决了无头 Chromium 截不出图（CI 盲区）。

本文件守五件事：

1. **位图就是导出产物**：页数与 `/preview-pdf` 的 `X-Resume-Pages` 一致，一页不多一页不少；
2. **分辨率口径**：`width × dpr × 2`，单页长边封顶 3000px（内存与清晰度的折中）；
3. **token 内容寻址**：同一组输入稳定复现；版式或内容一变 token 必变（否则前端会拿着旧图）；
4. **派生数据落临时目录**：不进数据集、不进备份；
5. **GET 能取回**：`{index}.webp` 是 image/webp，「在新标签打开」的 PDF 是同一份字节。
"""

from __future__ import annotations

import tempfile

import pytest
from app.services.resume import preview_pages as pages
from test_pdf_exporter import needs_font

PAGES = "/api/resumes/{id}/preview-pages"


def _a4_pdf(page_count: int = 3) -> bytes:
    """造一份 N 页 A4 PDF（纯色块，不依赖任何字体）。"""
    from fpdf import FPDF

    pdf = FPDF(unit="mm", format="A4")
    for index in range(page_count):
        pdf.add_page()
        pdf.set_fill_color(30, 60, 120)
        pdf.rect(10, 10 + index, 90, 20, style="F")
    return bytes(pdf.output())


def _webp_size(payload: bytes) -> tuple[int, int]:
    """WebP 的像素尺寸（VP8/VP8L/VP8X 三种容器的头都在固定偏移上）。"""
    assert payload[:4] == b"RIFF" and payload[8:12] == b"WEBP", "不是 WebP 容器"
    chunk = payload[12:16]
    if chunk == b"VP8 ":
        # 关键帧头：起始码 9D 01 2A 之后 2 字节宽、2 字节高（各 14 位保存）。
        return (
            int.from_bytes(payload[26:28], "little") & 0x3FFF,
            int.from_bytes(payload[28:30], "little") & 0x3FFF,
        )
    if chunk == b"VP8L":
        bits = int.from_bytes(payload[21:25], "little")
        return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
    # VP8X：24 位画布宽高减一。
    return (
        1 + int.from_bytes(payload[24:27], "little"),
        1 + int.from_bytes(payload[27:30], "little"),
    )


def test_bucket_width_and_dpr_are_stable_and_bounded():
    # #23 P3：桶宽 16 → 64。前端 `previewWidthBucket` 必须同值（两侧注释互相指向）。
    assert pages.WIDTH_BUCKET_PX == 64
    assert pages.bucket_width(900) == 960
    assert pages.bucket_width(900) == pages.bucket_width(897)
    # 相框宽 +1px 不再换桶：这就是 #23 里"912 → 913 重渲 3.9 秒"的那条根因。
    assert pages.bucket_width(912) == pages.bucket_width(913) == 960
    # 但跨桶仍必须换：961 越过 960 的上界，是另一张图。
    assert pages.bucket_width(960) != pages.bucket_width(961)
    # dpr 分桶 0.25 且夹在 [1, 3]：0.9 与 5 都要被夹回来。
    assert pages.bucket_dpr(1.26) == 1.25
    assert pages.bucket_dpr(0.9) == 1.0
    assert pages.bucket_dpr(5) == 3.0


def test_token_is_content_addressed():
    # 同一份字节只算一次：fpdf2 每次都会写新的 /CreationDate 与 /ID，两次生成不会字节相同。
    pdf_bytes = _a4_pdf(1)
    first = pages.page_token(pdf_bytes, width_px=900, dpr=1.0)
    assert first == pages.page_token(pdf_bytes, width_px=900, dpr=1.0)
    # 不同宽高桶（同一份字节）也必须换 token——分辨率不同就是另一张图。
    assert first != pages.page_token(pdf_bytes, width_px=1400, dpr=1.0)
    # 字节变了（多一页）同样要换。
    assert first != pages.page_token(_a4_pdf(2), width_px=900, dpr=1.0)


def test_renders_every_page_as_webp_with_capped_long_edge(tmp_path, monkeypatch):
    monkeypatch.setattr(pages, "cache_root", lambda: tmp_path)
    pdf_bytes = _a4_pdf(3)
    rendered = pages.render_preview_pages(pdf_bytes, width_px=900, dpr=1.0)

    assert rendered.page_count == 3
    assert [page.index for page in rendered.pages] == [0, 1, 2]
    for page in rendered.pages:
        payload = pages.page_path(rendered.token, page.index).read_bytes()
        assert _webp_size(payload) == (page.width, page.height)
        # A4 的高宽比（297/210）必须保住：前端按它折算 CSS 高。
        assert 1.40 < page.height / page.width < 1.43
        # 900 CSS 宽 → 桶 960 → × dpr 1.0 × 超采样 1.5 = 1440px 宽（#23 P1 之前是 1800）。
        assert 1420 <= page.width <= 1460
        assert max(page.width, page.height) <= pages.MAX_LONG_EDGE_PX
    # 「在新标签打开」要的 PDF 也在同一目录：同一份字节，GET 直接读。
    assert pages.pdf_path(rendered.token).read_bytes() == pdf_bytes


def test_long_edge_is_capped_at_3000px(tmp_path, monkeypatch):
    """高 dpr 时**必须**撞上长边封顶：否则 3 页 × 5400px 宽会把内存吃穿。

    900 CSS 宽 → 桶 960；960 × dpr 3 × 超采样 1.5 = 4320px 的目标宽度，A4 高宽比下会
    得到 ~6100px 高——远超上限。封顶后长边恒等于 3000，宽高比仍然必须是 A4（前端按它
    折算 CSS 高）。
    """
    monkeypatch.setattr(pages, "cache_root", lambda: tmp_path)
    rendered = pages.render_preview_pages(_a4_pdf(1), width_px=900, dpr=3.0)
    page = rendered.pages[0]

    assert max(page.width, page.height) == pages.MAX_LONG_EDGE_PX == 3000
    assert page.width < 960 * 3 * pages.RENDER_SUPERSAMPLE  # 目标宽度确实被收敛过，不是"刚好没触发"
    assert 1.40 < page.height / page.width < 1.43


def test_pages_render_in_parallel_with_one_pdf_handle_each(tmp_path, monkeypatch):
    """逐页并发（#23 P2）的两条契约：**页序不变** + **每页各开一份文档**。

    第二条不是风格问题：pypdfium2 的 `PdfDocument` 不是线程安全的，多线程共用一个对象
    会崩在 C 层——那不是能被捕获的 Python 异常，表现为进程直接消失。所以这里数
    `_open_document` 的调用次数（页数探针 1 次 + 每页 1 次），少一次就说明有共享。
    """
    monkeypatch.setattr(pages, "cache_root", lambda: tmp_path)
    opened: list[int] = []
    original = pages._open_document

    def counting(pdf_bytes: bytes):  # noqa: ANN202 - 转调原函数
        opened.append(1)
        return original(pdf_bytes)

    monkeypatch.setattr(pages, "_open_document", counting)
    rendered = pages.render_preview_pages(_a4_pdf(4), width_px=900, dpr=1.0)

    # 4 页全部出图，且顺序就是导出 PDF 的页序（线程完成顺序不参与结果排序）。
    assert [page.index for page in rendered.pages] == [0, 1, 2, 3]
    assert len(opened) == 1 + 4
    # 每页都真的落了盘：并发写不同文件，不会互相覆盖。
    for page in rendered.pages:
        assert pages.page_path(rendered.token, page.index).is_file()


def test_render_is_cached_by_token(tmp_path, monkeypatch):
    monkeypatch.setattr(pages, "cache_root", lambda: tmp_path)
    calls: list[int] = []
    original = pages._render_pages

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(pages, "_render_pages", counting)
    pdf_bytes = _a4_pdf(2)
    # 901 与 900 落进同一个宽度桶 → 必须命中同一份，一次光栅化都不该多跑。
    first = pages.render_preview_pages(pdf_bytes, width_px=900, dpr=1.0)
    second = pages.render_preview_pages(pdf_bytes, width_px=901, dpr=1.0)

    assert second.token == first.token
    assert len(calls) == 1


def test_atomic_write_cleans_up_the_part_file_on_failure(tmp_path, monkeypatch):
    """写失败时必须把 `.part` 临时文件清掉，且**原始异常不能被清理逻辑盖住**。

    这条直接压 `_write_atomic` 的 except 分支（SIM105 把它改成了
    `contextlib.suppress(OSError)`）：改错了会变成"目录里堆满半成品"或"异常被吞掉、
    调用方以为写成功了"——两种都不会被 happy path 的用例抓到。
    """

    def boom(src, dst):  # noqa: ANN001, ANN002 - 只用来制造失败
        raise OSError("磁盘满了")

    monkeypatch.setattr(pages.os, "replace", boom)
    target = tmp_path / "0.webp"
    with pytest.raises(OSError, match="磁盘满了"):
        pages._write_atomic(target, b"payload")

    assert not target.exists()
    assert list(tmp_path.glob("*.part")) == []  # 半成品没有留在目录里


def test_cache_root_lives_in_the_system_temp_dir():
    root = str(pages.cache_root())
    assert root.startswith(tempfile.gettempdir())


@needs_font
def test_endpoint_returns_pages_matching_the_preview_pdf(client):
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": "逐页位图",
            "content": {
                "name": "张三",
                "phone": "13800000000",
                "email": "zhangsan@example.com",
                "job_intent": "后端工程师",
                "summary": "三年后端开发经验。",
                "experience": [],
                "skills": [{"name": "Python", "level": "熟练"}],
            },
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    params = {"page_limit": 3, "format_config": {"page_padding": 14}}

    pdf = client.post(f"/api/resumes/{resume_id}/preview-pdf", json=params)
    assert pdf.status_code == 200, pdf.text
    listed = client.post(PAGES.format(id=resume_id), json={**params, "width": 900, "dpr": 1.5})
    assert listed.status_code == 200, listed.text
    body = listed.json()

    assert body["page_count"] == len(body["pages"]) == int(pdf.headers["X-Resume-Pages"])
    assert body["pages_needed"] == int(pdf.headers["X-Resume-Pages-Needed"])
    assert body["overflow"] == (pdf.headers["X-Resume-Overflow"] == "true")

    image = client.get(f"/api/resumes/{resume_id}/preview-pages/{body['token']}/0.webp")
    assert image.status_code == 200, image.text
    assert image.headers["content-type"] == "image/webp"
    assert image.headers["cache-control"].endswith("immutable")
    assert _webp_size(image.content) == (body["pages"][0]["width"], body["pages"][0]["height"])

    document = client.get(f"/api/resumes/{resume_id}/preview-pages/{body['token']}/document.pdf")
    assert document.status_code == 200, document.text
    assert document.headers["content-type"] == "application/pdf"
    assert document.headers["content-disposition"].startswith("inline;")
    assert document.content[:5] == b"%PDF-"

    # 改一个排版参数：版式变了，产物就变了，token 必须跟着变（前端的缓存键依赖它）。
    changed = client.post(
        PAGES.format(id=resume_id),
        json={**params, "format_config": {"page_padding": 20}, "width": 900, "dpr": 1.5},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["token"] != body["token"]

    # 缓存目录被回收 / 服务重启后，前端拿 404 会重新请求清单，而不是显示破图。
    missing = client.get(f"/api/resumes/{resume_id}/preview-pages/{'0' * 32}/0.webp")
    assert missing.status_code == 404


@needs_font
def test_same_request_renders_only_once(client, monkeypatch):
    """同一组输入第二次进来**一次光栅化都不该多跑**（清单命中即返回）。

    这是"拖回原值 / 在制作台与主预览之间来回切"的体验底线：命中时是 0ms，未命中要
    数百毫秒。计数点选在 `_render_pages`——它是"一趟光栅化"的唯一入口，在 HTTP 层计数
    只能说明收到了几个请求，问不到"到底渲没渲"。
    """
    created = client.post(
        "/api/resumes/manual",
        json={
            "title": "同一请求只渲一次",
            "content": {
                "name": "张三",
                "phone": "13800000000",
                "email": "zhangsan@example.com",
                "job_intent": "后端工程师",
                "summary": "三年后端开发经验。",
                "experience": [],
                "skills": [{"name": "Python", "level": "熟练"}],
            },
            "job_id": None,
        },
    )
    assert created.status_code == 201, created.text
    resume_id = created.json()["id"]
    body = {"page_limit": 3, "width": 900, "dpr": 1}

    calls: list[int] = []
    original = pages._render_pages

    def counting(*args, **kwargs):  # noqa: ANN002, ANN003 - 只数次数
        calls.append(1)
        return original(*args, **kwargs)

    monkeypatch.setattr(pages, "_render_pages", counting)
    first = client.post(PAGES.format(id=resume_id), json=body)
    second = client.post(PAGES.format(id=resume_id), json=body)

    assert first.status_code == second.status_code == 200
    # 缓存键含内容指纹 + 渲染配置指纹（token 由 PDF 实际字节算出）：同一组参数 → 同一 token。
    assert first.json()["token"] == second.json()["token"]
    assert len(calls) == 1

    # 版式一变，PDF 就变、token 必变（否则前端会拿着旧图当新版式）。
    changed = client.post(
        PAGES.format(id=resume_id),
        json={**body, "format_config": {"page_padding": 20}},
    )
    assert changed.status_code == 200, changed.text
    assert changed.json()["token"] != first.json()["token"]
    assert len(calls) == 2


def test_endpoint_rejects_unknown_body_fields(client):
    """`width`/`dpr` 之外多写字段一律 422（父类的 `extra="forbid"` 必须继承下来）。"""
    response = client.post(PAGES.format(id=1), json={"width": 900, "nope": 1})
    assert response.status_code == 422


@pytest.mark.parametrize(
    "token",
    [
        "..",
        "../..",
        "..%2f..",
        "%2e%2e%2f",
        "/etc/passwd",
        "A" * 32,  # 大写十六进制：token 只可能是小写
        "0123456789abcdef0123456789abcdef/../x",
        "0" * 31,  # 长度不足
        "g" * 32,  # 非十六进制
    ],
)
def test_lookup_never_leaves_the_cache_root(tmp_path, monkeypatch, token):
    """token 只是"要找的目录名"，任何形状都不许被解释成路径。

    CodeQL 的 `py/path-injection` 盯着这两条 GET：它们把请求参数交给文件系统。这里钉住
    实现口径——白名单匹配（`_find_bundle`），不做"校验后拼路径"。哪怕缓存根外真的存在
    同名文件，也必须拿不到。
    """
    root = tmp_path / "cache"
    (root / "real").mkdir(parents=True)
    decoy = tmp_path / "secret.pdf"
    decoy.write_bytes(b"%PDF-1.4 decoy")

    monkeypatch.setattr(pages, "cache_root", lambda: root)

    assert pages.lookup_page(token, 0) is None
    assert pages.lookup_pdf(token) is None


def test_lookup_finds_a_real_bundle_and_404s_otherwise(tmp_path, monkeypatch, client):
    """白名单查找仍然要命中真实缓存；不存在的 token 与越界 index 都是 404。"""
    root = tmp_path / "cache"
    token = "a" * 32
    bundle = root / token
    bundle.mkdir(parents=True)
    (bundle / "0.webp").write_bytes(b"RIFF")
    (bundle / "document.pdf").write_bytes(b"%PDF-1.4")

    monkeypatch.setattr(pages, "cache_root", lambda: root)

    assert pages.lookup_page(token, 0) == bundle / "0.webp"
    assert pages.lookup_pdf(token) == bundle / "document.pdf"
    assert pages.lookup_page(token, 9) is None

    assert client.get(f"{PAGES.format(id=1)}/{token}/0.webp").status_code == 200
    assert client.get(f"{PAGES.format(id=1)}/{token}/9.webp").status_code == 404
    assert client.get(f"{PAGES.format(id=1)}/{token}/document.pdf").status_code == 200
    assert client.get(f"{PAGES.format(id=1)}/{'b' * 32}/document.pdf").status_code == 404
