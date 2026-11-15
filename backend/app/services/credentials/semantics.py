# SPDX-License-Identifier: Apache-2.0
"""**唯一的密钥读写语义**：空串 = 清除、掩码 = 保持不变、其它 = 新值加密写入。

改造前这套语义有四份实现（``web_search_settings.save_search_config`` 的三分支、
``asr_profiles._resolve_key`` 的按条判断、``embedding_profiles_store`` 的同款分支、
``api_key_session`` 的纯内存覆盖），任何一处被"顺手改好"都会让同一个动作在四个页面
表现不同（Q16）。本模块把它们收敛成两个纯函数——**只做判断，不做 IO**：

- :func:`resolve_stored_key`：请求里的值 → 该落盘的存储值（或"别动"）；
- :func:`apply_stored_key`：同上，但把"别动"直接折成"沿用旧值"，给调用方省一次判空；
- :func:`mask_value`：真实值 → 对外掩码，**所有回前端的路径都必须过它**。

刻意做成纯函数（加密函数可注入）：这样"三种语义 × 两种绑定状态"的矩阵能离线穷举，
不需要数据库、不需要真实 DPAPI。

与既有实现的对应关系（**逐条一致，不许"顺手改好"**）：

===================================  ==================================================
既有实现                              本模块
===================================  ==================================================
``save_search_config`` 的三分支        ``resolve_stored_key(.., empty_clears=True)``
``asr_profiles._resolve_key``          ``resolve_stored_key(.., invalidated=绑定是否变化)``
``llm_key_refs.masked_api_key``        ``mask_value``（保持同一份 ``API_KEY_MASK``）
``api_key_session`` 的清除             纯内存，不进本模块（见 :mod:`state`）
===================================  ==================================================

**空串的两套语义是既有差异，不是本层要"统一"的东西**（Q16 记录的就是它）：联网搜索把空串
读成"用户显式移除这把 Key"，而语音/语义检索把空串读成"这一条没改，沿用本条旧 Key"
（跨条绝不继承）。两者都在生产上被用户依赖，任选一个统一都会改掉另一个页面的行为，
所以这里把它显式化成 :attr:`empty_clears` 参数：**调用方必须说出自己要哪一种**，
而不是让读者去猜。掩码的语义两处一致——永远是"保持不变"。
"""

from __future__ import annotations

from collections.abc import Callable

from ..api_key_crypto import encrypt_key
from ..llm_key_refs import API_KEY_MASK, masked_api_key

CLEAR_SENTINEL = "__clear__"
"""前端「清除 Key」显式发送的哨兵值。

与 :data:`app.services.asr_profiles.CLEAR_API_KEY`、
:data:`app.services.llm.embedding_profiles.CLEAR_SENTINEL` 是**同一个字面量**；
这里自带一份而不是反向 import，是为了不让语义层依赖那两个业务模块。
一致性由 ``tests/test_credentials_registry.py`` 用断言钉住。
"""


def is_mask(value: str | None) -> bool:
    """是否是掩码占位符（含 ``********:profile:<id>`` 这类带引用的形态）。"""
    return bool(value) and str(value).startswith(API_KEY_MASK)


def is_clear_sentinel(value: str | None) -> bool:
    """是否是显式清除哨兵。"""
    return value == CLEAR_SENTINEL


def resolve_stored_key(
    incoming: str | None,
    *,
    existing_stored: str = "",
    clear_sentinel: str | None = None,
    invalidated: bool = False,
    empty_clears: bool = False,
    encrypt: Callable[[str], str] = encrypt_key,
) -> str | None:
    """把请求里的 ``api_key`` 解析成"该落盘的值"。

    判定顺序（与既有实现逐条对应）：

    ====================  ===============  ==================================================
    请求里的值            绑定是否变了      结果
    ====================  ===============  ==================================================
    ``__clear__``（声明了） 任意            ``""``（清空）
    空串                   变了             ``""``（清空）
    空串                   没变             ``""`` if ``empty_clears`` else :data:`None`
    掩码 ``********…``     变了             ``""``（清空）
    掩码 ``********…``     没变             :data:`None`（保持不变）
    其它字符串             任意             加密后的值
    ====================  ===============  ==================================================

    Args:
        incoming: 前端传上来的值（原样，**不要**在这里 strip——各调用方的 strip 时机
            不同，`web_search_settings` 会去掉首尾空白而语音配置不会；把 strip 挪进
            这里就改了既有落盘形态）。
        existing_stored: 当前已落的存储值（密文或明文，取决于平台）；只为让
            :func:`apply_stored_key` 能折成具体值，不参与判断。
        clear_sentinel: 该来源是否接受显式清除哨兵。传 ``CLEAR_SENTINEL`` 时哨兵生效；
            传 ``None``（默认）时 ``__clear__`` 会被当成普通字符串加密——这正是
            ``web_search_settings`` 既有行为，不能替它"补上"哨兵支持。
        invalidated: 已保存的 Key 是否**不再适用**（地址/协议变了、或新建记录）。
            为真时掩码与空串一律清空，而不是沿用旧值——把旧服务商的 Key 发到新主机
            是越权外发。
        empty_clears: 空串在"绑定没变"时是否等于清除。``True`` 对应整块重写的调用方
            （联网搜索设置页：用户把输入框清空就是移除这把 Key）；``False`` 对应按条
            编辑的调用方（语音/语义检索：留空 = 不改这一条）。默认值取 ``False``，
            因为"空串=沿用"是两个按条编辑器共用的既有口径，而"空串=清除"只有一处。
        encrypt: 加密函数（测试注入用；生产就是 ``api_key_crypto.encrypt_key``）。

    Returns:
        - :data:`None`：**保持不动**（调用方不要改这一格）；
        - ``""``：清空；
        - 其它字符串：新的落盘值（已加密，或非 Windows 上的明文）。
    """
    raw = incoming or ""
    if clear_sentinel is not None and raw == clear_sentinel:
        return ""
    if not raw:
        if invalidated or empty_clears:
            return ""
        return None
    if raw.startswith(API_KEY_MASK):
        # 掩码是"前端把我给它的占位符原样传回来"，不该变成清空，除非绑定已经变了。
        return "" if invalidated else None
    return encrypt(raw)


def apply_stored_key(
    incoming: str | None,
    *,
    existing_stored: str = "",
    clear_sentinel: str | None = None,
    invalidated: bool = False,
    empty_clears: bool = False,
    encrypt: Callable[[str], str] = encrypt_key,
) -> str:
    """同 :func:`resolve_stored_key`，但把"保持不动"直接折成 ``existing_stored``。

    给"整块重写"的调用方用（``save_search_config`` 就是这种：它一次性重建整个
    ``web_search`` 块，没有"格子里留空"的概念）。
    """
    resolved = resolve_stored_key(
        incoming,
        existing_stored=existing_stored,
        clear_sentinel=clear_sentinel,
        invalidated=invalidated,
        empty_clears=empty_clears,
        encrypt=encrypt,
    )
    return existing_stored if resolved is None else resolved


def mask_value(real: str, *, reference: str | None = None) -> str:
    """真实密钥 → 对外掩码；未配置返回空串。

    ``reference`` 用于大模型配置的引用形态（``********:profile:<id>``）——掩码必须
    携带引用，前端才能把"这条记录的 Key"原样回传并让服务层还原成正确的那一把。
    没有引用需求时就是 ``********``。
    """
    return masked_api_key(real, reference=reference)


__all__ = [
    "CLEAR_SENTINEL",
    "apply_stored_key",
    "is_clear_sentinel",
    "is_mask",
    "mask_value",
    "resolve_stored_key",
]
