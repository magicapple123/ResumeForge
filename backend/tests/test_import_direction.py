"""模块依赖方向守卫：AST 静态扫描 ``backend/app/`` 的 import 语句。

钉住架构文档（``deliverables/software-company/rf-opt-architecture-2026-10-10.md``
§2.7 契约依赖方向图）的方向规则：``api → services → models/schemas``，
``runtime/`` 是不依赖任何业务代码的最底层，``assistant_tools/`` 不反向依赖
``api``。跨路由复用须经公共层（``_shared`` / 包公共层），不允许路由模块之间
互相 import 具体符号。

实现约束：

- 纯标准库 AST，离线、无第三方依赖、总耗时 <1s；不 import 任何 ``app`` 模块
  （导入被测代码本身就违背"静态守卫"的定位，也会拖慢收集）。
- 既有例外逐条记录在各 ``ALLOWLIST``，每条带理由——这张表同时也是治理进度表：
  条目被消除时应当从表里删掉，而不是把表当成永久赦免。
- 失败输出形如 ``app/<file>:<lineno> -> <module> ... [规则名]``，可直接跳转。

相对导入（``from ...api.x import y``）按所在包解析成绝对模块后再判定，与
``import app.api.x`` 的口径一致。
"""

from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import Path

import pytest

APP_DIR = Path(__file__).resolve().parents[1] / "app"


# ---------------------------------------------------------------------------
# AST 扫描
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class ImportRecord:
    """一条 import 语句（一个 ``ast.Import``/``ImportFrom`` 展开为若干条）。"""

    lineno: int
    module: str  # 相对导入解析后的绝对模块路径；``from app import x`` 记 "app"
    names: tuple[str, ...]  # from-import 的符号名；plain import 记模块全名


def _scan_app_imports() -> dict[Path, list[ImportRecord]]:
    """解析 ``app/`` 下每个 py 文件的 import 语句。结果按文件路径分组。"""
    scanned: dict[Path, list[ImportRecord]] = {}
    for path in sorted(APP_DIR.rglob("*.py")):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        records: list[ImportRecord] = []
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    records.append(ImportRecord(node.lineno, alias.name, (alias.asname or alias.name,)))
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    # from .x import y：level=1 的基准是当前包（文件所在目录）
                    package = path.parent.parts
                    base = package[: len(package) - (node.level - 1)]
                    module = ".".join([*base, node.module]) if node.module else ".".join(base)
                else:
                    module = node.module or ""
                records.append(ImportRecord(node.lineno, module, tuple(a.name for a in node.names)))
        scanned[path] = records
    return scanned


# 模块级缓存：四个规则测试共享同一份扫描结果，避免重复解析。
_SCAN_CACHE: dict[Path, list[ImportRecord]] | None = None


def _scan() -> dict[Path, list[ImportRecord]]:
    global _SCAN_CACHE
    if _SCAN_CACHE is None:
        _SCAN_CACHE = _scan_app_imports()
    return _SCAN_CACHE


def _rel(path: Path) -> str:
    """``app/api/assistant.py`` -> ``api/assistant.py``（posix，用于 ALLOWLIST key）。"""
    return path.relative_to(APP_DIR).as_posix()


def _violations(
    rule: str,
    matches,
) -> list[str]:
    """按 ``matches(source_rel, record, target_module)`` 过滤全部 app 内导入。

    返回可读的违规描述列表；只关心目标是 ``app.*`` 的导入。
    """
    hits: list[str] = []
    for path, records in _scan().items():
        for record in records:
            target = record.module
            if not target.startswith("app."):
                continue
            if matches(_rel(path), record, target):
                names = ", ".join(record.names)
                hits.append(f"app/{_rel(path)}:{record.lineno} -> {target} (导入: {names})  [规则: {rule}]")
    return hits


def _assert_no_violations(rule: str, allowlist: dict[tuple[str, str], str], matches) -> None:
    """收集违规、扣除 ALLOWLIST，不为空则带可读列表失败。"""
    offenders = [v for v in _violations(rule, matches) if not _allowlisted(v, allowlist)]
    if offenders:
        listing = "\n".join(f"  - {v}" for v in offenders)
        pytest.fail(
            f"模块依赖方向守卫发现 {len(offenders)} 处违规（规则: {rule}）。\n"
            f"{listing}\n"
            f"处置：真错层请最小化修复；架构允许的例外须登记进本文件的 ALLOWLIST（带理由）。",
            pytrace=False,
        )


