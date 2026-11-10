# SPDX-License-Identifier: Apache-2.0
"""API Key「落盘形态」的判据（平台分流，RF-24）。

``services/api_key_crypto.py`` 的评估结论是：Windows 走 DPAPI，**其它平台保持明文**
（headless Linux 上 keyring 没有可用后端，失败 UX 过于复杂，且已有「备份导出剥离 +
诊断脱敏」两层兜底）。所以「密钥一定以密文落盘」**不是**跨平台恒真的断言——把它写成
恒真式就是 ubuntu CI 红、本机 Windows 绿的那一类假失败（2026-11 CI 实测 4 条）。

这里把平台判据收敛成一处，三件事分开：

1. ``IS_WINDOWS``：导入期取一次真实平台，是**唯一**的判据来源；
2. :func:`assert_key_at_rest`：`windows` 形参可覆盖，所以**两条分支都能在任意平台上被
   验**（见 ``tests/test_api_key_crypto.py`` 里的双分支用例）；
3. 跨平台恒真的断言（回包只给掩码、读回能拿到明文、往返一致）**不进**这里——它们必须
   在每个平台上无条件跑，挪进来就等于放弃分支覆盖。

主用例照真实平台调用：Linux CI 走明文分支，Windows CI 走 DPAPI 分支；无论哪一侧，
另一侧都由双分支用例显式覆盖。
"""

from __future__ import annotations

import sys

IS_WINDOWS = sys.platform == "win32"

# 与 ``app/services/api_key_crypto._PREFIX`` 一致：Windows 落盘值的格式标记。
# 这里写字面量而不是 import 私有常量——它断言的是**磁盘上的格式**，本来就不该跟着实现变。
DPAPI_PREFIX = "dpapi:v1:"


def assert_key_at_rest(
    stored: str, *, secret: str, raw: str = "", windows: bool = IS_WINDOWS
) -> None:
    """断言 ``stored``（真正落到文件里的那个值）符合当前平台的落盘形态。

    Args:
        stored: 从落盘文件里读出来的密钥值。
        secret: 用户填的明文密钥，用来对比。
        raw: 落盘文件全文（可选）。给了就一并断言"明文在不在文件里"。
        windows: 平台判据；默认取真实平台的 :data:`IS_WINDOWS`，显式传值可验另一条分支。
    """
    assert stored, "密钥没被保存：落盘值是空的"
    if windows:
        assert stored.startswith(DPAPI_PREFIX), (
            f"Windows 上必须落 DPAPI 密文，实际落盘形态：{stored[:16]!r}"
        )
        if raw:
            assert secret not in raw, "Windows 上明文不得出现在落盘文件里"
        return
    # 非 Windows：``encrypt_key`` 是恒等函数。把"就是明文"写显式，而不是把这条断言
    # 删掉当作跳过——平台差异要被看见，改策略（例如真的接入 keyring）时这里必须红。
    assert stored == secret, (
        "非 Windows 平台按设计保持明文（api_key_crypto 不回退 keyring）；"
        "改了这条策略要同步 CHANGELOG 与升级文档"
    )
    if raw:
        assert secret in raw, "非 Windows 上落盘就是明文，文件里应当看得到原值"


__all__ = ["DPAPI_PREFIX", "IS_WINDOWS", "assert_key_at_rest"]
