# SPDX-License-Identifier: Apache-2.0
"""API Key 静态加密的单元测试。

roundtrip 类断言跨平台成立：Windows 上走 DPAPI，非 Windows 上 ``encrypt_key`` 是恒等
（保持明文）。前缀与密文形态的断言只在 Windows 上成立。

「落盘形态」的判据收敛在 ``tests/api_key_at_rest.py``（``windows`` 形参可覆盖），
所以两条平台分支在本文件里都有断言——不必依赖跑测试的是哪台机器。
"""

import sys

import pytest
from app.services.api_key_crypto import ApiKeyEncryptionError, decrypt_key, encrypt_key
from tests.api_key_at_rest import assert_key_at_rest


@pytest.mark.parametrize(
    "key",
    [
        "sk-abc123",
        "密钥-测试",
        "key with spaces and 中文 and 🔑",
        "a" * 500,
    ],
)
def test_roundtrip(key: str) -> None:
    assert decrypt_key(encrypt_key(key)) == key


def test_empty_key_is_left_alone() -> None:
    assert encrypt_key("") == ""
    assert decrypt_key("") == ""


def test_legacy_plaintext_passes_through() -> None:
    # 不带 dpapi:v1: 前缀的历史明文，解密时应原样返回，保证老库无需迁移。
    assert decrypt_key("sk-legacy-plain") == "sk-legacy-plain"
    assert decrypt_key("key-without-prefix") == "key-without-prefix"


def test_corrupted_ciphertext_returns_empty() -> None:
    assert decrypt_key("dpapi:v1:not-valid-base64") == ""


@pytest.mark.skipif(sys.platform != "win32", reason="DPAPI 只在 Windows 上生效")
def test_windows_encrypts_with_prefix() -> None:
    encrypted = encrypt_key("sk-abc123")
    assert encrypted.startswith("dpapi:v1:")
    assert encrypted != "sk-abc123"
    # 密文不该包含明文。
    assert "sk-abc123" not in encrypted


def test_key_at_rest_expectation_covers_both_platforms() -> None:
    """落盘形态的判据本身要跨平台可验：两条分支都断言一遍。

    主用例（``test_save_profile_masks_key_and_encrypts_at_rest`` 等）按**真实平台**跑，
    所以任一平台上只会走到其中一条分支；另一条由这里显式覆盖——否则改动非 Windows 的
    「保持明文」策略（RF-24）时，Windows 本机全绿、ubuntu CI 才发现。
    """
    # Windows 分支：落盘值是 DPAPI 密文，文件里搜不到明文。
    assert_key_at_rest("dpapi:v1:AAAA", secret="sk-x", raw='{"key": "dpapi:v1:AAAA"}', windows=True)
    # 非 Windows 分支：``encrypt_key`` 是恒等函数，落盘就是明文（差异写显式，不是留空）。
    assert_key_at_rest("sk-x", secret="sk-x", raw='{"key": "sk-x"}', windows=False)

    # 判据对两条分支都真的会失败（不是恒真式）。
    with pytest.raises(AssertionError):
        assert_key_at_rest("sk-x", secret="sk-x", windows=True)
    with pytest.raises(AssertionError):
        assert_key_at_rest("dpapi:v1:AAAA", secret="sk-x", windows=False)
    # 空值在两条分支上都算"没保存"。
    for windows in (True, False):
        with pytest.raises(AssertionError):
            assert_key_at_rest("", secret="sk-x", windows=windows)


@pytest.mark.parametrize("platform", ["win32", "linux"])
def test_dpapi_failure_never_falls_back_to_plaintext(monkeypatch, platform):
    """DPAPI 加密失败必须显式报错，不能静默回退明文（RF-24 修的伪装成功）。"""
    monkeypatch.setattr(sys, "platform", platform)

    def broken_protect(_data):
        raise OSError("模拟 DPAPI 故障")

    if platform == "win32":
        monkeypatch.setattr("app.services.api_key_crypto._protect", broken_protect)
        with pytest.raises(ApiKeyEncryptionError):
            encrypt_key("sk-abc123")
    else:
        # 非 Windows 保持明文（决策已落档），DPAPI 失败语义只属于 Windows 分支。
        assert encrypt_key("sk-abc123") == "sk-abc123"


def test_empty_key_skips_dpapi_even_when_broken(monkeypatch):
    monkeypatch.setattr("app.services.api_key_crypto._protect", None)  # 被调用即 TypeError
    assert encrypt_key("") == ""
