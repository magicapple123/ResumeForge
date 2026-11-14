# SPDX-License-Identifier: Apache-2.0
"""把整段 PDFium 生命周期串行化（进程级一把锁）。

为什么锁的是"整段"而不是单次调用：PDFium 即使在多线程里打开**不同**文档也不安全，
崩溃发生在"文档 A 还没关、文档 B 开始渲染"的交错处。所以受保护的操作必须从创建文档
到关掉所有子对象都在锁内完成。锁是**不可重入**的：受保护函数里不能再调另一个受保护
函数，否则会自己等自己。
"""

from __future__ import annotations

import threading
from collections.abc import Callable
from functools import wraps
from typing import ParamSpec, TypeVar

_Params = ParamSpec("_Params")
_Result = TypeVar("_Result")
# 不可重入：内层再取同一把锁会死等——需要组合时只能有一个"最外层"受保护函数。
_lock = threading.Lock()


def run_locked(operation: Callable[_Params, _Result]) -> Callable[_Params, _Result]:
    """Guard each call from document creation through closing all its children.

    PDFium is not thread safe even when threads open different documents. A
    guarded operation must close every PDFium object before returning, and must
    not call another guarded operation while holding this non-reentrant lock.
    """

    @wraps(operation)
    def guarded(*args: _Params.args, **kwargs: _Params.kwargs) -> _Result:
        with _lock:
            return operation(*args, **kwargs)

    return guarded
