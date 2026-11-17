# SPDX-License-Identifier: Apache-2.0
"""网络代理设置的接口契约（T02）：``GET|PUT /api/settings/network``。

三条口径写死在这里，前端只按字段渲染，不再自己判断：

1. ``proxy_mode`` 只有三个值（``system`` / ``direct`` / ``custom``），**默认 ``system``**；
2. 响应里**永远没有口令本体**，只有 ``has_password``；
3. ``effective`` 与 ``detected`` 是两条不同的信息：
   - ``effective``：**当前**这次请求会走哪条路（回环强制直连的判定也在里面体现）；
   - ``detected``：这台机器的系统/环境里**检测到**的代理（用来出那条"可关闭的提示"）。
   混成一个字段的话，界面就分不清"我正在用代理"和"这台机器装了代理但我关了"。
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ProxyMode = Literal["system", "direct", "custom"]


class NetworkProxyView(BaseModel):
    """一条代理描述（**脱敏**）：只给来源 + ``host:port`` + 有没有凭据。"""

    source: str = ""
    source_label: str = ""
    var: str = ""
    scheme: str = ""
    host_port: str = ""
    has_auth: bool = False
    is_direct: bool = True


class NetworkSettingsOut(BaseModel):
    """当前网络设置 + 两条路径描述。"""

    proxy_mode: ProxyMode = "system"
    proxy_url: str = Field(default="", max_length=300)
    proxy_username: str = Field(default="", max_length=128)
    has_password: bool = False
    #: 是否用系统证书库校验证书（T05）。默认关；杀软/企业网关做 HTTPS 扫描时才需要开。
    trust_system_certs: bool = False
    effective: NetworkProxyView = Field(default_factory=NetworkProxyView)
    detected: NetworkProxyView = Field(default_factory=NetworkProxyView)
    #: 服务端是否支持 socks 代理。**恒为 False**：本项目不装 ``httpx[socks]``，
    #: 前端据此把 socks 地址的输入直接拦在提交前（而不是等一次失败）。
    supports_socks: bool = False
    #: 需要让用户看到的一句提醒（例如"直连会让只能走代理的上网环境全断"）。
    notice: str = ""


class NetworkSettingsIn(BaseModel):
    """写入网络设置。

    ``proxy_password`` 的三种语义与模型 Key 一致：留空 = 保留原口令；
    ``__clear__`` = 清除；其余按新口令（DPAPI 加密后落盘）。
    """

    proxy_mode: ProxyMode = "system"
    proxy_url: str = Field(default="", max_length=300)
    proxy_username: str = Field(default="", max_length=128)
    proxy_password: str = Field(default="", max_length=512)
    #: 不传 = 保持原值（旧的客户端不会因为缺少这个字段把开关关掉）。
    trust_system_certs: bool | None = None


__all__ = [
    "NetworkProxyView",
    "NetworkSettingsIn",
    "NetworkSettingsOut",
    "ProxyMode",
]
