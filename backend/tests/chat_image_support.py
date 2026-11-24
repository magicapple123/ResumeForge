# SPDX-License-Identifier: Apache-2.0
"""T8 招呼语配图的**聊天页假件**（被两个测试文件共用，本身不含用例）。

为什么单独成文件：`test_boss_chat_image.py`（进会话 / 选会话 / 形态兜底）与
`test_boss_chat_image_guard.py`（会话归属校验 + 气泡扫描根）需要同一个"不碰真站"的假 CDP；
两份复制会在第一次改行为时分叉。本文件不匹配 `test_*.py`，既不被 pytest 收集，也不占
500 行测试预算。

**这里一个真实站点都不碰**：`ChatCdp` 不连浏览器、不发任何真实动作，只按"页面长什么样"
回答探针并记录动作顺序。

假件刻意还原了 2026-11-24 真站事故的两个形状（它们本身就是被测行为的一部分）：

1. **点条目不一定切换会话**（``company_switch_after``）：页面上可能早开着别人的会话，
   而 ``.chat-input`` / ``.btn-sendimg`` 都在；
2. **左栏条目的头像 img 会污染图片统计**（``left_list_images`` 在发图后重排、懒加载变多）：
   ``_count_images`` 按脚本给的扫描根计数——脚本没限定右栏就按全文档数，于是头像被算成
   "图片气泡"。这正是"误报已发出"的形状，也是新用例要钉住它的方式。
"""

from __future__ import annotations

import json

from app.services.browser.cdp_client import CdpClient
from app.services.browser.page_ready import ReadyWait
from app.services.sites.boss import BossAdapter

JOB_URL = "https://www.zhipin.com/job_detail/57df41aff453cc9c0nFz3Nu4GVFT.html"
CHAT_URL = "https://www.zhipin.com/web/geek/chat"
COMPANY = "中科曙光"
# 真站会话条目的文本形如「罗先生中科曙光HRBP + 最后一条消息」，条目本身没有 a/href、没有
# data-id（实测），只能按文本找。
ITEM_TEXT = "罗先生中科曙光HRBP 您好，我对该岗位很感兴趣"
OTHER_ITEM = "李女士某某科技 在吗？"
# 右侧会话容器里的标题文本（真站实测形如
# ``杨女士 万事云 招聘人事 更多 PC 服务工具开发工程师 双休 六险一金 …``——含公司名）。
TARGET_TITLE = (
    f"杨女士 {COMPANY} 招聘人事 更多 PC 服务工具开发工程师 双休 六险一金 年终奖金 补充医疗"
)
# 页面上**已经开着**的另一个人的会话（事故现场：图被发到了「张岩」的会话里）。
OTHER_TITLE = "李女士 张岩科技 招聘人事 更多 Java 开发工程师 双休"
FILES = ["/tmp/rf-greeting-image-fixture/1.png"]

FAST_WAIT = ReadyWait(timeout=0.05, poll_interval=0.001)

# 与真实客户端同形：``set_file_input`` 内部发的就是这条 CDP 命令。
FILE_INPUT_METHOD = "DOM.setFileInputFiles"
_SEND_BUTTON_POINT = (700, 720)


