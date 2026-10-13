"""生产代码行数预算守卫（PR-18 扩面版）。

2026-10 大规模拆分（55 commits）后确立：生产代码单文件不得超过 500 行
（modular-code-planner 工作流 C 的红线）。新增文件超限会让本测试变红，
强制开发者在「继续膨胀」与「拆分/书面豁免」之间做显式决策。

PR-18（2026-10-13 审计）扩面与硬化：

1. **豁免必须带到期日**（``Exemption.expires``，ISO 日期）。到期后守卫变红并
   点名——防止白名单无声续期；续期必须显式改这条记录（新理由 + 新日期）。
   带「触发条件」的豁免保留原语义（条件仍然是主判据），到期日是兜底复核点。
2. **范围扩展到 scripts/（``*.py``）与 desktop/（``*.js``）**。这两个目录是
   CLI/工具脚本的现实：一次性任务脚本、带主流程的测量与打包工具，500 行的
   生产代码预算不适用，因此 scripts 用独立预算 800；desktop 维持 500
   （实测最大文件 470 行，零豁免起步）。扩面目标是「新增长文件必须自觉登记
   豁免」，不是追溯性大拆。

豁免必须在本文件登记并附书面理由 + 到期日；豁免是白名单不是许可，新增豁免
条目应同步到 ``.workbuddy/split-plan/`` 对应方案或交付报告。
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_ROOTS = ("backend/app", "frontend/src")
SCAN_SUFFIXES = {".py", ".ts", ".tsx"}
TEST_NAME_MARKERS = (".test.", ".spec.")
LINE_BUDGET = 500

# scripts/ 与 desktop/ 的扩面预算与排除目录（PR-18）。
SCRIPTS_ROOT = "scripts"
SCRIPTS_SUFFIXES = {".py"}
SCRIPTS_BUDGET = 800
DESKTOP_ROOT = "desktop"
DESKTOP_SUFFIXES = {".js"}
DESKTOP_BUDGET = 500
DESKTOP_EXCLUDED_DIRS = {"node_modules", "out", "payload", "dist", "build", "release", ".vite"}

# 测试文件扫描范围：后端按 tests/ 目录命名约定（test_*.py），
# 前端按共置命名约定（*.test.ts / *.test.tsx）。
TEST_SCAN_GLOBS = (
    "backend/tests/test_*.py",
    "frontend/src/**/*.test.ts",
    "frontend/src/**/*.test.tsx",
)


@dataclass(frozen=True)
class Exemption:
    """一条书面豁免：具体理由 + 到期日（ISO 日期，到期后守卫变红点名）。"""

    reason: str
    expires: str


# 现有豁免的结构性理由（monkeypatch 钉死 / 字面路径锚定 / 单一类内聚等）不随
# 时间变化，触发条件是主判据；到期日统一给 2027-06-30 作为强制复核的兜底点。
_STRUCTURED_BACKSTOP = "2027-06-30"
# 本会话多 PR 叠加增长导致的过线：拆分与行为修改必须分补丁，本批只豁免；
# 到期日 2026-11-15，届时拆分或续期（续期需要新理由）。
_PR18_MULTI_PR_GROWTH = "2026-11-15"

# 测试文件书面豁免清单（路径相对仓库根；理由必须具体，禁止「暂缓拆分」式空话）
_TEST_EXEMPTIONS: dict[str, Exemption] = {
    # 2026-10-05 网申自定义字段修复批新增 3 条别名守卫（+58 行）后 515 行，超线 15 行；
    # 用例与既有别名边界测试共置同一 db_session fixture 与资料构造辅助，拆出文件需整份
    # 复制这套脚手架，重复成本大于收益。
    # 触发条件：>600 行或下批再增用例（届时拆 test_webform_data.py）。
    "backend/tests/test_webform_data.py": Exemption(
        "过线 15 行，fixture 脚手架复制成本大于收益", _STRUCTURED_BACKSTOP
    ),
    # 2026-10-05 网申自定义字段修复批新增 4 条逐框建议守卫（+63 行）后 527 行，超线 27 行；
    # 本文件还被 test_file_size_budget 之外的哨兵用例以模块命名空间 monkeypatch 钉死
    # （见生产豁免中 live.py 条目说明），拆文件会分散哨兵落点。
    # 触发条件：>600 行或下批再增用例（届时拆 test_webform_live_custom.py）。
    "backend/tests/test_webform_live.py": Exemption(
        "过线 27 行，monkeypatch 哨兵与脚手架耦合", _STRUCTURED_BACKSTOP
    ),
    # 2026-10-13 生产审计 PR-13 批（统计刷新 + 岗位深链 job_id 贯穿 + 导出筛选一致）
    # 在本文件新增用例后 517 行，超线 17 行；用例与 TrackerPage 的页面级测试夹具
    # 共置同一套 render/fetch 脚手架，为 17 行拆文件是纯复制。到期拆出
    # TrackerPage.stats.test.tsx（统计/深链域）或续期（需新理由）。
    "frontend/src/pages/TrackerPage.test.tsx": Exemption(
        "过线 17 行，PR-13 用例与页面测试夹具共置", _PR18_MULTI_PR_GROWTH
    ),
    # ProfilePage.test.tsx 的豁免（触发条件 >800 行）已于 2026-10-13 到期执行：
    # 按其自身预案拆出 ProfilePage.webform.test.tsx + src/test/profilePageHarness.tsx，
    # 不再豁免。
}

# 书面豁免清单（路径相对仓库根；理由必须具体，禁止「暂缓拆分」式空话）
_EXEMPTIONS: dict[str, Exemption] = {
    # JS 资源字符串（表单快照/焦点面板脚本），两脚本共享
    # _CONTROL_HELPERS_JS，逐字符协议契约由 canary 测试钉死，拆分收益为负。
    "backend/app/services/webform/engine/scripts.py": Exemption(
        "内嵌 JS 页面协议资源，非逻辑", _STRUCTURED_BACKSTOP
    ),
    # LiveSession 的轮询/AI/写值核心读取 MAX_AI_CALLS/fill_current_page 等
    # 模块全局，被 test_webform_live 在 live 模块命名空间上 monkeypatch；
    # 搬走即静默失效（test_webform_live:984-1010 是哨兵）。
    "backend/app/services/webform/live.py": Exemption(
        "monkeypatch 钉死模块命名空间", _STRUCTURED_BACKSTOP
    ),
    # FormEngine 单一类内聚体，拆分只能做成 mixin 碎片化，无职责缝。
    "backend/app/services/webform/engine/core.py": Exemption(
        "单一类内聚，无拆分缝", _STRUCTURED_BACKSTOP
    ),
    # preflight.py::_REQUIRED_FILES 以字面路径把它钉进发行包必需清单，
    # 转包会破坏打包链；~90% 是声明式数据。触发条件：FEATURES ~1000 行。
    "backend/app/services/feature_catalog.py": Exemption(
        "preflight 字面路径钉死 + 纯数据", _STRUCTURED_BACKSTOP
    ),
    # 3 个端点编排函数被 test_interview 以模块属性 patch
    # （_require_provider/_ask_next_question/generate_report），读取方
    # 必须留在本模块。触发条件：>700 行且先把 patch 改依赖注入。
    "backend/app/api/interview.py": Exemption("monkeypatch 钉死端点编排", _STRUCTURED_BACKSTOP),
    # install_live_control_script 主体是单一注入脚本字符串（canary 整脚本
    # 断言），且 _load_face_data_uri 被 patch、_ASSET_DIR 为 __file__ 深度耦合。
    "backend/app/services/webform/live_control.py": Exemption(
        "patch + __file__ + 单一脚本资源", _STRUCTURED_BACKSTOP
    ),
    # 上一轮拆分后的编排核心；captures_dir/get_task_runner 被模块属性
    # patch。触发条件：>650 行或新增批次类型时迁出 StopAwareCdpClient。
    "backend/app/services/apply/task_runner.py": Exemption(
        "编排核心 + 两类模块属性 patch", _STRUCTURED_BACKSTOP
    ),
    # 后端 test_assistant_knowledge_audit.py:37 以字面路径读取本文件提取
    # title 做四向交叉验证，另有 4 处治理文档按路径引用。触发条件：~1200 行。
    "frontend/src/components/userGuideSteps.ts": Exemption(
        "后端守卫字面路径锚定 + 纯文案数据", _STRUCTURED_BACKSTOP
    ),
    # Wave3 拆分后的页面组合层（handlers + 会话持久化 + busy 联合态 +
    # 弹层组合），与 live.py 同等待遇的组合层豁免。
    "frontend/src/pages/WebFormPage.tsx": Exemption(
        "页面组合层（编排职责单一）", _STRUCTURED_BACKSTOP
    ),
    # 2026-10-12 AI 提速批接入共享连接池（client_pool）后各 +9 行（511/512 vs 500）。
    # 两文件是协议编排热点：monkeypatch 落点密集（payload/_build_payload/_client/
    # 模块级 retry 等），拆出"HTTP 调用层"会把重试/降级/用量接线的上下文切成两半。
    # 触发条件：>600 行或下次功能改动时先把传输层（_client/_timeout/_headers/_endpoint）
    # 迁入独立模块（届时本豁免撤销）。
    "backend/app/services/llm/openai_compat.py": Exemption(
        "过线 12 行，协议编排热点 + patch 落点密集", _STRUCTURED_BACKSTOP
    ),
    "backend/app/services/llm/anthropic.py": Exemption(
        "过线 11 行，协议编排热点 + patch 落点密集", _STRUCTURED_BACKSTOP
    ),
    # ---- 2026-10-13 生产审计会话：多 PR 叠加增长的声明式豁免（到期 2026-11-15）----
    # 以下四文件在本审计会话被 PR-02/03/07/08/09/10/11/13 多批同时改大
    # （datasets：数据集身份贯穿；resume_generator：硬 deadline/用量汇总；
    #   resume_risk：隐私最小化与降级契约；tracker：原子事务/快照/深链统计）。
    # 行为已被各自批次的新增测试钉住；立即拆分会把「拆分」与「本会话行为修改」
    # 混在同一批，风险高。拆分留待专门批次（逐文件独立方案），到期不续期即红。
    "backend/app/services/datasets.py": Exemption(
        "PR-02/03 数据集身份贯穿 +549 行；行为已钉，拆分留待专门批次",
        _PR18_MULTI_PR_GROWTH,
    ),
    "backend/app/services/resume/resume_generator.py": Exemption(
        "PR-07/08 硬 deadline/取消/用量汇总后 538 行；同上，专门批次拆分",
        _PR18_MULTI_PR_GROWTH,
    ),
    "backend/app/services/resume/resume_risk.py": Exemption(
        "PR-11 隐私最小化/降级契约/查重预算后 665 行；同上，专门批次拆分",
        _PR18_MULTI_PR_GROWTH,
    ),
    "backend/app/services/tracker.py": Exemption(
        "PR-09/10/13 原子事务/交付快照/深链统计后 557 行；同上，专门批次拆分",
        _PR18_MULTI_PR_GROWTH,
    ),
    "frontend/src/components/apply/ApplyRecordsPanel.tsx": Exemption(
        "PR-14 批次明细代次守卫后 511 行（超 11 行）；组件拆分机械但为 11 行制造"
        "props 钻孔不值得，随 apply 域下批重构一并拆",
        _PR18_MULTI_PR_GROWTH,
    ),
}

# scripts/（*.py，预算 800）的豁免清单：CLI/工具脚本的结构性长度。
_SCRIPTS_EXEMPTIONS: dict[str, Exemption] = {
    # 演示数据造数 CLI：主体是声明式虚构数据模板（人名/公司/简历内容词池）与
    # 分域生成函数，行数在数据不在逻辑；拆分只会把模板与使用点分到两处。
    # 到期重审：若届时仍需要维护该脚本，先按数据域拆模块。
    "scripts/seed_demo_data.py": Exemption(
        "演示数据造数 CLI，主体为声明式数据模板", _PR18_MULTI_PR_GROWTH
    ),
    # 2026-10-13 PR-17 刚重构的性能测量工具（fixture 构造/测量/报告三段）；
    # 本批行为冻结（只测量不重构），拆分留待下次触碰时先拆 fixture 构造段。
    "scripts/measure_api_perf.py": Exemption(
        "PR-17 刚重构的测量工具，行为冻结批；下次触碰先拆 fixture 段",
        _PR18_MULTI_PR_GROWTH,
    ),
}

# desktop/（*.js，预算 500）：实测最大文件 470 行，零豁免起步——新增长文件
# 必须自觉登记豁免 + 到期日。
_DESKTOP_EXEMPTIONS: dict[str, Exemption] = {}


def _count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(chunk.count(b"\n") for chunk in iter(lambda: fh.read(1 << 20), b""))


def _find_over_budget(
    paths: list[Path], budget: int, exemptions: dict[str, Exemption]
) -> list[str]:
    """对给定文件清单做预算检查，返回超限文件描述（豁免过的跳过）。"""
    offenders: list[str] = []
    for path in paths:
        rel = path.relative_to(REPO_ROOT).as_posix()
        if rel in exemptions:
            continue
        lines = _count_lines(path)
        if lines > budget:
            offenders.append(f"{rel} = {lines} 行")
    return offenders


def _missing_exemptions(exemptions: dict[str, Exemption]) -> list[str]:
    return sorted(rel for rel in exemptions if not (REPO_ROOT / rel).exists())


def _collect(root: str, suffixes: set[str], excluded_dirs: set[str] = frozenset()) -> list[Path]:
    base = REPO_ROOT / root
    assert base.exists(), f"扫描根目录不存在：{base}"
    paths: list[Path] = []
    for path in sorted(base.rglob("*")):
        if path.suffix not in suffixes:
            continue
        if any(part in excluded_dirs for part in path.relative_to(base).parts[:-1]):
            continue
        paths.append(path)
    return paths


def test_production_files_stay_under_line_budget() -> None:
    offenders: list[str] = []
    missing = _missing_exemptions(_EXEMPTIONS)
    paths: list[Path] = []
    for root in SCAN_ROOTS:
        paths.extend(
            path
            for path in _collect(root, SCAN_SUFFIXES)
            if not any(marker in path.name for marker in TEST_NAME_MARKERS)
        )
    offenders.extend(_find_over_budget(paths, LINE_BUDGET, _EXEMPTIONS))
    assert not missing, f"豁免清单里有已不存在的文件（请清理）：{missing}"
    assert not offenders, (
        f"{len(offenders)} 个生产文件超过 {LINE_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._EXEMPTIONS 登记书面豁免理由与到期日。"
    )


def test_test_files_stay_under_line_budget() -> None:
    """测试文件同样受 500 行预算约束（WaveT 拆分后的守门测试）。"""
    offenders: list[str] = []
    missing = _missing_exemptions(_TEST_EXEMPTIONS)
    paths: list[Path] = []
    for pattern in TEST_SCAN_GLOBS:
        paths.extend(sorted(REPO_ROOT.glob(pattern)))
    offenders.extend(_find_over_budget(paths, LINE_BUDGET, _TEST_EXEMPTIONS))
    assert not missing, f"测试豁免清单里有已不存在的文件（请清理）：{missing}"
    assert not offenders, (
        f"{len(offenders)} 个测试文件超过 {LINE_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._TEST_EXEMPTIONS 登记书面豁免理由与到期日。"
    )


def test_scripts_stay_under_line_budget() -> None:
    """scripts/（*.py）受 800 行预算约束（PR-18 扩面；CLI 脚本结构性长度，见模块注释）。"""
    offenders = _find_over_budget(
        _collect(SCRIPTS_ROOT, SCRIPTS_SUFFIXES), SCRIPTS_BUDGET, _SCRIPTS_EXEMPTIONS
    )
    missing = _missing_exemptions(_SCRIPTS_EXEMPTIONS)
    assert not missing, f"scripts 豁免清单里有已不存在的文件（请清理）：{missing}"
    assert not offenders, (
        f"{len(offenders)} 个 scripts 文件超过 {SCRIPTS_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._SCRIPTS_EXEMPTIONS 登记书面豁免理由与到期日。"
    )


def test_desktop_files_stay_under_line_budget() -> None:
    """desktop/（*.js，排除 node_modules/out/payload 等）受 500 行预算约束（PR-18 扩面）。"""
    offenders = _find_over_budget(
        _collect(DESKTOP_ROOT, DESKTOP_SUFFIXES, DESKTOP_EXCLUDED_DIRS),
        DESKTOP_BUDGET,
        _DESKTOP_EXEMPTIONS,
    )
    missing = _missing_exemptions(_DESKTOP_EXEMPTIONS)
    assert not missing, f"desktop 豁免清单里有已不存在的文件（请清理）：{missing}"
    assert not offenders, (
        f"{len(offenders)} 个 desktop 文件超过 {DESKTOP_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._DESKTOP_EXEMPTIONS 登记书面豁免理由与到期日。"
    )


def test_exemption_reasons_are_documented() -> None:
    """豁免必须带理由——防空话式白名单（如「暂缓拆分」）。"""
    vague = {"todo", "tbd", "暂缓", "待定", "later", "wip"}
    for exemptions in (_EXEMPTIONS, _TEST_EXEMPTIONS, _SCRIPTS_EXEMPTIONS, _DESKTOP_EXEMPTIONS):
        for rel, exemption in exemptions.items():
            assert exemption.reason.strip(), f"豁免缺理由：{rel}"
            assert exemption.reason.strip().lower() not in vague, (
                f"豁免理由是空话：{rel} -> {exemption.reason!r}"
            )


def test_exemptions_carry_expiry_and_are_not_expired() -> None:
    """豁免必须带到期日，且到期日不得早于今天（PR-18：防空无声续期）。"""
    today = datetime.date.today()
    stale: list[str] = []
    for exemptions in (_EXEMPTIONS, _TEST_EXEMPTIONS, _SCRIPTS_EXEMPTIONS, _DESKTOP_EXEMPTIONS):
        for rel, exemption in exemptions.items():
            try:
                expires = datetime.date.fromisoformat(exemption.expires)
            except ValueError as exc:
                raise AssertionError(
                    f"豁免到期日不是 ISO 日期（YYYY-MM-DD）：{rel} -> {exemption.expires!r}"
                ) from exc
            if expires < today:
                stale.append(f"{rel}（到期 {expires}，理由：{exemption.reason}）")
    assert not stale, (
        f"{len(stale)} 条豁免已到期，必须拆分或显式续期（改理由 + 新到期日）：\n" + "\n".join(stale)
    )
