# SPDX-License-Identifier: Apache-2.0
"""「我的文件」里的内容——**全部经由别的功能入口产生**，不直接往资料箱塞附件。

资料箱的「我的文件」页签是 ``user_file`` 表的视图，而这张表由各功能在保存内容时顺带
落盘：个人照片、岗位备注截图、备选岗位截图、助手会话附件。所以这里只做两件事：

1. 造出真实的文件字节（照片、截图、PDF、DOCX），挂到**各自的业务对象**上；
2. 让 ``user_files.backfill_missing_copies()`` 在导出前把它们回填成副本。

这样做出来的清单与真实使用完全同构：每条文件都带得出"它是从哪来的"（source_type /
source_ref），而直接写 user_file 行只会得到一堆没有出处的孤儿文件。

⚠️ 岗位备注截图按**岗位标题**反查（``select(Job).where(Job.title == ...)``），
标题必须逐字出现在 ``jobs.py`` 里，否则那一张图会被静默跳过（不报错，但少图）。
"""

from __future__ import annotations

import base64
import io
from datetime import timedelta
from pathlib import Path

from app.database import SessionLocal, engine
from app.models.assistant import ChatMessage
from app.models.job import Job
from app.models.material import CandidateJob
from app.models.referral import Referral
from app.schemas.photo import ProfilePhotoCreate
from app.services.profile import profile_photos
from app.services.resume.resume_sample_photo import SAMPLE_PHOTO_DATA_URL
from app.services.user_files import save_from_data_url
from PIL import Image, ImageDraw, ImageEnhance
from sqlalchemy import select

from dataset_seed.base import NOW, cjk_font, png_data_url


def _photo_variant(brightness: float, width: int = 240, height: int = 320) -> str:
    """把示例头像调一版（这是卡通头像，不是真人照片）。"""
    raw = base64.b64decode(SAMPLE_PHOTO_DATA_URL.split(",", 1)[1])
    image = Image.open(io.BytesIO(raw)).convert("RGB").resize((width, height), Image.LANCZOS)
    image = ImageEnhance.Brightness(image).enhance(brightness)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=88, optimize=True)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def _job_screenshot(title: str, salary: str, tags: list[str]) -> str:
    """一张"招聘 App 岗位详情"的截图（岗位备注用）。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        title_font, has_cjk = cjk_font(24)
        body_font, _ = cjk_font(16)
        small_font, _ = cjk_font(13)
        canvas.rectangle([0, 0, 759, 499], outline=(226, 232, 240))
        canvas.rectangle([0, 0, 759, 64], fill=(22, 54, 92))
        canvas.text(
            (24, 20), title if has_cjk else "Job detail", fill=(255, 255, 255), font=title_font
        )
        canvas.text((24, 84), salary, fill=(200, 60, 60), font=body_font)
        for index, tag in enumerate(tags):
            x = 24 + index * 108
            canvas.rounded_rectangle([x, 124, x + 96, 156], radius=6, fill=(238, 242, 247))
            canvas.text((x + 10, 130), tag, fill=(51, 65, 85), font=small_font)
        lines = [
            "岗位职责：",
            "1. 负责 Agent 工具层与编排层开发；",
            "2. 设计工具参数结构与失败重试策略；",
            "3. 维护评测集与离线评测流程；",
            "任职要求：",
            "1. 2027 届本科及以上，计算机相关专业；",
            "2. 熟悉 Python 与 FastAPI；",
            "3. 理解 function calling 与 RAG 的常见失败模式。",
        ]
        for index, line in enumerate(lines):
            canvas.text(
                (24, 180 + index * 32),
                line if has_cjk else line[:40],
                fill=(30, 41, 59),
                font=body_font,
            )
        canvas.text((24, 456), "截图时间 2026-10-26 21:14", fill=(148, 163, 184), font=small_font)

    return png_data_url(760, 500, draw)


def _funnel_chart() -> str:
    """一张"投递漏斗"截图（备选岗位/助手附件用），数字与 12 条进度记录同量级。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        title_font, has_cjk = cjk_font(20)
        body_font, _ = cjk_font(14)
        canvas.text(
            (24, 18),
            "投递漏斗（近 6 个月）" if has_cjk else "Application funnel",
            fill=(15, 23, 42),
            font=title_font,
        )
        stages = [("投递", 42, 620), ("初筛", 26, 520), ("面试", 12, 420), ("offer", 3, 320)]
        for index, (label, value, width) in enumerate(stages):
            top = 80 + index * 80
            left = 40 + (620 - width) // 2
            canvas.rounded_rectangle(
                [left, top, left + width, top + 56],
                radius=8,
                fill=(22, 54, 92) if index < 2 else (37, 99, 135),
            )
            canvas.text(
                (left + 16, top + 18), f"{label}  {value}", fill=(255, 255, 255), font=body_font
            )
        canvas.text(
            (40, 412),
            "转化率：投递→初筛 61.9% · 初筛→面试 46.2% · 面试→offer 25.0%",
            fill=(71, 85, 105),
            font=body_font,
        )

    return png_data_url(720, 460, draw)


