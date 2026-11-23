# SPDX-License-Identifier: Apache-2.0
"""``services/login_page``：登录页判定的独立单测。

为什么单独一个文件：这段逻辑原先住在 ``services/track_portal.py``（回读功能）里，
本轮回读整条删除、它被搬到中立模块。**搬家必须被约束住**——只删不搬会让
「投递浏览器 / 网申浏览器」的登录页判定静默退化成「无法判断」，
``test_login_status.py`` 里那条浏览器来源的用例就是活口，这里是它的近身守卫。

判据本身（两条中文登录控件词 + 短页）不能改：改宽了会把登录后的页面判成未登录
（页脚/导航里也有「登录」字样），改窄了会在真登录页上判不出，两种都直接造成误报。
"""

from __future__ import annotations

import pytest
from app.services.login_page import (
    LOGIN_MARKERS,
    LOGIN_PAGE_MAX_CHARS,
    looks_like_login_page,
)


def test_a_short_page_with_two_chinese_login_controls_is_a_login_page():
    """两个登录控件词同现 + 页面很短 = 停在登录页。"""
    assert looks_like_login_page("手机号码登录 获取验证码 登录") is True
    assert looks_like_login_page("密码登录\n扫码登录\n") is True


def test_a_long_page_is_never_a_login_page_even_with_both_markers():
    """长页不算：状态页至少一张卡片。页脚/导航里出现两个登录词很常见。"""
    long_page = "手机号码登录 获取验证码 " + "我的投递 应聘记录 " * 200
    assert len(long_page) > LOGIN_PAGE_MAX_CHARS
    assert looks_like_login_page(long_page) is False


def test_a_single_marker_is_not_enough():
    """只看一个词会误伤：登录后的页面导航里也常有「登录」字样。"""
    assert looks_like_login_page("退出登录") is False
    assert looks_like_login_page("登录后查看") is False


@pytest.mark.parametrize("value", ["", None])
def test_empty_input_is_not_a_login_page(value):
    """空文本是"什么都没读到"，不是"停在登录页"——两者该走不同的 detail。"""
    assert looks_like_login_page(value) is False  # type: ignore[arg-type]


def test_the_marker_table_and_threshold_are_pinned():
    """词表与阈值逐字钉住：搬家时最容易"顺手优化"的就是这两个。

    - 6 个中文控件词，最后一个必须是「登录后」（"登录后查看"这类提示语不是登录页）；
    - 阈值 1200 字符：把状态页从登录页里分出来的那条线，改小会误伤短状态页。
    """
    assert LOGIN_MARKERS == (
        "手机号码登录",
        "邮箱登录",
        "获取验证码",
        "扫码登录",
        "密码登录",
        "登录后",
    )
    assert LOGIN_PAGE_MAX_CHARS == 1200
