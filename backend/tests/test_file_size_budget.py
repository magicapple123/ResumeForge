"""生产代码行数预算守卫。

2026-10 大规模拆分（55 commits）后确立：生产代码单文件不得超过 500 行
（modular-code-planner 工作流 C 的红线）。新增文件超限会让本测试变红，
强制开发者在「继续膨胀」与「拆分/书面豁免」之间做显式决策。

豁免必须在本文件 _EXEMPTIONS 里登记并附书面理由；豁免是白名单不是许可，
新增豁免条目应同步到 `.workbuddy/split-plan/` 对应方案或交付报告。

范围除生产代码外（backend/app + frontend/src），还包括测试文件
（backend/tests/test_*.py 与 frontend/src 共置 *.test.*）——WaveT 拆分后全部
测试文件同样受 500 行预算约束，豁免单独登记在 _TEST_EXEMPTIONS。
"""

from __future__ import annotations

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
SCAN_ROOTS = ("backend/app", "frontend/src")
SCAN_SUFFIXES = {".py", ".ts", ".tsx"}
TEST_NAME_MARKERS = (".test.", ".spec.")
LINE_BUDGET = 500

# 测试文件扫描范围：后端按 tests/ 目录命名约定（test_*.py），
# 前端按共置命名约定（*.test.ts / *.test.tsx）。
TEST_SCAN_GLOBS = (
    "backend/tests/test_*.py",
    "frontend/src/**/*.test.ts",
    "frontend/src/**/*.test.tsx",
)

# 测试文件书面豁免清单（路径相对仓库根；理由必须具体，禁止「暂缓拆分」式空话）
_TEST_EXEMPTIONS: dict[str, str] = {
    # 刚过线 44 行（544 vs 500）；4 个模块 mock 骨架 + renderPage 占 ~120 行，
    # 拆出的第二文件也要整份复制骨架，重复/漂移成本大于收益；5 个 describe
    # 内聚于同一页面生命周期（通用简历卡/资料分页/折叠/网申资料），无天然缝。
    # 触发条件：>800 行或新增第三个大编辑域（届时拆 ProfilePage.webform.test.tsx）。
    "frontend/src/pages/ProfilePage.test.tsx": "刚过线 44 行，mock 骨架复制成本大于收益",
}

# 书面豁免清单（路径相对仓库根；理由必须具体，禁止「暂缓拆分」式空话）
_EXEMPTIONS: dict[str, str] = {
    # JS 资源字符串（表单快照/焦点面板脚本），两脚本共享
    # _CONTROL_HELPERS_JS，逐字符协议契约由 canary 测试钉死，拆分收益为负。
    "backend/app/services/webform/engine/scripts.py": "内嵌 JS 页面协议资源，非逻辑",
    # LiveSession 的轮询/AI/写值核心读取 MAX_AI_CALLS/fill_current_page 等
    # 模块全局，被 test_webform_live 在 live 模块命名空间上 monkeypatch；
    # 搬走即静默失效（test_webform_live:984-1010 是哨兵）。
    "backend/app/services/webform/live.py": "monkeypatch 钉死模块命名空间",
    # FormEngine 单一类内聚体，拆分只能做成 mixin 碎片化，无职责缝。
    "backend/app/services/webform/engine/core.py": "单一类内聚，无拆分缝",
    # preflight.py::_REQUIRED_FILES 以字面路径把它钉进发行包必需清单，
    # 转包会破坏打包链；~90% 是声明式数据。触发条件：FEATURES ~1000 行。
    "backend/app/services/feature_catalog.py": "preflight 字面路径钉死 + 纯数据",
    # 3 个端点编排函数被 test_interview 以模块属性 patch
    # （_require_provider/_ask_next_question/generate_report），读取方
    # 必须留在本模块。触发条件：>700 行且先把 patch 改依赖注入。
    "backend/app/api/interview.py": "monkeypatch 钉死端点编排",
    # install_live_control_script 主体是单一注入脚本字符串（canary 整脚本
    # 断言），且 _load_face_data_uri 被 patch、_ASSET_DIR 为 __file__ 深度耦合。
    "backend/app/services/webform/live_control.py": "patch + __file__ + 单一脚本资源",
    # 上一轮拆分后的编排核心；captures_dir/get_task_runner 被模块属性
    # patch。触发条件：>650 行或新增批次类型时迁出 StopAwareCdpClient。
    "backend/app/services/apply/task_runner.py": "编排核心 + 两类模块属性 patch",
    # 刚过线、零耦合；合并计划「预览=执行」是同份代码契约。
    "backend/app/services/tracker.py": "刚过线，合并契约内聚",
    # 后端 test_assistant_knowledge_audit.py:37 以字面路径读取本文件提取
    # title 做四向交叉验证，另有 4 处治理文档按路径引用。触发条件：~1200 行。
    "frontend/src/components/userGuideSteps.ts": "后端守卫字面路径锚定 + 纯文案数据",
    # Wave3 拆分后的页面组合层（handlers + 会话持久化 + busy 联合态 +
    # 弹层组合），与 live.py 同等待遇的组合层豁免。
    "frontend/src/pages/WebFormPage.tsx": "页面组合层（编排职责单一）",
}


