# SPDX-License-Identifier: Apache-2.0
"""演示数据的公共底座：引擎/表映射、写库助手、时间锚点、岗位来源判定。

⚠️ 本模块必须在 ``scripts/seed_demo_data.py`` 设好 ``DATABASE_URL`` **之后**才被导入：
它导入的 ``app.database`` / ``app.models`` 会把配置缓存成进程内单例
（见 ``seed_demo_data.py::_preparse_out()`` 的注释）。所以这里**不**重复插 ``sys.path``
——入口文件已经插过一次，唯一的脚本入口是 ``scripts/seed_demo_data.py``。
"""

from __future__ import annotations

import os
from datetime import datetime

from app.database import Base
from app.models import __init__ as _models  # noqa: F401
from app.services.jd_parser import parse_jd
from sqlalchemy import create_engine, insert

# 演示数据里的日期以它为"现在"，让提醒有逾期/今天/未来的分布。固定值而不是 now()：
# 否则同一份脚本每天跑出来的截图都不一样，diff 里全是不该有的变化。
NOW = datetime(2026, 10, 6, 8, 30, 0)


def keywords_of(job: dict) -> list[dict]:
    """用应用自己的 JD 解析器生成技能标签，避免手写一份和词表不一致的。"""
    text = "\n".join([job["description"], job["requirements"], job["additional_info"]])
    return [tag.model_dump() for tag in parse_jd(text)["skills"]]


T = Base.metadata.tables

# 引擎地址就是入口文件从 --out 推出的那一个（先设环境变量、后导入本模块）。
engine = create_engine(os.environ["DATABASE_URL"])


def init_db() -> None:
    """把演示库重建为空 schema（先 drop 再 create）。

    拆分前这是模块导入期的副作用；现在由 ``main()`` 在任何 ``seed()`` 之前显式调用。
    """
    # 先 drop 再 create，而不是先删文件：删文件在开发机上会撞"文件被运行中的后端占用"，
    # 也会在某些环境里被删除守卫拦下，而 drop_all 对同一个文件同样能得到一份干净的库。
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)


def row(**kw):
    return kw


def ins(table: str, rows: list[dict]) -> None:
    if not rows:
        return
    with engine.begin() as conn:
        conn.execute(insert(T[table]), rows)


# 岗位来源 → `recognition_source`（岗位广场职位列那个「采集 / 手动」角标读的就是它）。
#
# 这里踩过一次：整份演示数据把 `recognition_source` 一律写成 `"text"`，而这个值**不在**
# 后端的白名单（`schemas/job.py` 的 `RECOGNITION_SOURCES`）里，前端于是把每一条都判成
# 「手动添加」——演示站和官网截图上，明明是采集回来的岗位全挂着「手动」角标。
# 正确做法是按 `source` 推导：来自招聘网站的算「岗位采集」，其余算「手动添加」。
_COLLECTED_SOURCES = {"BOSS直聘", "智联招聘", "猎聘", "拉勾", "招聘网站"}


def recognition_source_of(job: dict) -> str:
    """**取值必须落在 `schemas/job.py` 的 `RECOGNITION_SOURCES` 里**。

    这里连踩两次：先是一律写 `"text"`（英文旧值），后是写 `"手动添加"`——
    两个都不在白名单里，而读取路径上的 `JobOut` 会因此校验失败，**整份岗位列表 500**。
    （真实故障就是这么发生的，见 `tests/test_job_out_read_tolerance.py`。）
    """
    source = str(job.get("source") or "")
    if source == "官网采集":
        return "官网采集"
    return "岗位采集" if source in _COLLECTED_SOURCES else "手动填写"
