# SPDX-License-Identifier: Apache-2.0
"""T8 招呼语配图的**假件与工具**（被两个测试文件共用，本身不含用例）。

为什么单独成文件：`test_apply_greeting_image.py`（解析顺序 / 本地拒绝 / 审计）与
`test_apply_greeting_image_chain.py`（跑真实 runner 的执行链 + 反证）都需要同一套
"不碰网络"的假 CDP 客户端、假适配器与造图工具；两份复制会在第一次改断言时分叉。
本文件不匹配 `test_*.py`，因此既不被 pytest 收集，也不占 500 行测试预算。

**这里一个真实站点都不碰**：`ImageCdp` 只记录 CDP 命令，`ImageAdapter` 只读临时文件。
"""

from __future__ import annotations

import io
import os
import tempfile
from pathlib import Path

from app.models.apply import FAILURE_FILE_UPLOAD_FAILED, ApplyTask, ApplyTaskItem
from app.services.apply.greeting_image import TEMP_DIR_PREFIX
from app.services.apply.task_runner import TaskRunner
from app.services.browser.cdp_client import CdpClient
from app.services.sites.base import SiteFailure
from app.services.user_files import save_from_bytes
from PIL import Image
from test_apply_task_runner import (
    FakeAdapter,
    _FakeClock,
    _registry,
    _task_status,
    _wait,
    _wait_db,
)

# 真实客户端里 set_file_input 内部发的就是这条命令（见 websocket_client.set_file_input）。
FILE_INPUT_METHOD = "DOM.setFileInputFiles"


def png_bytes(width: int = 8, height: int = 8) -> bytes:
    """一张小编码开销的 PNG（纯色）。"""
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (12, 34, 56)).save(buffer, format="PNG")
    return buffer.getvalue()


def noise_png_bytes(side: int) -> bytes:
    """随机像素 PNG：几乎不可压缩，用于**稳定**地造出超 2 MB 的合法图片。"""
    raw = os.urandom(side * side * 3)
    buffer = io.BytesIO()
    Image.frombytes("RGB", (side, side), raw).save(buffer, format="PNG")
    return buffer.getvalue()


class ImageCdp(CdpClient):
    """记录型假 CDP 客户端：不连浏览器，只记下"发过哪些 CDP 命令"。"""

    def __init__(self) -> None:
        self.events: list[tuple[str, str]] = []
        self.file_inputs: list[tuple[str, list[str]]] = []

    def list_targets(self) -> list[dict]:
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        self.events.append(("new_tab", url))
        return "target-1"

    def send(self, method, params=None, *, timeout=None):
        self.events.append(("send", method))
        return {}

    def evaluate(self, expression, *, timeout=None):
        self.events.append(("evaluate", expression))
        return None

    def set_file_input(self, selector, files, *, timeout=None) -> None:
        self.file_inputs.append((selector, list(files)))
        # 与真实实现同形：CDP 只有 ``DOM.setFileInputFiles`` 一条路，这里也记一条，
        # 于是一个断言能同时盯住"适配器有没有调 set_file_input"和"线上会发什么命令"。
        self.send(FILE_INPUT_METHOD, {"files": list(files), "objectId": "obj-1"})

    def navigate(self, url, *, timeout=None):
        self.events.append(("navigate", url))
        return {}

    def close(self) -> None:
        pass

    def sent_methods(self) -> list[str]:
        return [method for kind, method in self.events if kind == "send"]

    def navigated_urls(self) -> list[str]:
        """按顺序记下的导航目标（"没图时不该为发图去导航"这条断言要用）。"""
        return [target for kind, target in self.events if kind == "navigate"]


class ImageAdapter(FakeAdapter):
    """在 ``FakeAdapter`` 之上只加发图能力：像真适配器那样**通过 CDP 塞文件**。

    刻意不在假件里"假装成功"：真适配器最终就是 ``client.set_file_input(...)``（内部
    ``DOM.setFileInputFiles``），假件少这一步，"序列里有没有它"的断言就全是空转。

    ``target`` 模仿真适配器的 ``greeting_image_target``（发图时核对通过的会话标题）：
    ``task_apply`` 用它把"到底发给了谁"写进 ``image_detail``。
    """

    def __init__(self, *, fail_upload: str | None = None, target: str = "") -> None:
        super().__init__()
        self.upload_calls: list[list[str]] = []
        self.upload_companies: list[str] = []
        self.uploaded_bytes: list[bytes] = []
        self.existed_during_upload: list[bool] = []
        self._fail_upload = fail_upload
        self.greeting_image_target = target

    def upload_greeting_images(self, client, paths, *, company: str = ""):
        # 与真适配器同签名：company 是"回聊天页后按公司名定位会话"的输入（见
        # services/sites/boss_apply_image.py）。假件把它记下来，方便断言它真的被传到了。
        files = [str(path) for path in paths]
        self.upload_calls.append(files)
        self.upload_companies.append(company)
        for path in paths:
            self.existed_during_upload.append(Path(path).exists())
            self.uploaded_bytes.append(Path(path).read_bytes())
        if self._fail_upload is not None:
            raise SiteFailure(FAILURE_FILE_UPLOAD_FAILED, self._fail_upload)
        client.set_file_input("input[type=file]", files)
        return "dom_input"


def temp_dirs() -> set[str]:
    """当前系统临时目录里属于本功能的目录名（用来断言"没留下残骸"）。"""
    return {path.name for path in Path(tempfile.gettempdir()).glob(f"{TEMP_DIR_PREFIX}*")}


def store(db_session, content: bytes, name: str, mime: str) -> int:
    """把一份字节登记成"我的文件"里的副本，返回 ``user_file.id``（真落盘）。"""
    file_id = save_from_bytes(
        db_session,
        content,
        original_name=name,
        mime=mime,
        source_type="photo",
        source_ref="test-apply-greeting-image",
    )
    assert file_id is not None
    return file_id


def item_of(db_session, task: ApplyTask) -> ApplyTaskItem:
    db_session.expire_all()
    return db_session.query(ApplyTaskItem).filter_by(task_id=task.id).one()


def run_task(db_session, task: ApplyTask, adapter: FakeAdapter) -> ImageCdp:
    """起一个只跑这一个批次的 runner，跑完断言它正常结束，返回记录下来的 CDP 客户端。"""
    client = ImageCdp()
    runner = TaskRunner(
        registry=_registry(adapter),
        client_factory=lambda _config: client,
        sleeper=lambda _seconds: None,
        clock=_FakeClock(),
        poll_interval=0.01,
    )
    runner.start(task.id)
    _wait(runner)
    _wait_db(db_session, lambda: _task_status(db_session, task.id), "completed", "任务状态")
    return client


def step_names(events: list[dict]) -> list[str]:
    return [event["step"] for event in events if event["event"] == "apply.step"]
