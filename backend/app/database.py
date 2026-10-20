# SPDX-License-Identifier: Apache-2.0
"""数据库连接与会话管理。

选用 SQLite：单用户本地应用，零部署成本；后续需要多用户时
换 PostgreSQL 只需改 DATABASE_URL 并替换 JSON 列写法。
"""

import sqlite3
from collections.abc import Mapping
from pathlib import Path

from sqlalchemy import create_engine, event, inspect
from sqlalchemy.engine import Engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from .config import get_settings
from .dataset_registry import DatasetError, active_database_file
from .services.text_sort import compare_text

settings = get_settings()


@event.listens_for(Engine, "connect")
def _register_sqlite_collations(dbapi_connection, _connection_record) -> None:
    """给**每一个** SQLite 连接注册 `rf_pinyin` collation（F）。

    挂在 `Engine` 类上而不是某个实例上：测试、迁移、备份校验都会各自
    `create_engine(...)`，逐个补注册一定会漏；漏掉时 `ORDER BY title COLLATE
    rf_pinyin` 会直接抛 "no such collation sequence"，而不是悄悄退化成 BINARY
    ——失败倒是响亮的，但修起来要翻遍所有建引擎的地方。

    非 SQLite 连接（理论上换 PostgreSQL 时）跳过：那边的排序规则由数据库侧配置。
    """
    if isinstance(dbapi_connection, sqlite3.Connection):
        dbapi_connection.create_collation("rf_pinyin", compare_text)


def database_url_for(path: Path) -> str:
    return f"sqlite:///{path.as_posix()}"


def _configure_sqlite_connection(dbapi_connection, _connection_record):
    """新连接建立时设置 SQLite PRAGMA。

    - foreign_keys：SQLite 默认不启用外键约束，显式打开以保证级联删除等行为正确。
    - busy_timeout：写事务持锁时读/写请求等待最多 5 秒而不是立刻抛
      「database is locked」，覆盖后台任务写状态与前端轮询读的并发窗口。
    - journal_mode=WAL：读写不互斥，消除 TaskRunner 写库期间读请求被阻塞；
      幂等且持久化到库文件，对内存库会静默保持默认模式（WAL 不支持）。

    这个监听器是**绑定在 Engine 实例上**的，所以每次新建引擎都必须重新注册；
    漏掉的话新数据集的外键级联会静默失效。
    """
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


def run_sqlite_maintenance(bind: Engine) -> None:
    """SQLite 例行维护：截断 WAL 并刷新优化器统计（非 SQLite 直接返回）。

    WAL 让读写不互斥，但 ``-wal`` 文件只在 checkpoint 成功时收缩；长期运行中
    checkpoint 可能一直被并发读者打断，文件会停在很大的尺寸。启动时做一次
    ``TRUNCATE`` checkpoint 加 ``optimize`` 是廉价的保险；两步都可能因并发而
    失败，由调用方吞掉并记警告，绝不阻断启动。
    """
    if bind.dialect.name != "sqlite":
        return
    with bind.connect() as connection:
        connection.exec_driver_sql("PRAGMA wal_checkpoint(TRUNCATE)")
        connection.exec_driver_sql("PRAGMA optimize")


def build_engine(database_url: str) -> Engine:
    is_sqlite = database_url.startswith("sqlite")
    options: dict = {
        # FastAPI 在线程池中运行同步接口，SQLite 需要允许跨线程共用连接
        "connect_args": {"check_same_thread": False} if is_sqlite else {},
    }
    if database_url in {"sqlite://", "sqlite:///:memory:"}:
        # 内存库默认按线程分配连接；StaticPool 才能让 lifespan、请求和测试
        # 线程看到同一份数据库内容。
        options["poolclass"] = StaticPool
    built = create_engine(database_url, **options)
    if is_sqlite:
        event.listen(built, "connect", _configure_sqlite_connection)
    return built