def _allowlisted(description: str, allowlist: dict[tuple[str, str], str]) -> bool:
    """违规描述里含 ``app/<file>:<line> -> <module>``，与 ALLOWLIST key 对应。

    行号不参与匹配（行号随代码漂移），只按 (文件, 目标模块) 判定。
    """
    for (file_rel, module) in allowlist:
        if f"app/{file_rel}:" in description and f"-> {module} " in description:
            return True
    return False


# ---------------------------------------------------------------------------
# ALLOWLIST（既有例外，每条带理由；消除后应删条目）
# ---------------------------------------------------------------------------

# 规则 runtime-is-bottom：现状 0 违规，无条目——这张空表就是"最底层目前干净"的存证。
ALLOW_RUNTIME: dict[tuple[str, str], str] = {}

# 规则 assistant-tools-no-api
ALLOW_ASSISTANT_TOOLS_API: dict[tuple[str, str], str] = {
    # profile_context 是"个人资料上下文组装"函数（依赖 models/services，不含路由），
    # 历史位置在 api/assistant_context.py。assistant_tools 的工具层用它组装工具结果。
    # 下沉到 services 属于模块搬移（牵连 api/assistant_context.py 及其全部调用方），
    # 留待独立的上下文层治理批次；当前为函数内延迟导入，不构成导入期环。
    (
        "services/assistant_tools/job_tools.py",
        "app.api.assistant_context",
    ): "profile_context 为上下文组装函数，历史位置在 api/；下沉留独立批次",
}

# 规则 models-schemas-no-services-api
ALLOW_MODELS_SCHEMAS: dict[tuple[str, str], str] = {
    # 两处均为函数内延迟导入（docstring 明示"延迟导入是刻意的"）：
    # schemas 需要"某岗位能否投递"的判据，而判据唯一实现在 services.sites.registry；
    # 为避免 schemas ← services.sites ← 浏览器/CDP 的导入期耦合，只做运行期按需导入。
    # 判据唯一性优先于层方向；若 registry 未来拆出纯判据模块，可把导入改指过去并删这两条。
    (
        "schemas/apply/base.py",
        "app.services.sites.registry",
    ): "default_site_key 延迟导入注册表取出厂默认站点；判据唯一，docstring 已说明",
    (
        "schemas/job.py",
        "app.services.sites.registry",
    ): "can_apply 属性延迟导入注册表；判据唯一，docstring 已说明",
}

