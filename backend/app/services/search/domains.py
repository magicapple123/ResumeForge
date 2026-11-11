# SPDX-License-Identifier: Apache-2.0
"""只取摘要、不抓正文的站点清单（P4-06）。

## 为什么

知乎、微信公众号、小红书这类站点对非浏览器请求返回登录墙/验证码页，正文抽取拿到的是
「请先登录」或一屏 JS，比摘要还少。抓它们纯粹是浪费一次往返 + 一次被风控标记的机会。
所以对这些域名**不发抓取请求**，直接用搜索来源给的 snippet。

## 这是"跳过名单"，不是"白名单"

- 只有命中这里的域名才跳过抓取，其余**一律照抓**；
- 名单可通过环境变量 ``RF_SEARCH_SUMMARY_ONLY_HOSTS`` 追加（逗号分隔）；
- 匹配用 host 后缀（``zhihu.com`` 覆盖 ``www.zhihu.com`` / ``zhuanlan.zhihu.com``），
  **不做**"任何包含 zhihu 的字符串"这种子串判断——`notzhihu.com` 不该被误伤。
"""

from __future__ import annotations

import os
from urllib.parse import urlsplit

#: 已知会拦截非浏览器请求的内容站（均为"要登录/要验证码/纯 JS 渲染"）。
SUMMARY_ONLY_HOSTS = frozenset(
    {
        # 知乎（问题页与专栏都拦）
        "zhihu.com",
        # 微信公众号文章（正文在微信客户端里才完整）
        "mp.weixin.qq.com",
        "weixin.qq.com",
        # 小红书（笔记页要登录）
        "xiaohongshu.com",
        "xhslink.com",
        # 微博（登录墙 + 反爬）
        "weibo.com",
        "weibo.cn",
        "t.cn",
        # 豆瓣（登录墙）
        "douban.com",
        # 简书 / 百家号 / 头条：正文由 JS 注入，服务端渲染出来是空壳
        "jianshu.com",
        "baijiahao.baidu.com",
        "toutiao.com",
    }
)
_ENV_VAR = "RF_SEARCH_SUMMARY_ONLY_HOSTS"


def extra_summary_only_hosts() -> frozenset[str]:
    """环境变量追加的域名（运维/用户临时扩名单用，不用改代码）。"""
    raw = os.environ.get(_ENV_VAR, "")
    return frozenset(
        item.strip().casefold().lstrip(".")
        for item in raw.replace(";", ",").split(",")
        if item.strip()
    )


def is_summary_only(url: str) -> bool:
    """这个地址是否属于"只取摘要"的站点。"""
    host = (urlsplit(url or "").hostname or "").casefold()
    if not host:
        return False
    hosts = SUMMARY_ONLY_HOSTS | extra_summary_only_hosts()
    return any(host == item or host.endswith(f".{item}") for item in hosts)


__all__ = ["SUMMARY_ONLY_HOSTS", "extra_summary_only_hosts", "is_summary_only"]
