"""守卫的反证测试：``scripts/check_docs_pii.py`` 必须抓到它声称能抓的东西。

为什么单独立一条：``docs/verification-playbook.md`` §3.2 要求"新增守卫必须反证，
否则无法排除正则失效→恒绿"。这条用例就是那份要求的最小实现——每条规则既有正例
（必须命中），也有反例（占位符/豁免/相对路径必须放过）。

首轮上线时漏了 ``C:\\Users\\张三\\work``：家目录规则只写了 ASCII 字符类，而中文
Windows 用户名是最常见的形态。这里把 CJK 用例钉死，防止再退回去。
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_docs_pii.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("check_docs_pii", _SCRIPT)
    assert spec is not None
    assert spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


pii = _load_module()


@pytest.mark.parametrize(
    ("label", "content", "expected_rule"),
    [
        ("provider-key", "k = sk-" + "a1B2" + "c3D4" * 8, "provider-key"),
        ("cn-mobile", "电话 13912345678", "cn-mobile"),
        ("email", "联系 real.person@corp.cn", "email"),
        ("home-ascii", "路径 C:" + "\\Users\\zhangsan\\x.txt", "home-path"),
        ("home-cjk-windows", "路径 C:" + "\\Users\\张三\\x.txt", "home-path"),
        ("home-cjk-macos", "路径 /Users/李四/x.txt", "home-path"),
        ("home-cjk-linux", "路径 /home/王五/x.txt", "home-path"),
    ],
)
def test_rules_flag_what_they_claim(tmp_path, label, content, expected_rule):
    target = tmp_path / f"{label}.md"
    target.write_text(content, encoding="utf-8")

    findings = pii.scan((str(target),))

    assert [rule.name for _, _, rule, _ in findings] == [expected_rule]


@pytest.mark.parametrize(
    "content",
    [
        "示例 user@example.com",
        "占位号码 138-0000-0000",
        "文件 src/pages/home/StatsCards.tsx",
        "公开联系方式 13912345678  <!-- pii-ok: 已确认可公开 -->",
        "占位符 <REDACTED-ROTATE-ME>",
    ],
)
def test_placeholders_and_relative_paths_are_allowed(tmp_path, content):
    target = tmp_path / "allowed.md"
    target.write_text(content, encoding="utf-8")

    assert pii.scan((str(target),)) == []


def test_missing_target_is_an_error_not_a_clean_bill(capsys):
    """扫不到文件时必须报错：否则路径写错会被读成"文档干净"。"""
    assert pii.main(["no-such-dir-for-pii-test"]) == 2
    assert "没有可扫描的文件" in capsys.readouterr().err


def test_output_never_echoes_the_raw_secret(tmp_path, capsys):
    secret = "sk-" + "Z" * 32
    target = tmp_path / "leak.md"
    target.write_text(f"key: {secret}", encoding="utf-8")

    assert pii.main([str(target)]) == 1
    assert secret not in capsys.readouterr().out


def test_repository_docs_are_clean():
    """把仓库自己的文档也纳入守卫：新增文档误带 PII 时这里先红。"""
    assert pii.main(["docs"]) == 0
