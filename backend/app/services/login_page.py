# SPDX-License-Identifier: Apache-2.0
"""「这一页是不是要我登录」的中立判定（从 ``track_portal.py`` 纯搬迁）。

为什么单独成模块：它服务**两拨**调用方，而这两拨此前被一起放在回读功能里：

- 回读（R-15 C）已经不做了，``track_portal`` / ``track_portal_patterns`` 整文件删除；
- **登录状态面板仍然需要它**——投递浏览器 / 网申站点的登录判定
  （``services/login_status._judge``）靠它把"停在登录页"从"内容太少"里分出来。
  只删不搬会让这两条登录判定**静默失效**（退化成一律 unknown），这是本轮删除最大的坑。

判定口径逐字保留（阈值与词表都不改），下面两段注释是这张表的语义，不是普通注释：

- 判据是**两个以上中文登录控件词 + 页面很短**。只看一个词会误伤：登录之后的页面导航
  里也常有「登录」字样（「退出登录」），所以要求登录表单的几个控件同时在。
- 英文词不参与判断——页脚里的 "sign in" 到处都是。
"""

from __future__ import annotations

#: 登录页特征：命中两个以上、且页面很短，就认定"停在登录页"。
#: 只用中文词——英文 "sign in" 在页脚里到处都是，容易误判。
LOGIN_MARKERS: tuple[str, ...] = (
    "手机号码登录",
    "邮箱登录",
    "获取验证码",
    "扫码登录",
    "密码登录",
    "登录后",
)
#: 登录页通常只有几百字（状态页至少一张卡片）。
LOGIN_PAGE_MAX_CHARS = 1200


def looks_like_login_page(text: str) -> bool:
    """这一页是不是"要我登录"的登录页。

    判据是**两个以上中文登录控件词 + 页面很短**。只看一个词会误伤：登录之后的
    页面导航里也常有「登录」字样（「退出登录」），所以要求登录表单的几个控件同时在。
    英文词不参与判断——页脚里的 "sign in" 到处都是。
    """
    if not text or len(text) > LOGIN_PAGE_MAX_CHARS:
        return False
    lowered = text.lower()
    return sum(1 for pattern in LOGIN_MARKERS if pattern in lowered) >= 2


__all__ = [
    "LOGIN_MARKERS",
    "LOGIN_PAGE_MAX_CHARS",
    "looks_like_login_page",
]
