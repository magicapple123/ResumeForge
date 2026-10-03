"""「只填不交」的机械守卫。

产品要求是硬的：**填完由用户自己在页面上核对并提交，程序绝不代提交**。口头约定会被
"顺手加个『下一步』"慢慢磨掉，所以把它变成两条不会过期的检查：

1. **源码里不存在提交类调用**——``form.submit()`` / ``requestSubmit()`` 之类。
   注意"点一下『下一步』"在多数实现里等价于一次提交，所以按钮点击同样算。
2. **可信鼠标事件只从共享原语发出**，且只作用在单选/复选上（改变选项状态），
   不是用来按任何按钮。
"""
import ast
from pathlib import Path

WEBFORM_DIR = Path(__file__).resolve().parents[1] / "app" / "services" / "webform"

# 只看**调用形状**，不看裸词。
#
# 这里踩过一次坑：最初把 `'submit'` 也列进去，结果立刻误报——因为快照脚本里
# `t === 'submit'` 是在**跳过**提交按钮，那正是安全机制本身。判据要能区分
# "提到提交"与"去提交"。
FORBIDDEN_CALL_SNIPPETS = (
    ".submit(",
    "requestSubmit",
    "request_submit(",
)


def _python_sources() -> list[Path]:
    return sorted(WEBFORM_DIR.rglob("*.py"))


def test_no_submit_calls_anywhere_in_the_webform_package():
    offenders: list[str] = []
    for path in _python_sources():
        text = path.read_text(encoding="utf-8")
        for snippet in FORBIDDEN_CALL_SNIPPETS:
            if snippet in text:
                offenders.append(f"{path.relative_to(WEBFORM_DIR)}: {snippet}")
    assert not offenders, (
        "网申填表包内出现了提交类调用：" + "; ".join(offenders) + "。"
        "这个功能只填不交——提交必须由用户在页面上自己点。"
    )


def test_no_ast_call_named_submit():
    """上面那条是文本扫描，可能被字符串拼接绕过；再用 AST 兜一层。"""
    offenders: list[str] = []
    for path in _python_sources():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            name = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            if name in ("submit", "requestSubmit", "request_submit"):
                offenders.append(f"{path.name}:{node.lineno} {name}()")
    assert not offenders, f"出现了提交调用：{offenders}"


def test_the_package_never_dispatches_mouse_events_itself():
    """点击统一走 ``browser.interaction``；本包直接发鼠标事件就意味着绕过了那层约定。"""
    for path in _python_sources():
        assert "dispatchMouseEvent" not in path.read_text(encoding="utf-8"), (
            f"{path.name} 直接派发了鼠标事件，应改用 services/browser/interaction.py"
        )


def test_snapshot_script_skips_submit_like_controls():
    """提交类控件连定位符都不该拿到——这是"绝不自动提交"的第一道机械保证。

    快照脚本会跳过 ``hidden`` / ``submit`` / ``button`` / ``reset`` / ``image``，
    所以它们永远不会出现在控件清单里，后面的匹配与填充也就无从触及。
    """
    from app.services.webform.engine import CONTROLS_SCRIPT

    for kind in ("'submit'", "'button'", "'reset'", "'image'", "'password'"):
        assert kind in CONTROLS_SCRIPT, f"快照脚本没有跳过 {kind}"


def test_click_selector_is_only_used_for_choice_controls():
    """静态检查：``click_selector`` 的唯一调用点必须在 ``_apply_choice`` 里。

    （行为层面的验证在 ``test_webform_engine.py``：复选框那两条断言了点击只在
    需要改变勾选状态时发生。）
    """
    # engine 拆包为 engine/ 后，静态检查覆盖包内全部源文件（断言语义不变）。
    trees = [
        ast.parse(path.read_text(encoding="utf-8"))
        for path in sorted((WEBFORM_DIR / "engine").glob("*.py"))
    ]
    callers = {
        node.name
        for tree in trees
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and any(
            isinstance(inner, ast.Call)
            and isinstance(inner.func, ast.Name)
            and inner.func.id == "click_selector"
            for inner in ast.walk(node)
        )
    }
    assert callers == {"_apply_choice"}, f"click_selector 出现在了意料之外的函数里：{callers}"