# 规则 api-cross-module-imports（app/api 内跨子模块复用，须经公共层）
ALLOW_API_CROSS: dict[tuple[str, str], str] = {
    # --- assistant 子域：SSE 编排（assistant_stream）与各辅助模块（context/
    # conversations/budget/persistence/tool_exec）的兄弟模块间复用。
    # 全部是模块级公开符号；收敛方向是把这些公共实现下沉到 services/assistant，
    # 届时整组删除。
    ("api/assistant.py", "app.api.assistant_context"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant.py", "app.api.assistant_conversations"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant.py", "app.api.assistant_stream"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant_stream.py", "app.api.assistant_budget"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant_stream.py", "app.api.assistant_context"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant_stream.py", "app.api.assistant_persistence"): "assistant 子域兄弟模块复用（公开符号）",
    ("api/assistant_stream.py", "app.api.assistant_tool_exec"): "assistant 子域兄弟模块复用（公开符号）",
    # --- resumes 子包：各 *_routes 模块从子包共享层 resumes/_shared 复用
    # 序列化/探活/SSE 帮助函数——_shared 就是该子包的"公共层"，这是合规形态，
    # 登记是为了让"新增绕过 _shared 的导入"现形。
    ("api/resumes/ai_edits_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/resumes/crud_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/resumes/export_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/resumes/generate_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/resumes/layout_render_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/resumes/review_routes.py", "app.api.resumes._shared"): "经子包共享层 _shared 复用（合规形态）",
    # --- webform 子包：同样经 _shared 复用（合规形态）。
    ("api/webform/browser_routes.py", "app.api.webform._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/webform/fill_routes.py", "app.api.webform._shared"): "经子包共享层 _shared 复用（合规形态）",
    ("api/webform/live_routes.py", "app.api.webform._shared"): "经子包共享层 _shared 复用（合规形态）",
    # --- 真·待治理项：browser_routes 两次跨子模块导入 live_routes 的私有函数
    # _start_live_session（下划线符号）。正确修法是把"启动 live 会话"提取进
    # webform/_shared 或 services 层；牵动 live 会话生命周期，留独立批次。
    (
        "api/webform/browser_routes.py",
        "app.api.webform.live_routes",
    ): "跨子模块导入私有 _start_live_session；应提取进 _shared，待治理",
}


# ---------------------------------------------------------------------------
# 规则
# ---------------------------------------------------------------------------


def test_runtime_is_bottom() -> None:
    """``app/runtime/**`` 不得 import ``app.services`` / ``app.api``。

    架构图把 runtime 标为"最底层，不依赖业务"（dataset_scope / operation_budget /
    log_context）；一旦反向依赖，任何业务改动都会拖动运行时基础设施。
    """
    _assert_no_violations(
        "runtime-is-bottom",
        ALLOW_RUNTIME,
        lambda rel, rec, target: rel.startswith("runtime/")
        and target.split(".")[1] in ("services", "api"),
    )


def test_assistant_tools_no_api() -> None:
    """``app/services/assistant_tools/**`` 不得 import ``app.api``。

    助手工具层是服务层：api 编排它，它不能反过来编排 api（SSE 编排留在
    ``api/assistant_stream.py``）。例外见 ALLOW_ASSISTANT_TOOLS_API。
    """
    _assert_no_violations(
        "assistant-tools-no-api",
        ALLOW_ASSISTANT_TOOLS_API,
        lambda rel, rec, target: rel.startswith("services/assistant_tools/")
        and target.split(".")[1] == "api",
    )


def test_models_schemas_no_services_api() -> None:
    """``app/models/**`` 与 ``app/schemas/**`` 不得 import ``app.services`` / ``app.api``。

    models/schemas 是叶子层：被 services/api 消费，不消费业务实现。例外见
    ALLOW_MODELS_SCHEMAS（两处刻意的延迟导入）。
    """
    _assert_no_violations(
        "models-schemas-no-services-api",
        ALLOW_MODELS_SCHEMAS,
        lambda rel, rec, target: rel.split("/")[0] in ("models", "schemas")
        and target.split(".")[1] in ("services", "api"),
    )


def test_api_cross_module_imports() -> None:
    """``app/api/**`` 不得 import 其它 api 子模块的具体符号（跨路由复用须经公共层）。

    本条按 RF-21 口径"先检测并报告"：现状全部记录在 ALLOW_API_CROSS（含归类），
    任何**新增**的跨子模块导入都会失败并要求登记或修复。三类结构性导入天然豁免：

    - 包聚合层（``__init__.py`` 装配子 router / 再导出符号）；
    - 包公共层（``from app.api import settings``）；
    - 装配导入（``from app.api.x import router``——把子路由挂到父路由）。
    """

    def matches(rel: str, rec: ImportRecord, target: str) -> bool:
        # 豁免顺序即可读性：先排除非 api 源/非 api 目标，再逐条放行结构性导入。
        if not rel.startswith("api/") or not target.startswith("app.api"):
            return False
        if target == "app.api":  # 包公共层（from app.api import settings）
            return False
        if rel == _module_to_init_rel(target):  # 自包 __init__ 聚合
            return False
        if rel.split("/")[0] == target.split(".")[1] and rel.endswith("__init__.py"):
            return False
        return rec.names != ("router",)  # 子路由装配（from app.api.x import router）

    _assert_no_violations("api-cross-module-imports", ALLOW_API_CROSS, matches)


def _module_to_init_rel(module: str) -> str:
    """``app.api.resumes`` -> ``api/resumes/__init__.py``。"""
    return module.removeprefix("app.").replace(".", "/") + "/__init__.py"