def _certificate_image() -> str:
    """一张证书扫描件（JPG，用来覆盖 image/jpeg 类型）。"""

    def draw(image) -> None:
        canvas = ImageDraw.Draw(image)
        title_font, has_cjk = cjk_font(30)
        body_font, _ = cjk_font(17)
        canvas.rectangle([30, 30, 769, 529], outline=(180, 142, 62), width=4)
        canvas.rectangle([46, 46, 753, 513], outline=(214, 186, 120), width=1)
        canvas.text(
            (90, 86), "资格证书" if has_cjk else "CERTIFICATE", fill=(120, 88, 30), font=title_font
        )
        canvas.text(
            (90, 156),
            "沈亦舟 先生：" if has_cjk else "Mr. Shen Yizhou",
            fill=(30, 41, 59),
            font=body_font,
        )
        canvas.text(
            (90, 196),
            "已通过「软件设计师（软考中级）」全部考试科目，成绩合格。"
            if has_cjk
            else "has passed the Software Designer (Intermediate) exam.",
            fill=(30, 41, 59),
            font=body_font,
        )
        canvas.text((90, 286), "证书编号：RK-2026-054271", fill=(71, 85, 105), font=body_font)
        canvas.text(
            (90, 322),
            "发证日期：2026-05-16    有效期：长期有效",
            fill=(71, 85, 105),
            font=body_font,
        )
        canvas.text(
            (470, 430),
            "MIIT" if not has_cjk else "工业和信息化部教育与考试中心",
            fill=(120, 88, 30),
            font=body_font,
        )

    return png_data_url(800, 560, draw, fmt="JPEG")


