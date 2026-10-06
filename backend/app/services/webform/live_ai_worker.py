"""单槽 AI 工作线程（``_AiWorker``：新任务顶掉旧任务）。"""
from __future__ import annotations

import logging
import threading
from collections.abc import Callable
from typing import Any

logger = logging.getLogger(__name__)


class _AiWorker:
    """一次只跑一个模型调用的工作线程；新任务**顶掉**还没开始的旧任务。

    **为什么不用 ``ThreadPoolExecutor``**：它的投递入口名字就叫"提交表单"那个词，而本包
    有一条机械守卫（``tests/test_webform_no_submit.py``）禁止包内出现那三个字加左括号。
    那条守卫是"只填不交"这条产品边界的落点，**刻意做得很笨**（纯文本扫描 + 不看语义的
    AST），笨才绕不过去。为了一处实现的方便去给它开豁免，等于把这条不变量磨钝——而这里
    需要的东西本来也简单：一次一个、过期的丢掉、停的时候立刻收摊。

    单槽是**有意的**：用户正在盯着**一个**框，同时发三十个请求既无意义也不礼貌。
    最新的焦点永远赢，排在前面的还没开始就已经过期了。
    """

    def __init__(self, run: Callable[..., None], *, name: str = "webform-ai") -> None:
        self._run = run
        self._mailbox: tuple[int, Any] | None = None
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._closed = False
        self._thread = threading.Thread(target=self._loop, name=name, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def push(self, seq: int, *items: Any) -> None:
        """投递一次任务（``seq`` + 任意载荷，``run`` 会原样按位解包）。"""
        with self._lock:
            self._mailbox = (seq, *items)
        self._wake.set()

    def close(self) -> None:
        """立刻收摊：不等在飞的那次网络调用（那是几秒钟，会把停用按钮卡住）。"""
        self._closed = True
        self._wake.set()
        self._thread.join(timeout=1.0)

    def _loop(self) -> None:
        while True:
            self._wake.wait()
            if self._closed:
                return
            self._wake.clear()
            with self._lock:
                item, self._mailbox = self._mailbox, None
            if item is None:
                continue
            try:
                self._run(*item)
            except Exception as error:  # noqa: BLE001 - 工作线程里的异常没人接
                logger.warning("网申填表的 AI 识别线程出错了：%s", error)