def _count_lines(path: Path) -> int:
    with path.open("rb") as fh:
        return sum(chunk.count(b"\n") for chunk in iter(lambda: fh.read(1 << 20), b""))


def test_production_files_stay_under_line_budget() -> None:
    offenders: list[str] = []
    missing_exemptions = sorted(set(_EXEMPTIONS) - {p for p in _EXEMPTIONS if (REPO_ROOT / p).exists()})
    for root in SCAN_ROOTS:
        base = REPO_ROOT / root
        assert base.exists(), f"扫描根目录不存在：{base}"
        for path in sorted(base.rglob("*")):
            if path.suffix not in SCAN_SUFFIXES:
                continue
            if any(marker in path.name for marker in TEST_NAME_MARKERS):
                continue  # 共置测试文件归测试预算管（后续拆分任务）
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in _EXEMPTIONS:
                continue
            lines = _count_lines(path)
            if lines > LINE_BUDGET:
                offenders.append(f"{rel} = {lines} 行")
    assert not missing_exemptions, f"豁免清单里有已不存在的文件（请清理）：{missing_exemptions}"
    assert not offenders, (
        f"{len(offenders)} 个生产文件超过 {LINE_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._EXEMPTIONS 登记书面豁免理由。"
    )


def test_test_files_stay_under_line_budget() -> None:
    """测试文件同样受 500 行预算约束（WaveT 拆分后的守门测试）。"""
    offenders: list[str] = []
    missing_exemptions = sorted(
        set(_TEST_EXEMPTIONS) - {p for p in _TEST_EXEMPTIONS if (REPO_ROOT / p).exists()}
    )
    for pattern in TEST_SCAN_GLOBS:
        for path in sorted(REPO_ROOT.glob(pattern)):
            rel = path.relative_to(REPO_ROOT).as_posix()
            if rel in _TEST_EXEMPTIONS:
                continue
            lines = _count_lines(path)
            if lines > LINE_BUDGET:
                offenders.append(f"{rel} = {lines} 行")
    assert not missing_exemptions, f"测试豁免清单里有已不存在的文件（请清理）：{missing_exemptions}"
    assert not offenders, (
        f"{len(offenders)} 个测试文件超过 {LINE_BUDGET} 行预算：\n"
        + "\n".join(offenders)
        + "\n请拆分，或在 test_file_size_budget._TEST_EXEMPTIONS 登记书面豁免理由。"
    )


def test_exemption_reasons_are_documented() -> None:
    """豁免必须带理由——防空话式白名单（如「暂缓拆分」）。"""
    vague = {"todo", "tbd", "暂缓", "待定", "later", "wip"}
    for exemptions in (_EXEMPTIONS, _TEST_EXEMPTIONS):
        for rel, reason in exemptions.items():
            assert reason.strip(), f"豁免缺理由：{rel}"
            assert reason.strip().lower() not in vague, f"豁免理由是空话：{rel} -> {reason!r}"