def _pdf_bytes() -> bytes:
    """一份两页的作品集 PDF（用应用已依赖的 fpdf2 生成，不是伪造的字节）。"""
    from fpdf import FPDF

    pdf = FPDF()
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    def line(text: str, size: int = 10, *, bold: bool = False, gap: int = 6) -> None:
        pdf.set_font("Helvetica", "B" if bold else "", size)
        pdf.set_x(pdf.l_margin)
        pdf.multi_cell(pdf.epw, gap, text)
        pdf.ln(1)

    pdf.set_text_color(20, 20, 20)
    line("Portfolio - Backend & AI Agent", 18, bold=True, gap=10)
    pdf.set_text_color(110, 110, 110)
    line("Yizhou Shen / shen.yizhou@foxmail.com / Nanjing", 10, gap=6)
    pdf.ln(3)
    pdf.set_text_color(20, 20, 20)

    sections = [
        (
            "Trading API performance (internship, 2026.07-2026.10)",
            [
                "- Two-level cache on order detail: hit rate 43% to 91%, origin QPS 1800 to 160.",
                "- p95 from 380 ms to 95 ms; 2.1M requests served per day.",
                "- 17 full-table scans fixed with EXPLAIN and 4 composite indexes; slow queries "
                "from 23K to 900 per day.",
                "- Statement export moved to async task: timeout error rate 8.4% to 0.2%.",
            ],
        ),
        (
            "Agent tool layer (internship, 2026.01-2026.05)",
            [
                "- 9 function tools with JSON Schema validation and one retry: success 79% to 94%.",
                "- Built a 160-case eval set; 21 regressions caught before release in three months.",
                "- Heading-aware chunking plus BM25/vector fusion: Recall@5 from 61% to 84%.",
            ],
        ),
    ]
    for title, bullets in sections:
        pdf.ln(3)
        line(title, 13, bold=True, gap=8)
        for bullet in bullets:
            line(bullet, 10)

    pdf.add_page()
    line("Agent eval checklist", 13, bold=True, gap=8)
    for index, item in enumerate(
        [
            "Failure type is labelled (wrong tool / hallucinated args / loop / gave up)",
            "Eval cases cover long-tail tools, not only the ones I changed",
            "Ground truth reviewed by a second person",
            "Tool-call success counted per call, not per conversation",
            "Retry limit and timeout set explicitly",
            "Fallback path works when the tool keeps failing",
            "Latency p95 recorded together with success rate",
            "Regression run before every release",
        ],
        start=1,
    ):
        line(f"{index}. {item}", 10)
    return bytes(pdf.output())


def _docx_bytes() -> bytes:
    """一份工作总结 DOCX（python-docx 是应用导出链路的既有依赖）。"""
    from docx import Document

    document = Document()
    document.add_heading("订单接口治理 · 工作小结", level=1)
    document.add_paragraph("时间：2026 年 7 月 - 2026 年 10 月    角色：后端开发实习生")
    document.add_heading("一、目标", level=2)
    document.add_paragraph("把订单详情接口的 P95 压到 100 ms 以内，并治理掉积压的慢查询。")
    document.add_heading("二、做法", level=2)
    for item in [
        "两级缓存：Redis 兜跨实例，进程内 LRU 扛最热的少量 key；",
        "空值与高基数 key 单独处理，避免被刷穿；",
        "EXPLAIN 逐条过慢查询，补 4 个联合索引、改写 3 个深分页语句；",
        "对账导出改成 Celery 异步任务，前端轮询进度。",
    ]:
        document.add_paragraph(item, style="List Bullet")
    document.add_heading("三、结果", level=2)
    document.add_paragraph(
        "P95 380 ms → 95 ms，命中率 43% → 91%，慢查询日均 2.3 万 → 900 条，"
        "对账导出 42 s → 6 s，超时错误率 8.4% → 0.2%。"
    )
    document.add_heading("四、遗留问题", level=2)
    document.add_paragraph("报表类长事务仍占慢查询的七成，需要拆到离线链路；缓存一致性靠 TTL 兜底，后续考虑订阅 binlog。")
    buffer = io.BytesIO()
    document.save(buffer)
    return buffer.getvalue()


def seed() -> None:
    """把照片 / 截图 / PDF / DOCX 挂到各自的业务对象上（副本由回填生成）。"""
    with SessionLocal() as db:
        _seed_photos(db)
        _seed_job_notes(db)
        _seed_candidate_images(db)
        _seed_chat_attachment(db)
        _seed_referral_image(db)


def _seed_photos(db) -> None:
    """个人照片：两张（一张日常、一张证件照），第一张自动成为主照片。"""
    for index, (name, brightness) in enumerate([("日常照片", 1.0), ("证件照", 1.08)]):
        image = _photo_variant(brightness)
        photo = profile_photos.add_photo(db, ProfilePhotoCreate(name=name, image=image))
        save_from_data_url(
            db,
            image,
            source_type="photo",
            source_ref=f"profile_photo:{photo.id}",
            fallback_name=f"{name}-{index + 1}.jpg",
        )


