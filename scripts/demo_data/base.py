# SPDX-License-Identifier: Apache-2.0
"""演示数据的公共底座：引擎/表映射、写库助手、时间锚点、岗位来源判定。

⚠️ 本模块必须在 ``scripts/seed_demo_data.py`` 设好 ``DATABASE_URL`` **之后**才被导入：
它导入的 ``app.database`` / ``app.models`` 会把配置缓存成进程内单例
（见 ``seed_demo_data.py::_preparse_out()`` 的注释）。所以这里**不**重复插 ``sys.path``
——入口文件已经插过一次，唯一的脚本入口是 ``scripts/seed_demo_data.py``。
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta
from pathlib import Path

from alembic import command
from alembic.migration import MigrationContext
from app.database import Base
from app.database_migrations import build_alembic_config
from app.models import __init__ as _models  # noqa: F401
from app.services import schema_epoch
from app.services.jd_parser import parse_jd
from sqlalchemy import create_engine, insert, text


# 演示数据的"现在"。**不再是写死的日期**（曾经是 ``datetime(2026, 10, 6, 8, 30)``）：
# 写死的锚点会随时间推移越来越旧，于是首页「近 7 天生成」变成 0、所有提醒都摊成"逾期"
# 红色——截图看起来像数据坏了，而不像有人真在用。改成跟随运行日之后，"昨天刚用过、
# 明天还有面试"才是每一轮截图的样子；代价是不再天然可复现，所以留了 ``RF_DEMO_NOW``
# 这个口子给需要字节级复现的场合（官网重新采集一批对比截图时用）。
#
# 截图或演示前重跑一次脚本，锚点跟随运行日。
# 规则与官网 ``tools/seed_demo_full.py::resolve_now()`` **必须一致**：那边跑本脚本时会把
# 自己算好的值写进 ``RF_DEMO_NOW`` 传下来，所以两边不会各算一次、跨午夜时也不会错开一天。
def resolve_now() -> datetime:
    """锚点：``RF_DEMO_NOW``（ISO 8601）优先，否则取**运行日的昨天 08:30**。

    固定在 08:30 而不是直接用 ``now()``：提醒的「已逾期 / 24 小时内 / 3 天内 / 更远」
    是按整点分档的，秒级时间会让同一份数据在两次运行间跨过分档边界。
    """
    override = os.environ.get("RF_DEMO_NOW", "").strip()
    if override:
        parsed = datetime.fromisoformat(override)
        # 带时区的输入先落到本地墙钟：本脚本写进库的其它时间戳都是 naive，混着 tz-aware
        # 会在 SQLite 里比较时抛 "can't compare offset-naive and offset-aware"。
        return parsed.astimezone().replace(tzinfo=None) if parsed.tzinfo else parsed
    yesterday = datetime.now() - timedelta(days=1)
    return yesterday.replace(hour=8, minute=30, second=0, microsecond=0)


NOW = resolve_now()


def keywords_of(job: dict) -> list[dict]:
    """用应用自己的 JD 解析器生成技能标签，避免手写一份和词表不一致的。"""
    # 变量名不叫 text：本模块从 sqlalchemy 导入了 text()，同名会把它遮住。
    content = "\n".join([job["description"], job["requirements"], job["additional_info"]])
    return [tag.model_dump() for tag in parse_jd(content)["skills"]]


T = Base.metadata.tables

# 引擎地址就是入口文件从 --out 推出的那一个（先设环境变量、后导入本模块）。
engine = create_engine(os.environ["DATABASE_URL"])


def init_db() -> None:
    """把演示库重建为一份干净的、由**当前迁移链**建出来的 schema。

    调用方（``scripts/seed_demo_data.py`` 与官网的 ``tools/seed_demo_full.py``）都依赖
    "先清空再建"：每次运行都必须得到一份与上一次无关的空库，否则自增 id 会一路漂移，
    截图与数据就对不上了。

    为什么**不能**用 ``Base.metadata.create_all``（2.0 起这是真实故障，不只是洁癖）：
    基线迁移 ``0001_baseline_v2`` 在同一个事务里建表**并**播种 ``app_schema_epoch`` 的
    ``epoch=2`` 那一行；``create_all`` 只建表、不播种，也不会建 ``alembic_version``。
    于是它造出来的库会落进 ``schema_epoch.decide()`` 的"表在但取不到 epoch"那一支，
    判定 ``REFUSE_UNKNOWN``——而 ``app/application.py`` 的 lifespan 会调
    ``startup_gate.enforce()``，用这份演示库起后端**直接拒绝启动**。演示库是 README 与
    官网截图的唯一来源，起不来等于整条截图链路断掉。
    正确做法与 ``scripts/stress_seed/schema.py::init_schema()`` 一致：跑真实的
    ``alembic upgrade head``。
    """
    # 先 drop 再建，而不是先删文件：删文件在开发机上会撞"文件被运行中的后端占用"，
    # 也会在某些环境里被删除守卫拦下，而 drop_all 对同一个文件同样能得到一份干净的库。
    Base.metadata.drop_all(engine)
    # drop_all 只认识**模型表**：``alembic_version`` 不在 Base.metadata 里，会原地活下来。
    # 留着它的后果不是"多一张空表"——升级环境一进来就读到上一轮的 revision，判定"已在
    # head"后整段跳过建表，最终得到的库没有业务表却挂着版本号（实测确认过，别删这段）。
    with engine.begin() as connection:
        connection.execute(text(f'DROP TABLE IF EXISTS "{schema_epoch.ALEMBIC_TABLE}"'))
    command.upgrade(build_alembic_config(engine), "head")
    _assert_schema_is_recognisable()


def _assert_schema_is_recognisable() -> None:
    """硬断言：刚建好的库必须能被启动闸门认成 ``UPGRADE``。

    这不是"顺手多加的检查"，而是把上面注释里那个真实故障挡在脚本内：漏掉 epoch 行或
    revision 的库照样能写数据、能跑 ``--check``（``TestClient`` 不用上下文管理器就不触发
    lifespan），只有真的用 ``uvicorn`` 起服务时才会炸。所以在脚本里先炸，并直接说清原因。
    """
    with engine.connect() as connection:
        revision = MigrationContext.configure(connection).get_current_revision()
        epochs = [
            row[0]
            for row in connection.execute(text(f'SELECT epoch FROM "{schema_epoch.EPOCH_TABLE}"'))
        ]
    if not revision:
        raise RuntimeError(
            "演示库建完后 alembic_version 里没有版本号：alembic upgrade head 没有真正执行。"
            "请检查 build_alembic_config(engine) 绑定的地址是否就是演示库（DATABASE_URL）。"
        )
    if epochs != [schema_epoch.SCHEMA_EPOCH]:
        raise RuntimeError(
            f"演示库的 {schema_epoch.EPOCH_TABLE} 必须恰好一行且 "
            f"epoch={schema_epoch.SCHEMA_EPOCH}，实际读到 {epochs!r}（revision={revision}）。"
            f"epoch 行由基线迁移播种，只有它建出来的库才会被启动闸门放行；"
            f"用 Base.metadata.create_all 建出来的库会被判为无法识别而拒绝启动。"
        )
    # decide() 内部用 Path.as_uri() 拼只读连接串，相对路径会直接抛 ValueError，
    # 所以这里显式 resolve（入口本来就传的是绝对路径，这行是给别处复用时的保险）。
    database_file = Path(str(engine.url.database or "")).resolve()
    decision = schema_epoch.decide(database_file)
    if decision is not schema_epoch.EpochDecision.UPGRADE:
        raise RuntimeError(
            f"演示库建完后启动闸门判定为 {decision.name}（期望 UPGRADE），库：{database_file}。"
            f"当前 revision={revision}，迁移链上的 revision："
            f"{sorted(schema_epoch.known_revisions())}。"
        )


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