# 启动时连接当前激活的数据集（指针缺失时即 DATABASE_URL 指向的「主数据」）。
if settings.database_url.startswith("sqlite:///"):
    _configured = Path(settings.database_url.removeprefix("sqlite:///"))
    _configured.parent.mkdir(parents=True, exist_ok=True)
try:
    _initial_url = database_url_for(active_database_file())
except DatasetError:
    # 指针损坏或指向的文件缺失：退回配置里的库，让应用还能起得来并让用户
    # 到设置页处理，而不是直接启动失败。
    _initial_url = settings.database_url

engine = build_engine(_initial_url)

SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def rebind(database_path: Path) -> Engine:
    """把全局引擎切换到另一个数据库文件。

    ``engine`` 与 ``SessionLocal`` 的改法不同，这是有意为之：

    - ``engine`` 的 URL 在建引擎时就固化进了连接池的 creator 闭包，改
      ``engine.url`` 不会改变实际连接的文件，所以必须**新建引擎对象**并替换
      模块属性。代价是那些按值导入 ``engine`` 的模块要改成属性访问。
    - ``SessionLocal`` 用 ``configure`` 原地改绑，**对象 identity 不变**，于是
      「按值导入 SessionLocal」的模块（助手流式写入、简历保存）自动跟随，
      一行都不用改。
    """
    global engine
    database_path.parent.mkdir(parents=True, exist_ok=True)
    engine.dispose()
    engine = build_engine(database_url_for(database_path))
    SessionLocal.configure(bind=engine)
    return engine


def adopt_engine(new_engine: Engine) -> Engine:
    """把一个**已构建好**的引擎接管为全局引擎（不构建、不销毁任何引擎）。

    与 :func:`rebind` 的分工：rebind 是"给我一个文件，换绑过去"（自建引擎并
    先销毁旧的）；adopt 是"引擎已就绪，接管它"。数据集切换（PR-03 的
    prepare/commit/compensate）用它把预检/迁移完的新引擎接进来，旧引擎由
    调用方在新引擎确认可用**之后**再释放——旧引擎绝不过早销毁。
    """
    global engine
    engine = new_engine
    SessionLocal.configure(bind=new_engine)
    return new_engine


class Base(DeclarativeBase):
    """所有 ORM 模型的基类。"""


def ensure_sqlite_columns(
    bind: Engine,
    required_columns: Mapping[str, Mapping[str, str]],
) -> None:
    """为已有 SQLite 表补充缺失列；重复执行不会改动现有结构或数据。

    ``create_all`` 只会创建缺失的表，不会升级旧表。这里保留一个最小的
    列级兼容层；列定义来自代码内的可信常量，不接受用户输入。
    """
    if bind.dialect.name != "sqlite":
        return

    quote = bind.dialect.identifier_preparer.quote
    with bind.begin() as connection:
        inspector = inspect(connection)
        existing_tables = set(inspector.get_table_names())
        for table_name, columns in required_columns.items():
            if table_name not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_ddl in columns.items():
                if column_name in existing_columns:
                    continue
                connection.exec_driver_sql(
                    f"ALTER TABLE {quote(table_name)} ADD COLUMN {quote(column_name)} {column_ddl}"
                )
                existing_columns.add(column_name)


def get_db():
    """FastAPI 依赖：每个请求一个独立会话，请求结束自动关闭。"""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def session_engine(db: Session) -> Engine:
    """返回请求会话绑定的 ``Engine``。

    ``Session.get_bind()`` 的返回类型是 ``Engine | Connection``，但本应用的会话都由
    ``SessionLocal(bind=engine)`` 创建，绑定的只会是 ``Engine``；万一拿到
    ``Connection``（只在把会话绑到具体事务连接时才可能发生），在这里大声失败，
    不把连接对象当引擎传进备份 / 恢复等按引擎定位数据库文件的全局操作。
    """
    bind = db.get_bind()
    if isinstance(bind, Engine):
        return bind
    raise RuntimeError("当前会话未绑定到 Engine，无法定位数据库文件")