class ChatCdp(CdpClient):
    """按"页面长什么样"回答探针的记录型假 CDP；不连浏览器、不发任何真实动作。"""

    def __init__(
        self,
        *,
        start_url: str = JOB_URL,
        conversations: list[str] | None = None,
        item_rect: tuple[int, int] | None = (120, 260),
        image_input_present: bool = True,
        chat_input_present: bool = True,
        send_button_present: bool = True,
        bubbles_after_upload: int = 1,
        open_conversation: str | None = None,
        company_switch_after: int | None = 1,
        title_visible: bool = True,
        left_list_images: int = 0,
        left_list_images_after_upload: int | None = None,
    ) -> None:
        self.url = start_url
        self.conversations = list(conversations if conversations is not None else [ITEM_TEXT])
        self.item_rect = item_rect
        self.image_input_present = image_input_present
        self.chat_input_present = chat_input_present
        self.send_button_present = send_button_present
        self.bubbles = 0
        self.bubbles_after_upload = bubbles_after_upload
        # 右栏当前打开的是谁的会话：默认"没开任何会话"，点条目之后才变成目标公司。
        self.open_conversation = open_conversation
        # 点几次会话条目才**真的**切过去；``None`` = 怎么点都不生效（真站事故的形状）。
        self.company_switch_after = company_switch_after
        # 右栏会话容器是否可见（``False`` = 读不到标题，"输入框在"也证明不了归属）。
        self.title_visible = title_visible
        # 左栏会话条目上的头像 img 数（发图后列表重排 / 头像懒加载会变多）。
        self.left_list_images = left_list_images
        self.left_list_images_after_upload = left_list_images_after_upload
        # 按发生顺序记录"人看得懂"的动作：navigate:… / click:x,y / set_file_input:选择器
        self.log: list[str] = []
        self.methods: list[str] = []
        self.file_inputs: list[tuple[str, list[str]]] = []
        self.item_clicks = 0

    # ---- CdpClient 协议 ----

    def list_targets(self) -> list[dict]:
        return []

    def new_tab(self, url: str = "about:blank") -> str:
        return "tab-1"

    def navigate(self, url: str, *, timeout: float | None = None) -> dict:
        self.url = url
        self.log.append(f"navigate:{url}")
        return {}

    def send(self, method, params=None, *, timeout=None):
        payload = params or {}
        self.methods.append(method)
        if method == "Input.dispatchMouseEvent" and payload.get("type") == "mousePressed":
            point = (round(float(payload.get("x", 0))), round(float(payload.get("y", 0))))
            self.log.append(f"click:{point[0]},{point[1]}")
            self._after_click(point)
        return {}

    def set_file_input(self, selector: str, files: list[str], *, timeout: float | None = None):
        self.file_inputs.append((selector, list(files)))
        self.log.append(f"set_file_input:{selector}")
        # 与真实实现同形：CDP 只有 ``DOM.setFileInputFiles`` 一条路。
        self.send(FILE_INPUT_METHOD, {"files": list(files), "objectId": "obj-1"})
        self.bubbles = self.bubbles_after_upload
        if self.left_list_images_after_upload is not None:
            # 发消息会让左栏列表重排、头像重新懒加载：这正是"头像被数成气泡"的时机。
            self.left_list_images = self.left_list_images_after_upload

    def evaluate(self, expression: str, *, timeout: float | None = None):
        if "rf:chat-shell" in expression:
            return json.dumps(self._shell())
        if "rf:chat-conversation" in expression:
            return json.dumps(self._conversation())
        if "rf:chat-user-list" in expression:
            return json.dumps(self._user_list())
        if "rf:image-probe" in expression:
            return json.dumps(self._image_probe(expression))
        if "rf:image-bubble" in expression:
            return json.dumps(self._bubble(expression))
        return None

    def close(self) -> None:
        return None

    def ensure_page_visible(self, *, timeout_seconds: float = 8.0) -> bool:
        return True

    # ---- 点击的后果 ----

    def _after_click(self, point: tuple[int, int]) -> None:
        """还原真站上点击的两种后果：可能不切换会话、点了发送图片会带出上传控件。"""
        if self.item_rect is not None and point == self.item_rect:
            self.item_clicks += 1
            if self.company_switch_after is not None and (
                self.item_clicks >= self.company_switch_after
            ):
                self.open_conversation = TARGET_TITLE
        if point == _SEND_BUTTON_POINT:
            self.image_input_present = True

    # ---- 页面状态 ----

    @property
    def on_chat(self) -> bool:
        return "/web/geek/chat" in self.url

    def _shell(self) -> dict:
        on_chat = self.on_chat
        return {
            "url": self.url,
            "title": "聊天",
            "on_chat": on_chat,
            "shell_found": on_chat,
            "chat_input_found": on_chat and self.chat_input_present,
            "image_input_found": on_chat and self.image_input_present,
            "chat_image_button_found": on_chat and self.send_button_present,
            "file_input_count": 2 if on_chat else 0,
            "list_items": len(self.conversations) if on_chat else 0,
            "captcha": False,
            "login_required": False,
        }

    def _conversation(self) -> dict:
        """右栏 ``.chat-conversation``：标题里带着招聘方 + 公司名（真站实测）。"""
        visible = self.on_chat and self.title_visible and bool(self.open_conversation)
        return {
            "url": self.url,
            "title": "聊天",
            "conversation_found": visible,
            "conversation_title": (self.open_conversation or "") if visible else "",
            "captcha": False,
            "login_required": False,
        }

    def _user_list(self) -> dict:
        hit = next((text for text in self.conversations if COMPANY in text), "")
        matched = bool(hit) and self.item_rect is not None
        rect = None
        if matched and self.item_rect is not None:
            rect = {"x": self.item_rect[0], "y": self.item_rect[1], "width": 220, "height": 64}
        return {
            "url": self.url,
            "item_count": len(self.conversations),
            "matched": matched,
            "matched_text": hit[:60],
            "rect": rect,
            "samples": self.conversations[:5],
            "captcha": False,
            "login_required": False,
        }

    def _count_images(self, expression: str) -> int:
        """按脚本的**扫描根**给出图片计数（这就是被测物之一）。

        - 脚本限定右栏（真实现状）→ 只数右栏的真实气泡；
        - 脚本按 ``document`` 口径（``document.querySelectorAll(BUBBLE)``，即修好之前的写法）
          → 把左栏 ``.user-list-content`` 里的头像也算进来（真站上就会"凭空变大"）。

        判据刻意写成"旧写法的原文"：这样只要有人把扫描根退回 ``document``，本假件的计数口径
        就跟着退回全文档，用例 3 立刻红——那正是这次要钉住的回归。
        """
        if "document.querySelectorAll(BUBBLE)" in expression:
            return self.bubbles + self.left_list_images
        return self.bubbles

    def _image_probe(self, expression: str) -> dict:
        send_rect = None
        if self.send_button_present:
            send_rect = {
                "x": _SEND_BUTTON_POINT[0],
                "y": _SEND_BUTTON_POINT[1],
                "width": 24,
                "height": 24,
            }
        return {
            "url": self.url,
            "title": "聊天",
            "input_found": self.image_input_present,
            "input_count": 1 if self.image_input_present else 0,
            # 真站上这两个属于简历附件上传（ka="user-resume-upload-file"）——只进诊断。
            "file_input_count": 2,
            "send_found": self.send_button_present,
            "send_rect": send_rect,
            "confirm_rect": None,
            "chat_input_found": self.chat_input_present,
            "image_bubbles": self._count_images(expression),
            "captcha": False,
            "login_required": False,
        }

    def _bubble(self, expression: str) -> dict:
        return {"url": self.url, "title": "聊天", "image_bubbles": self._count_images(expression)}

    # ---- 断言辅助 ----

    def clicks(self) -> list[str]:
        return [entry for entry in self.log if entry.startswith("click")]


def upload(client: ChatCdp, *, company: str = COMPANY, files: list[str] | None = None) -> str:
    """用真适配器跑一次"补发图片"，返回策略名（失败会抛 ``SiteFailure``）。"""
    adapter = BossAdapter(ready_wait=FAST_WAIT)
    return adapter.upload_greeting_images(client, files or FILES, company=company)


def upload_with_adapter(
    client: ChatCdp, *, company: str = COMPANY, files: list[str] | None = None
) -> tuple[BossAdapter, str]:
    """同上，但同时把适配器交回来（要读它核对通过的会话标题时用）。"""
    adapter = BossAdapter(ready_wait=FAST_WAIT)
    strategy = adapter.upload_greeting_images(client, files or FILES, company=company)
    return adapter, strategy


__all__ = [
    "CHAT_URL",
    "COMPANY",
    "FILE_INPUT_METHOD",
    "FILES",
    "FAST_WAIT",
    "ITEM_TEXT",
    "JOB_URL",
    "OTHER_ITEM",
    "OTHER_TITLE",
    "TARGET_TITLE",
    "ChatCdp",
    "upload",
    "upload_with_adapter",
]
