"""「问投投」：精简版问答通道（从 test_webform_live.py 拆出）。

FakeLiveClient 留在 test_webform_live.py。
"""
import json
import subprocess

from app.services.webform.live import LiveSession
from test_webform_live import FakeLiveClient


class AskRecorder:
    """顶替 _ask_worker 的桩：只记录派发，不真的调模型。"""

    def __init__(self):
        self.pushed: list[tuple[int, str]] = []

    def push(self, seq: int, text: str) -> None:
        self.pushed.append((seq, text))

    def close(self) -> None:
        pass


def _state_with_ask(seq: int, text: str) -> str:
    return json.dumps(
        {
            "seq": 0,
            "control": None,
            "accept": None,
            "remember": None,
            "installed": True,
            "assistant_ask": {"seq": seq, "text": text},
        }
    )


def test_assistant_ask_is_acked_and_dispatched_once():
    """同一个问题在两轮轮询里只派发一次，且 ACK 会清掉页面上的问题全局。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    recorder = AskRecorder()
    session._ask_worker = recorder

    def evaluate(expression, *, timeout=None):
        if "rf:live-state" in expression:
            return _state_with_ask(1, "这个岗位匹配吗")
        return FakeLiveClient.evaluate(client, expression, timeout=timeout)

    client.evaluate = evaluate
    session._tick()
    session._tick()

    assert recorder.pushed == [(1, "这个岗位匹配吗")]
    assert any("rf:assistant-ack" in e for e in client.expressions)


def test_assistant_ask_cursor_resets_after_page_reload():
    """页面跳转后问答历史与 seq 游标一并归零：新文档 seq=1 不被旧游标吞掉。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"})
    recorder = AskRecorder()
    session._ask_worker = recorder
    session._last_ask_sequence = 1

    original_evaluate = client.evaluate

    def evaluate(expression, *, timeout=None):
        if "rf:live-state" in expression:
            payload = json.loads(original_evaluate(expression, timeout=timeout))
            payload["installed"] = False
            return json.dumps(payload)
        return original_evaluate(expression, timeout=timeout)

    client.evaluate = evaluate
    session._tick()  # 重装：游标随新文档归零
    assert session._last_ask_sequence is None
    assert len(session._ask_history) == 0

    client.evaluate = lambda e, timeout=None: (
        _state_with_ask(1, "你好") if "rf:live-state" in e else FakeLiveClient.evaluate(client, e, timeout=timeout)
    )
    session._tick()

    assert recorder.pushed == [(1, "你好")]


def test_ask_reply_is_written_back_with_sequence(monkeypatch):
    """成功的一轮以 {seq, text} 回写，并进入该文档的问答历史。"""
    from app.services.webform import live_assistant

    class AskProvider:
        async def chat(self, messages):
            return "这个问题很难一句话说清，但总体是匹配的。"

    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"}, provider=AskProvider())
    session._run_ask(3, "这个岗位匹配吗")

    replies = [e for e in client.expressions if "rf:assistant-reply" in e]
    assert len(replies) == 1
    assert '"seq": 3' in replies[0] or '"seq":3' in replies[0]
    assert "总体是匹配的" in replies[0]
    # 历史里记下这一轮（user + assistant 各一条）。
    assert len(session._ask_history) == 2
    assert session._ask_history[-1]["content"].startswith("这个问题")
    assert live_assistant.HISTORY_TURNS == 5


def test_ask_without_provider_reports_config_hint(monkeypatch):
    """provider 为 None（没配模型）时页面收到明确的配置提示，而不是含糊的失败。"""
    client = FakeLiveClient()
    session = LiveSession(client, {"name": "张三"}, provider=None)
    session._run_ask(2, "你好")

    replies = [e for e in client.expressions if "rf:assistant-reply" in e]
    assert len(replies) == 1
    assert "未配置模型服务" in replies[0]
    assert "error" in replies[0]
    # 失败的轮次不进历史。
    assert len(session._ask_history) == 0


def test_injected_control_script_has_no_direct_network_access():
    """**安全边界硬性校验**：注入脚本里不允许出现任何直连请求或本地地址。

    页面 JS 只能读写 __rfAssistantAsk / __rfAssistantReply 两个中转全局；
    出现 fetch / XMLHttpRequest / localhost / 回环地址即视为越界。
    """
    from app.services.webform.live_control import (
        install_live_control_script,
        set_assistant_reply_script,
    )

    scripts = [
        install_live_control_script(True),
        install_live_control_script(False),
        set_assistant_reply_script({"seq": 1, "text": "回答"}),
        set_assistant_reply_script({"seq": 1, "error": "出错了"}),
    ]
    for script in scripts:
        assert "fetch(" not in script
        assert "XMLHttpRequest" not in script
        assert "localhost" not in script
        assert "127.0.0.1" not in script


