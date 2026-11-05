# SPDX-License-Identifier: Apache-2.0
"""文档 PII 巡检：拦下"准备发到公开仓库的文档里还留着真实凭据/个人信息"。

为什么需要它：``.gitignore`` 能挡住本地工作目录，但挡不住"人工把某份文档复制进
``docs/``"。这类事故的共同点是**没有报错**——密钥格式合法、手机号格式合法，
只有等到被人扫到才发现。所以把它做成一条可执行检查，而不是一条规范。

检查范围（默认）：``docs/``、``README*.md``、``CONTRIBUTING.md``、``SECURITY.md``、``AGENTS.md``、
``CLAUDE.md``、``.github/``。判定为**错误**：服务商密钥、私钥块、平台令牌、中国大陆手机号、邮箱、
带用户名的家目录路径。

两种合法的"放过"方式：

1. 明显的占位符（``example.com``、``<your-key>``、``138-0000-0000``、``xxxx`` 等）自动跳过；
2. 确属需要公开的联系方式，在该行加 ``pii-ok`` 注释（例如
   ``维护者邮箱：maintainer@<domain>  <!-- pii-ok: 公开联系方式 -->``）。

用法::

    python scripts/check_docs_pii.py              # 扫默认范围，0 = 干净
    python scripts/check_docs_pii.py docs         # 只扫某个目录
    python scripts/check_docs_pii.py --list-rules # 看规则清单

退出码：0 干净；1 有命中；2 参数错误。
"""

from __future__ import annotations

import argparse
import re
import sys
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

DEFAULT_TARGETS = (
    "docs",
    "README.md",
    "README.zh-CN.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "AGENTS.md",
    "CLAUDE.md",
    ".github",
)

SCAN_SUFFIXES = {".md", ".markdown", ".txt", ".yml", ".yaml", ".json", ".toml", ".rst"}

# 命中里出现这些片段就认为"显然是占位符"，不报。
PLACEHOLDER_MARKERS = (
    "example.com",
    "example.org",
    "example.net",
    "your-key",
    "your_key",
    "redacted",
    "placeholder",
    "xxxx",
    "****",
    "0000-0000",
    "00000000000",
    "<",
    ">",
)

# 家目录里这些"用户名"是系统/CI 账号，不算个人信息。
NON_PERSONAL_HOME = {"public", "default", "defaultuser0", "runner", "user", "shared", "all users"}


@dataclass(frozen=True)
class Rule:
    """一条检查规则。

    ``pattern`` 只匹配"可疑片段"；``hint`` 是该规则的修法，直接出现在输出里，
    让看到报错的人不用回来读源码。
    """

    name: str
    pattern: re.Pattern[str]
    hint: str


RULES: tuple[Rule, ...] = (
    Rule(
        "provider-key",
        re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
        "删除明文密钥，改为从环境变量读取；已提交过的密钥必须吊销重发",
    ),
    Rule(
        "aws-access-key",
        re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
        "删除明文 Access Key；轮换后再检查历史提交",
    ),
    Rule(
        "platform-token",
        re.compile(
            r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}\b|\bgithub_pat_[A-Za-z0-9_]{40,}\b"
        ),
        "删除明文令牌；令牌一旦进过公开仓库即视为泄露",
    ),
    Rule(
        "private-key-block",
        re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----"),
        "私钥不得入库；改用部署环境的密钥文件或密钥管理服务",
    ),
    Rule(
        "cn-mobile",
        re.compile(r"(?<!\d)1[3-9]\d{9}(?!\d)"),
        "替换为 138-0000-0000 之类的占位号码",
    ),
    Rule(
        "email",
        re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
        "替换为 user@example.com，或在该行加 pii-ok 注明这是公开联系方式",
    ),
    Rule(
        "home-path",
        # 用户名不能按 ASCII 写：Windows 家目录名常常是中文，只认 [A-Za-z0-9._-]
        # 会整类漏报（本规则上线首轮就漏了 `C:\Users\张三\work`）。
        # 排除的是路径分隔符与 Windows 非法文件名字符，不是"非 ASCII"。
        # 前置边界不能少：源码里 `pages/home/Xxx.tsx` 这种相对路径不是家目录。
        re.compile(r'(?<![\w./-])(?:[A-Za-z]:\\Users\\|/Users/|/home/)([^\\/:*?"<>|\s]+)'),
        "把家目录替换为 <home> 或 <repo>，避免暴露机器用户名",
    ),
)


def _mask(value: str) -> str:
    """只暴露足够定位的字符，避免巡检日志本身变成新的泄露源。"""
    if "@" in value:
        local, _, domain = value.partition("@")
        head = local[:1] if local else ""
        return f"{head}***@{domain}"
    if len(value) <= 8:
        return f"{value[:2]}***"
    return f"{value[:4]}***{value[-2:]}（{len(value)} 字符）"


def _is_allowed(line: str, match: re.Match[str], rule: Rule) -> bool:
    """占位符、公开豁免、系统账号都不算问题。"""
    if "pii-ok" in line.lower():
        return True
    fragment = match.group(0).lower()
    if any(marker in fragment for marker in PLACEHOLDER_MARKERS):
        return True
    if rule.name == "home-path":
        return match.group(1).lower() in NON_PERSONAL_HOME
    return False


def _iter_files(targets: tuple[str, ...]) -> list[Path]:
    files: list[Path] = []
    for target in targets:
        path = (ROOT / target) if not Path(target).is_absolute() else Path(target)
        if path.is_file():
            files.append(path)
            continue
        if not path.is_dir():
            print(f"跳过不存在的路径：{target}", file=sys.stderr)
            continue
        files.extend(p for p in sorted(path.rglob("*")) if p.suffix.lower() in SCAN_SUFFIXES)
    return files


def scan(targets: tuple[str, ...]) -> list[tuple[Path, int, Rule, str]]:
    findings: list[tuple[Path, int, Rule, str]] = []
    for path in _iter_files(targets):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError):
            continue
        for lineno, line in enumerate(text.splitlines(), start=1):
            for rule in RULES:
                for match in rule.pattern.finditer(line):
                    if not _is_allowed(line, match, rule):
                        findings.append((path, lineno, rule, _mask(match.group(0))))
    return findings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="检查文档里是否残留凭据或个人信息。")
    parser.add_argument("targets", nargs="*", help="要扫描的文件或目录（默认见 --help 顶部说明）")
    parser.add_argument("--list-rules", action="store_true", help="只打印规则清单后退出")
    args = parser.parse_args(argv)

    if args.list_rules:
        for rule in RULES:
            print(f"{rule.name:20s} {rule.pattern.pattern}")
        return 0

    targets = tuple(args.targets) if args.targets else DEFAULT_TARGETS
    files = _iter_files(targets)
    if not files:
        # 一个文件都没扫到时不能报"干净"：那是路径写错，不是文档合格。
        print(f"没有可扫描的文件（targets={targets}）。请检查路径。", file=sys.stderr)
        return 2

    findings = scan(targets)
    if not findings:
        print(f"OK：{len(files)} 个文件未发现凭据或个人信息。")
        return 0

    for path, lineno, rule, masked in findings:
        rel = path.relative_to(ROOT) if path.is_relative_to(ROOT) else path
        print(f"{rel}:{lineno}: [{rule.name}] {masked}")
        print(f"    → {rule.hint}")
    print(f"\n共 {len(findings)} 处命中，涉及 {len({f[0] for f in findings})} 个文件。")
    print("如果是误报，在该行加 `pii-ok` 注释；不要用删日志的方式绕过。")
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
