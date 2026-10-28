# SPDX-License-Identifier: Apache-2.0
"""「我的文件」里的内容——**全部经由别的功能入口产生**，不直接往资料箱塞附件。

资料箱的「我的文件」页签是 ``user_file`` 表的视图，而这张表由各功能在保存内容时顺带
落盘：个人照片、岗位备注截图、备选岗位截图、助手会话附件。所以这里只做两件事：

1. 造出真实的文件字节（照片、截图、PDF、DOCX），挂到**各自的业务对象**上；
2. 让 ``user_files.backfill_missing_copies()`` 在导出前把它们回填成副本。

这样做出来的清单与真实使用完全同构：每条文件都带得出"它是从哪来的"（source_type /
source_ref），而直接写 user_file 行只会得到一堆没有出处的孤儿文件。
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
    """把示例头像调一版（这是虚构卡通头像，不是真人照片）。"""
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
            "1. 负责会员生命周期增长与召回策略；",
            "2. 设计并复盘 A/B 实验；",
            "3. 搭建增长看板，统一指标口径；",
            "任职要求：",
            "1. 3 年以上用户增长或商业分析经验；",
            "2. 熟练 SQL，能独立取数；",
            "3. 做过完整的 AB 实验。",
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
    """一张"投递漏斗"截图（备选岗位/助手附件用）。"""

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
        stages = [("投递", 128, 620), ("初筛", 74, 520), ("面试", 32, 420), ("offer", 9, 320)]
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
            "转化率：投递→初筛 57.8% · 初筛→面试 43.2% · 面试→offer 28.1%",
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
            (90, 86), "认证证书" if has_cjk else "CERTIFICATE", fill=(120, 88, 30), font=title_font
        )
        canvas.text(
            (90, 156),
            "林知遥 女士：" if has_cjk else "Ms. Lin Zhiyao",
            fill=(30, 41, 59),
            font=body_font,
        )
        canvas.text(
            (90, 196),
            "已完成「阿里云数据分析师 ACP」全部考试科目，成绩合格。"
            if has_cjk
            else "has passed the ACP Data Analyst exam.",
            fill=(30, 41, 59),
            font=body_font,
        )
        canvas.text((90, 286), "证书编号：ACP-2023-77120", fill=(71, 85, 105), font=body_font)
        canvas.text(
            (90, 322),
            "发证日期：2023-11-18    有效期至：2026-11-18",
            fill=(71, 85, 105),
            font=body_font,
        )
        canvas.text(
            (470, 430),
            "Alibaba Cloud" if not has_cjk else "阿里云 认证中心",
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
    line("Portfolio - Growth Analytics", 18, bold=True, gap=10)
    pdf.set_text_color(110, 110, 110)
    line("Lin Zhiyao / zhiyao.lin@example.com / Shanghai", 10, gap=6)
    pdf.ln(3)
    pdf.set_text_color(20, 20, 20)

    sections = [
        (
            "Membership segmentation & win-back",
            [
                "- Segmented 1.86M members into 5 tiers by recency, frequency and AOV.",
                "- Quarterly reactivation moved from 8.1% to 12.4%, about CNY 2.1M incremental GMV.",
                "- Coupon cost down 23% by removing high-tier users from the incentive list.",
            ],
        ),
        (
            "Multi-channel attribution dashboard",
            [
                "- Rebuilt 7 channels into one event chain; last-click and linear attribution side by side.",
                "- Channel ROI ranking changed materially after aligning the definition.",
                "- Saved about 12 hours of manual reconciliation per month.",
            ],
        ),
    ]
    for title, bullets in sections:
        pdf.ln(3)
        line(title, 13, bold=True, gap=8)
        for bullet in bullets:
            line(bullet, 10)

    pdf.add_page()
    line("Experiment checklist", 13, bold=True, gap=8)
    for index, item in enumerate(
        [
            "Falsifiable hypothesis",
            "Sample size estimation",
            "Traffic split validation",
            "Metric definition",
            "Significance and effect size",
            "Guardrail metrics",
            "Ship / no-ship decision",
            "Post-launch tracking",
        ],
        start=1,
    ):
        line(f"{index}. {item}", 10)
    return bytes(pdf.output())


def _docx_bytes() -> bytes:
    """一份工作总结 DOCX（python-docx 是应用导出链路的既有依赖）。"""
    from docx import Document

    document = Document()
    document.add_heading("会员召回项目 · 工作小结", level=1)
    document.add_paragraph("时间：2024 年 3 月 - 2024 年 9 月    角色：项目负责人")
    document.add_heading("一、目标", level=2)
    document.add_paragraph("把原先全量发券的粗放召回，改成按生命周期分层的精细化召回。")
    document.add_heading("二、做法", level=2)
    for item in [
        "用最近购买、频次、客单与内容互动四组信号构造 5 层分层规则；",
        "每层先做 5% 抽样的小流量验证，再放量；",
        "高层级人群改发权益提醒，不发券。",
    ]:
        document.add_paragraph(item, style="List Bullet")
    document.add_heading("三、结果", level=2)
    document.add_paragraph("召回率 8.1% → 12.4%，增量 GMV 约 210 万元/季度，券成本下降 23%。")
    document.add_heading("四、遗留问题", level=2)
    document.add_paragraph("召回后 60 天的二次流失率仍有 41%，下一季度需要做召回后的承接动作。")
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
    """岗位备注截图：两条岗位各挂一张（其中一张是 JPG 的证书扫描件，换个 mime）。"""
    shots = {
        "商业分析师（用户方向）": _job_screenshot(
            "商业分析师（用户方向）", "28-42K", ["SQL", "经营分析", "会员"]
        ),
        "数据产品经理": _job_screenshot("数据产品经理", "30-45K", ["指标体系", "BI", "归因"]),
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
            "作品集-增长分析.pdf",
            "application/pdf",
            pdf,
            text="Portfolio - Growth Analytics（2 页）：会员分层召回、归因看板、实验检查清单。",
        ),
        _attachment(
            "会员召回工作小结.docx",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            docx,
            text="会员召回项目工作小结：目标、做法、结果（召回率 8.1%→12.4%）、遗留问题。",
        ),
        _attachment(
            "投递漏斗.png", "image/png", base64.b64decode(_funnel_chart().split(",", 1)[1])
        ),
    ]
    db.add(
        ChatMessage(
            conversation_id=conversation_id,
            role="user",
            content="帮我看看这份作品集和总结，投增长岗还缺什么？",
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