def _seed_job_notes(db) -> None:
    """岗位备注截图：两条岗位各挂一张（标题必须与 jobs.py 里的岗位名逐字一致）。"""
    shots = {
        "AI Agent 开发工程师（校招）": _job_screenshot(
            "AI Agent 开发工程师（校招）", "22-35K·14薪", ["Python", "Agent", "评测"]
        ),
        "大模型应用开发工程师（校招）": _job_screenshot(
            "大模型应用开发工程师（校招）", "24-38K·15薪", ["LLM", "RAG", "FastAPI"]
        ),
    }
    for title, image in shots.items():
        job = db.execute(select(Job).where(Job.title == title)).scalar_one_or_none()
        if job is not None:
            job.note_images = [image]
    db.commit()


def _seed_candidate_images(db) -> None:
    """备选岗位截图：两条（一张漏斗图、一张证书图），来源标成图片识别。"""
    candidates = db.execute(select(CandidateJob).order_by(CandidateJob.id)).scalars().all()
    images = [_funnel_chart(), _certificate_image()]
    for candidate, image in zip(candidates[:2], images, strict=False):
        candidate.images = [image]
        if candidate.source == "手动添加":
            candidate.source = "图片识别"
    db.commit()


def _attachment(name: str, mime: str, payload: bytes, *, text: str = "") -> dict:
    """消息附件的存储形态：data URL + 元信息（回填按 ``data_url`` 落盘）。

    ``kind`` 是读取侧必填项（text / image / document）。图片给 ``data_url`` 供预览；
    文档同时给 ``text``（本地提取的正文）与 ``data_url``（本机副本，供「我的文件」下载），
    两者在真实使用里也是并存的两份东西。
    """
    if mime.startswith("image/"):
        kind = "image"
    elif text:
        kind = "document"
    else:
        kind = "text"
    return {
        "name": name,
        "mime_type": mime,
        "kind": kind,
        "size_bytes": len(payload),
        "text": text,
        "data_url": f"data:{mime};base64," + base64.b64encode(payload).decode("ascii"),
        "notes": [],
    }


def _seed_chat_attachment(db) -> None:
    """助手会话附件：一条消息里带 PDF、DOCX、PNG 三种类型。"""
    conversation_id = db.execute(select(ChatMessage.conversation_id).limit(1)).scalar_one_or_none()
    if conversation_id is None:
        return
    pdf, docx = _pdf_bytes(), _docx_bytes()
    attachments = [
        _attachment(
            "作品集-后端与Agent.pdf",
            "application/pdf",
            pdf,
            text="Portfolio - Backend & AI Agent（2 页）：接口性能治理、Agent 工具层、评测清单。",
        ),
        _attachment(
            "接口治理工作小结.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docx,
            text="订单接口治理小结：目标、做法、结果（P95 380→95 ms、慢查询 2.3 万→900 条）、遗留问题。",
        ),
        _attachment(
            "投递漏斗.png", "image/png", base64.b64decode(_funnel_chart().split(",", 1)[1])
        ),
    ]
    db.add(
        ChatMessage(
            conversation_id=conversation_id,
            role="user",
            content="帮我看看这份作品集和总结，投后端岗还缺什么？",
            attachments=attachments,
            context={},
            status="complete",
            error="",
            model="",
            created_at=NOW - timedelta(days=1, hours=4),
        )
    )
    db.commit()


def _seed_referral_image(db) -> None:
    """内推备注截图：这条走磁盘文件（``referral_images/<文件名>``），不是 data URL。"""
    referral = db.execute(select(Referral).order_by(Referral.id)).scalars().first()
    if referral is None:
        return
    directory = Path(engine.url.database or "").resolve().parent / "referral_images"
    directory.mkdir(parents=True, exist_ok=True)
    name = "内推码截图.png"
    payload = _funnel_chart().split(",", 1)[1]
    (directory / name).write_bytes(base64.b64decode(payload))
    referral.note_images = [f"referral_images/{name}"]
    db.commit()
