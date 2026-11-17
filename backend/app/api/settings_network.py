# SPDX-License-Identifier: Apache-2.0
"""``/api/settings/network``（T02）：应用内的出网路径开关。

改造前"用不用代理"只能改系统环境变量并重启：这台机器装了 Clash 而上游连不上时，
用户手里没有任何可以按的按钮。本模块只提供两个端点：

==============  ==============================================================
GET  /network   当前设置 + ``effective``（这次请求实际走哪）+ ``detected``（系统里检测到哪）
PUT  /network   保存设置；**立即生效，不重启**
==============  ==============================================================

三条边界：

- **只做参数校验与编排，业务在 services**：解析在 :mod:`app.services.net_proxy`，
  存储与校验在 :mod:`app.services.net_settings`；
- **响应里没有任何口令**（只有 ``has_password``）：口令以 DPAPI 密文落在
  ``global_settings.json``，运行时才解密进内存；
- **不加 loopback 守卫**，与紧邻的 ``PUT /api/settings/search`` / ``/api/connections``
  一致：本页没有任何密钥回显，跨站写入已由 ``LoopbackOriginGuardMiddleware`` 拦掉，
  只把这一条锁起来只会造出"同一页一半能改、一半 403"。

``PUT`` 之后调 :func:`net_proxy.bump_generation`：连接池键含 generation，下一次调用
就换新客户端——这就是"改完不重启即生效"的实现（见 ``services/llm/client_pool``）。
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from ..schemas.setting_network import (
    NetworkProxyView,
    NetworkSettingsIn,
    NetworkSettingsOut,
)
from ..services import net_proxy, net_settings
from ..services.api_key_crypto import ApiKeyEncryptionError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

#: 「直连」的警示语。前端会把它显示在切换处；服务端也回一份，避免两处说法不一致。
DIRECT_MODE_NOTICE = (
    "直连会绕过系统代理：需要代理才能上网的环境（公司网络、只能走代理的宽带）"
    "会因此全部连不上，包括模型、搜索与更新检查。"
)
#: 检测到系统代理时的那条提示（前端会显示成可关闭的横条，不弹窗、不阻断）。
DETECTED_NOTICE = "检测到系统代理；模型连不上时可先改为直连"


def _view(proxy: net_proxy.ProxyInfo) -> NetworkProxyView:
    return NetworkProxyView(**proxy.redacted())


def _effective() -> net_proxy.ProxyInfo:
    """这次请求实际会走的路径（含回环强制直连、请求级直连覆盖）。"""
    return net_proxy.resolve_proxy()


def _detected() -> net_proxy.ProxyInfo:
    """这台机器的环境变量/系统设置里检测到的代理（**忽略**应用内设置）。"""
    return net_proxy.resolve_proxy(settings=net_settings.NetworkSettings())


def _out(settings: net_settings.NetworkSettings | None = None) -> NetworkSettingsOut:
    snapshot = net_settings.current() if settings is None else settings
    detected = _detected()
    notice = ""
    if snapshot.mode == net_settings.PROXY_MODE_CUSTOM and not snapshot.proxy_url:
        notice = "选了「自定义代理」但没填地址，当前按直连处理"
    elif snapshot.mode == net_settings.PROXY_MODE_DIRECT:
        notice = DIRECT_MODE_NOTICE
    elif not detected.is_direct:
        notice = DETECTED_NOTICE
    payload = snapshot.public()
    return NetworkSettingsOut(
        **payload,
        effective=_view(_effective()),
        detected=_view(detected),
        supports_socks=False,
        notice=notice,
    )


@router.get("/network", response_model=NetworkSettingsOut)
def read_network_settings() -> NetworkSettingsOut:
    """当前网络设置 + 两条路径描述。

    ``effective`` 里能看到"回环地址强制直连"的效果：请求 ``GET /network`` 本身没有
    目标地址，所以它反映的是"对远程模型服务"的路径；前端要判断"本地模型是否受影响"
    时按 ``effective.is_direct`` 即可（本地模型恒为直连）。
    """
    return _out()


@router.put("/network", response_model=NetworkSettingsOut)
def write_network_settings(payload: NetworkSettingsIn) -> NetworkSettingsOut:
    """保存并**立即生效**（连接池 generation +1，下一次调用换新客户端）。"""
    try:
        saved = net_settings.save(
            mode=payload.proxy_mode,
            proxy_url=payload.proxy_url,
            username=payload.proxy_username,
            password=payload.proxy_password,
            trust_system_certs=payload.trust_system_certs,
        )
    except net_settings.ProxyUrlError as exc:
        # 400 + 可直接展示的中文原因（含"怎么改"）：socks 地址在这里就被拦下。
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except ApiKeyEncryptionError as exc:
        # DPAPI 失败：设置未落盘（服务层在写文件前抛出），如实告知而不是伪装成功。
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except OSError as exc:  # 全局设置文件不可写（只读盘 / 权限）
        logger.warning("网络设置写入失败：%s", exc)
        raise HTTPException(
            status_code=503, detail="全局设置文件无法写入（数据目录只读或权限不足）"
        ) from exc
    # 开关翻转要丢掉缓存的系统证书上下文，否则"改完立即生效"只是句口号。
    net_proxy.reset_system_trust()
    net_proxy.bump_generation()
    logger.info(
        "网络设置已更新：mode=%s url=%s",
        saved.mode,
        net_proxy.ProxyInfo(url=saved.runtime_url()).redacted()["host_port"],
    )
    return _out(saved)


__all__ = ["DETECTED_NOTICE", "DIRECT_MODE_NOTICE", "router"]