def test_control_ball_uses_lili_avatar_with_gradient_fallback(monkeypatch):
    """球体默认渲染历历形象；资产文件读不到时回退渐变球 + 「填」字，不炸功能。"""
    from app.services.webform import live_control

    with_avatar = live_control.install_live_control_script(True)
    assert "rf-live-avatar" in with_avatar
    # base64 字母表里没有括号，data URI 前缀的完整匹配只能来自真实内嵌的素材。
    assert "data:image/png;base64," in with_avatar
    assert "历历求职助手" in with_avatar

    monkeypatch.setattr(live_control, "_load_face_data_uri", lambda name: None)
    fallback = live_control.install_live_control_script(True)
    # 静态文本只能断言素材字面量：资产缺失时是 null，页面侧 `hasAvatar` 分支据此回退
    # 渐变球 + 「填」字（img 的创建代码在字符串里恒在，运行时才决定走不走）。
    assert "const avatarDataUri = null" in fallback
    assert "'填'" in fallback and "'关'" in fallback


def test_lili_orb_asset_ships_with_the_repository():
    """历历的形象必须**跟着代码一起入库**。

    发行版走 `git archive`，只带被跟踪的文件。素材一旦漏提交，用户装上后
    `avatarDataUri` 是 null，历历就回落成「白圆底 + 填字」——正是用户要求去掉的那圈白底。
    `scripts/Build-Release.ps1` 的 `$RequiredFiles` 也点了它的名（那里是对**归档条目**
    做校验，漏跟踪会在打包时报 missing file），这里再补一道，把话说清楚。
    """
    from pathlib import Path

    from app.services.webform import live_control
    from PIL import Image

    asset = live_control._ASSET_DIR / live_control._LILI_ORB_FILE
    assert asset.is_file(), f"历历素材缺失：{asset}"
    with Image.open(asset) as image:
        assert image.mode == "RGBA", "素材必须是带 alpha 的 PNG（否则会盖住页面底色）"
        alpha = image.getchannel("A")
        assert alpha.getbbox() is not None, "素材整张透明，等于没有形象"
        corners = [
            alpha.getpixel((0, 0)),
            alpha.getpixel((image.width - 1, 0)),
            alpha.getpixel((0, image.height - 1)),
            alpha.getpixel((image.width - 1, image.height - 1)),
        ]
        assert corners == [0, 0, 0, 0], "四角必须是透明的"

    repo_root = Path(__file__).resolve().parents[2]
    if not (repo_root / ".git").exists():
        # 源码包（没有 .git）里跳过这一条，别把测试跑成假红。
        return
    tracked = subprocess.run(
        ["git", "ls-files", "--error-unmatch", str(asset.relative_to(repo_root))],
        cwd=repo_root,
        capture_output=True,
        text=True,
        check=False,
    )
    assert tracked.returncode == 0, f"{asset.name} 没有被 git 跟踪，发行包里不会有它"


def test_control_ball_avatar_is_neither_wrapped_nor_cropped():
    """历历要「只有形象本身」：不留白底白圈，也不把方形素材裁成圆。

    用户明确提过两条：素材里那颗金色星星探出圆盘右上角，`border-radius:50%` +
    `object-fit:cover` 正好把它切掉一块；外面那圈白底/白描边也不是想要的形态。
    改成整块显示后，阴影由 `drop-shadow` 跟着形象走，而不是给按钮画一个圆影。
    """
    from app.services.webform.live_control import install_live_control_script

    script = install_live_control_script(True)
    # 头像整块显示、不裁圆——`object-fit` 必须是 contain（cover 会切掉星星）。
    assert ".rf-live-avatar{width:100%;height:100%;object-fit:contain" in script
    # 有形象时不留底色与描边；关闭态的灰底也要让位。
    assert ".rf-live-switch.has-avatar{background:transparent;border-color:transparent" in script
    assert ".rf-live-switch.has-avatar.off{background:transparent}" in script


def test_control_ball_design_contract():
    """历历的交互与视觉契约：静态形象、无绿圈、无右上角加号、按住即拖、双击开菜单。

    用户明确要求过这几条（绿圈难看、加号改双击、长按改按住即拖），写成断言防止回漂。
    """
    from app.services.webform.live_control import install_live_control_script

    script = install_live_control_script(True)
    # 绿圈：::after 的绿色描边已删。
    assert "52c41a" not in script
    # 右上角"+"展开按钮已删，菜单改由双击球触发。
    assert "rf-live-expand" not in script
    assert "展开网申智能助手" not in script
    # 单击/双击判窗与按住即拖的落点。
    assert "CLICK_WINDOW_MS" in script
    assert "lastClickAt" in script
    # 长按计时不复存在：不再有 280ms 的 dragTimer。
    assert "dragTimer" not in script
    assert "双击打开菜单" in script
    assert "按住拖动" in script
