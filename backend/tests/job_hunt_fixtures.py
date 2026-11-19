# SPDX-License-Identifier: Apache-2.0
"""job_hunt 解析测试的本地 HTML 夹具加载器。

夹具是 2026-11-07 由登录态浏览器导出的真实页面样本，存
``docs/job-hunt-fixtures/``（**不进 git**，.gitignore 排除 *.html）。夜间与 CI
都没有登录态，解析测试一律吃这些本地文件；缺文件就 ``pytest.skip``（E18：不许
假装断言通过）。

用法（测试模块里）::

    from job_hunt_fixtures import load, has

    def test_boss_list():
        html = load("boss_list.html")
        ...
"""

from pathlib import Path

import pytest

# backend/tests/job_hunt_fixtures.py -> parents[2] = 仓库根
FIXTURES = Path(__file__).resolve().parents[2] / "docs" / "job-hunt-fixtures"

#: 计划 J1 核对的夹具清单（名称 → 说明）；缺哪个在跑测试前就能看出来。
EXPECTED = {
    "boss_list.html": "BOSS 搜索列表（15 张卡片，薪资为字体编码 PUA）",
    "boss_detail.html": "BOSS 岗位详情（完整 JD；主薪资与相似岗位为明文）",
    "zhilian_list.html": "智联搜索结果（岗位 JSON，明文薪资）",
    "zhilian_detail.html": "智联岗位详情（完整 JD）",
    "job51_list.html": "前程无忧搜索结果",
    "liepin_list.html": "猎聘搜索结果",
    "liepin_detail.html": "猎聘岗位详情（完整 JD + 明文薪资）",
}

#: 已知缺失并登记 docs/job-hunt-blocked.md（BLOCKED-FIXTURE-JOB51）的项。
KNOWN_MISSING = {"job51_detail.html": "51job 详情需登录，抽屉只弹微信二维码"}


def path(name: str) -> Path:
    return FIXTURES / name


def has(name: str) -> bool:
    """夹具是否存在（不 skip，给「有夹具才断言」的分支用）。"""
    return path(name).exists()


def load(name: str) -> str:
    """读夹具全文；缺失时 skip 当前测试（缺夹具 ≠ 失败）。"""
    p = path(name)
    if not p.exists():
        pytest.skip(f"缺夹具 {name}（需登录后补抓）")
    return p.read_text(encoding="utf-8", errors="ignore")


def missing_expected() -> list[str]:
    """EXPECTED 里实际缺的文件名（闸门/报告用；空列表 = 七件套齐全）。"""
    return [name for name in EXPECTED if not path(name).exists()]


__all__ = ["FIXTURES", "EXPECTED", "KNOWN_MISSING", "path", "has", "load", "missing_expected"]
