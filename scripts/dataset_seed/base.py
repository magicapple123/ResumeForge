# SPDX-License-Identifier: Apache-2.0
"""测试数据集的写库底座：引擎、批量插入、时间锚点、JD 关键词推导。

⚠️ 与 ``scripts/demo_data/base.py`` 同一条纪律：本模块必须在入口文件设好
``DATABASE_URL`` **之后**才被导入（``app.config`` 在导入时就把地址缓存成单例）。
入口只有 ``scripts/seed_test_dataset.py`` 一个，它负责先解析参数、再导入。
"""

from __future__ import annotations

import base64
import io
import os
from datetime import datetime

from app.database import Base, engine
from app.database_migrations import run_database_migrations
from app.services.jd_parser import parse_jd
from sqlalchemy import insert

# 数据集里的"现在"。固定值而不是 now()：提醒的逾期/今天/未来分布、看板的月份区间
# 都要稳定，同一份脚本每次跑出来的库才可比。
NOW = datetime(2026, 10, 28, 9, 0, 0)

T = Base.metadata.tables


def upgrade_schema() -> None:
    """用真实的 Alembic 链建表，而不是 ``create_all``。

    备份包的清单要声明 ``alembic_revision``，导入侧会拿它与包内库的
    ``alembic_version`` 逐字比对；用 ``create_all`` 建出来的库没有这张表，
    清单与实际内容就对不上（或者被当成"旧库"重新跑一遍迁移）。
    """
    run_database_migrations(engine, backup=False)


def row(**kw: object) -> dict:
    return kw


def ins(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(insert(T[table]), rows)


def keywords_of(job: dict) -> list[dict]:
    """用应用自己的 JD 解析器生成技能标签，避免手写一份与词表不一致的。"""
    text = "\n".join(
        [
            str(job.get("description") or ""),
            str(job.get("requirements") or ""),
            str(job.get("additional_info") or ""),
        ]
    )
    return [tag.model_dump() for tag in parse_jd(text)["skills"]]


# 岗位来源（用户可见的 origin_source）→ recognition_source。取值必须落在
# ``schemas/job.py`` 的 RECOGNITION_SOURCES 白名单里，否则读取侧会整列表 500。
_COLLECTED_SOURCES = {"BOSS直聘", "智联招聘", "猎聘", "拉勾", "招聘网站"}


def recognition_source_of(job: dict) -> str:
    source = str(job.get("source") or "")
    if source == "公司官网":
        return "官网采集"
    return "岗位采集" if source in _COLLECTED_SOURCES else "手动填写"


def png_data_url(width: int, height: int, draw: object, *, fmt: str = "PNG") -> str:
    """把一张 Pillow 画布编码成 data URL（照片/备注图/资料附件的合法形态）。

    走 Pillow 而不是内嵌一张 base64 常量：生成的图与正文里的数字对得上
    （渠道转化率那几条柱子就是 persona 里写的比例），也不会让脚本里出现
    一大段无法审阅的字符。
    """
    from PIL import Image

    image = Image.new("RGB", (width, height), (255, 255, 255))
    draw(image)  # type: ignore[operator]
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, optimize=True, **({"quality": 88} if fmt == "JPEG" else {}))
    mime = "image/jpeg" if fmt == "JPEG" else "image/png"
    encoded = base64.b64encode(buffer.getvalue()).decode("ascii")
    return f"data:{mime};base64,{encoded}"


# Pillow 自带字体不含中文，直接画「渠道」会得到一排方框。按平台找一款系统的中文字体，
# 都找不到时退回默认字体（图里的中文会变成方框，但脚本不会因为字体缺失而崩）。
_CJK_FONT_PATHS = (
    "C:/Windows/Fonts/msyh.ttc",
    "C:/Windows/Fonts/simhei.ttf",
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Hiragino Sans GB.ttc",
    "/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc",
)


def cjk_font(size: int):
    """返回 (font, 是否支持中文)。"""
    from PIL import ImageFont

    for path in _CJK_FONT_PATHS:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size), True
            except OSError:
                continue
    return ImageFont.load_default(), False


def database_file() -> str:
    """给日志用的库路径（入口已把 DATABASE_URL 指向它）。"""
    return os.environ.get("DATABASE_URL", "")
