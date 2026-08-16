"""抓取源注册表：自动发现 sources/ 包下的全部实现。

新增抓取源无需改动此处或其他任何代码——在 sources/ 下新建文件、
继承 JobSourceBase 即可被自动加载。
"""
import importlib
import pkgutil
import logging

from .base import JobSourceBase

logger = logging.getLogger(__name__)


def _discover_sources() -> dict[str, JobSourceBase]:
    from . import sources as sources_package

    discovered: dict[str, JobSourceBase] = {}
    for module_info in pkgutil.iter_modules(sources_package.__path__):
        module = importlib.import_module(f"{sources_package.__name__}.{module_info.name}")
        for obj in vars(module).values():
            if (
                isinstance(obj, type)
                and issubclass(obj, JobSourceBase)
                and obj is not JobSourceBase
            ):
                source = obj()
                discovered[source.name] = source
                logger.info("已注册抓取源：%s（%s）", source.name, source.display_name)
    return discovered


_SOURCES = _discover_sources()


def list_sources() -> list[JobSourceBase]:
    return list(_SOURCES.values())


def get_source(name: str) -> JobSourceBase | None:
    return _SOURCES.get(name)
