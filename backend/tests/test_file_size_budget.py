# SPDX-License-Identifier: Apache-2.0
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

3. **CSS 纳入范围**（S1，2026-10-22）。此前 ``SCAN_SUFFIXES`` 只有
   ``.py/.ts/.tsx``，``frontend/src`` 下的样式表**完全不可见**——最大的
   ``styles/modules.css`` 已到 2056 行（预算的 4.1 倍）却从未被拦过。现在把
   ``.css`` 纳入同一 500 行预算。S1 当时只止血：存量 5 个超线文件登记带到期日
   （2026-12-31）的豁免，按分段标题拆分另立项。**该拆分已于 2026-12-31 到期日
   执行完毕**（5 个聚合清单 + 19 个平铺分片，均为纯搬迁），CSS 豁免清单现为空，
   与既有 ``.ts/.tsx`` 一样零豁免。
4. **幽灵豁免守卫**（S3）：豁免条目指向的文件若已不再超预算，
   ``test_exemptions_only_for_over_budget_files`` 变红——拆分完成后必须同批
   删除豁免，否则白名单只会越来越长、无人知道哪条还有效。

豁免必须在本文件登记并附书面理由 + 到期日；豁免是白名单不是许可，新增豁免
条目应同步到 ``.workbuddy/split-plan/`` 对应方案或交付报告。
"""

from __future__ import annotations

import datetime
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_ROOTS = ("backend/app", "frontend/src")
# S1（2026-10-22）：样式表纳入同一预算。此前没有 .css，5 个样式表长期超线却
# 不可见（最大 2056 行）；现在把它们变成「可见但暂时豁免」，净效果是变严。
SCAN_SUFFIXES = {".py", ".ts", ".tsx", ".css"}
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
# CSS 历史存量（S1，2026-10-22）的豁免已于 2026-12-31 到期日执行拆分并全部删除，
# 因此不再需要 `_CSS_BUDGET_BACKSTOP` 常量——CSS 现在与 .py/.ts/.tsx 同档，零豁免。

# 测试文件书面豁免清单（路径相对仓库根；理由必须具体，禁止「暂缓拆分」式空话）
_TEST_EXEMPTIONS: dict[str, Exemption] = {
    # 2026-10-05 网申自定义字段修复批新增 4 条逐框建议守卫（+63 行）后 527 行，超线 27 行；
    # 本文件还被 test_file_size_budget 之外的哨兵用例以模块命名空间 monkeypatch 钉死
    # （见生产豁免中 live.py 条目说明），拆文件会分散哨兵落点。
    # 触发条件：>600 行或下批再增用例（届时拆 test_webform_live_custom.py）。
    "backend/tests/test_webform_live.py": Exemption(
        "过线 27 行，monkeypatch 哨兵与脚手架耦合", _STRUCTURED_BACKSTOP
    ),
    # TrackerPage.test.tsx 的豁免（2026-10-13 PR-13 批新增用例后 517 行，超线 17 行）
    # 已于 2026-10-22 到期执行：按其自身预案拆出 TrackerPage.import-modal.test.tsx
    # （导入预览/深链域）+ src/test/trackerPageHarness.tsx，不再豁免。
    # 2026-10-22 之后该文件只守页面通用行为与统计卡配色（T9）。
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
    # 以下三文件在本审计会话被 PR-02/03/07/08/09/10/11/13 多批同时改大
    # （datasets：数据集身份贯穿；resume_generator：硬 deadline/用量汇总；
    #   resume_risk：隐私最小化与降级契约）。
    # 行为已被各自批次的新增测试钉住；立即拆分会把「拆分」与「本会话行为修改」
    # 混在同一批，风险高。拆分留待专门批次（逐文件独立方案），到期不续期即红。
    # （tracker.py 与 ApplyRecordsPanel.tsx 两条豁免已于专门拆分批执行并删除：
    #   tracker 拆出 tracker_query/tracker_csv，ApplyRecordsPanel 拆出展示子组件。
    #   datasets.py / resume_generator.py / resume_risk.py 三条豁免也已于专门
    #   拆分批执行并删除：datasets 拆出 datasets_admin，resume_generator 拆出
    #   resume_generator_prompts，resume_risk 拆出 resume_risk_rules 与
    #   resume_risk_outbound——均为纯搬迁，monkeypatch 落点留在原模块。
    #   scripts 的两条（seed_demo_data / measure_api_perf）也已按到期日（2026-11-15）
    #   执行并删除：seed_demo_data 按数据域拆 scripts/demo_data/（8 个模块），
    #   measure_api_perf 拆 scripts/perf_slo|perf_env|perf_fixture|perf_measure——
    #   均为纯搬迁，脚本入口路径、CLI 参数与 --help 输出逐字不变。）
    # ---- S1（2026-10-22）：CSS 首次纳入预算时的历史存量（到期 2026-12-31）----
    # 这 5 个样式表在此前版本完全不在扫描范围（SCAN_SUFFIXES 无 .css），从未被拦过；
    # S1 只把它们变成「可见但暂时豁免」，挡住继续增长，不要求立即拆分。
    # 拆分必须平铺在 frontend/src/styles/ 下（禁止子目录，否则 antdOverrideGuard 的
    # 非递归 readdirSync 会看不见新文件），方案见行数预算审计报告 §6.1 / §6.5。
    #
    # 已按 2026-12-31 到期日执行拆分（样式表拆分批），**CSS 豁免清单现为空**：
    #   styles/modules.css   2164 行 → 聚合清单 + modules-{dialog,webform,workspace,interview,
    #                        templates,layout,home}.css（按文件内 12 个分段标题切 7 片）
    #   styles/base.css      1039 行 → 聚合清单 + base-{shell,guide,header,tasks,panels}.css
    #   styles/resume.css     925 行 → 聚合清单 + resume-{canvas,editor,panels}.css（按分段切）
    #   features/tou-tou/tou-tou.css 554 行 → 聚合清单 + styles/tou-tou-{orb,cards}.css
    #   styles/tracker.css    514 行 → 聚合清单 + tracker-{board,form}.css（按分段标题切）
    # 全部为纯搬迁（分片首尾拼接与拆分前原文逐字节一致），选择器 / 声明 / 媒体查询 /
    # 层叠顺序未变；`@import` 位于各聚合文件最前，入口仍是 index.css 与 TouTouOrb.tsx
    # 各自的那一条 import，没有第二套入口。
}

# scripts/（*.py，预算 800）的豁免清单：**当前为空**。
# 2026-10-22 拆分批已按到期日（2026-11-15）执行并删除最后两条
# （scripts/seed_demo_data.py、scripts/measure_api_perf.py，见上方历史记录）：
# 拆分后各文件行数均 ≤400，远低于 800 预算，不再需要任何豁免。
_SCRIPTS_EXEMPTIONS: dict[str, Exemption] = {}

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


def _ghost_exemptions(
    exemptions: dict[str, Exemption], budget: int, root: Path = REPO_ROOT
) -> list[str]:
    """返回「文件仍存在但已不超预算」的豁免条目（S3：幽灵豁免）。

    不存在的文件由 ``_missing_exemptions`` 负责；这里只处理「拆完了忘删条目」——
    否则白名单只会越来越长，没人知道哪条还有效。
    """
    ghosts: list[str] = []
    for rel, exemption in exemptions.items():
        path = root / rel
        if not path.exists():
            continue
        lines = _count_lines(path)
        if lines <= budget:
            ghosts.append(f"{rel} = {lines} 行 ≤ {budget}（理由：{exemption.reason}）")
    return sorted(ghosts)


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


def test_exemptions_only_for_over_budget_files() -> None:
    """S3：豁免只能给「确实超预算」的文件；拆分完成后忘删条目即变红。"""
    registries = (
        ("_EXEMPTIONS", _EXEMPTIONS, LINE_BUDGET),
        ("_TEST_EXEMPTIONS", _TEST_EXEMPTIONS, LINE_BUDGET),
        ("_SCRIPTS_EXEMPTIONS", _SCRIPTS_EXEMPTIONS, SCRIPTS_BUDGET),
        ("_DESKTOP_EXEMPTIONS", _DESKTOP_EXEMPTIONS, DESKTOP_BUDGET),
    )
    ghosts: list[str] = []
    for name, exemptions, budget in registries:
        for ghost in _ghost_exemptions(exemptions, budget):
            ghosts.append(f"{name}: {ghost}")
    assert not ghosts, (
        f"{len(ghosts)} 条豁免指向的文件已不再超预算（幽灵豁免），请同批删除：\n"
        + "\n".join(ghosts)
    )


def test_ghost_exemption_detector_flags_under_budget(tmp_path: Path) -> None:
    """守卫自检：检测器必须真的能抓到幽灵豁免（防止空转的假绿）。"""
    (tmp_path / "small.py").write_text("x = 1\n", encoding="utf-8")
    (tmp_path / "big.py").write_text("x = 1\n" * 3, encoding="utf-8")
    exemptions = {
        "small.py": Exemption("测试用：已拆完仍留着条目", "2099-01-01"),
        "big.py": Exemption("测试用：确实超线", "2099-01-01"),
        "gone.py": Exemption("测试用：文件不存在，交给 _missing_exemptions", "2099-01-01"),
    }
    ghosts = _ghost_exemptions(exemptions, 2, root=tmp_path)
    assert len(ghosts) == 1, ghosts
    assert "small.py = 1 行 ≤ 2" in ghosts[0]
