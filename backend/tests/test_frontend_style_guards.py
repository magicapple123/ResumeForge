"""守卫：`frontend/src` 里那些**只有真浏览器才看得出、jsdom 测不到**的样式不变量。

为什么值得一条测试守：投投悬浮球的视觉素材必须保持单一职责——球体只显示表情素材，
不再把纸飞机和星星烘焙或叠加到球身上；悬浮球的入口状态与定位样式也必须保持可检索，
否则用户会看到重复图形或在预览弹窗里失去入口。

放在后端测试里而不是前端：jsdom 不解析布局、也不加载 CSS（`?raw` 与
`import.meta.glob` 都被 vitest 的 CSS 处理挡掉，取回来是空串），而前端 tsconfig 不含
`@types/node`，读不到 `node:fs`。本项目已有"用后端测试守前端文件"的先例，见
``test_frontend_module_naming.py``。真正的几何量测在临时脚本里做过（起一个受控浏览器，
量椭圆上四个采样点是否都落在以球心为中心的椭圆上），那类脚本不进仓库。
"""

from __future__ import annotations

from pathlib import Path

FRONTEND_SRC = Path(__file__).resolve().parents[2] / "frontend" / "src"
ORB_TSX = FRONTEND_SRC / "features" / "tou-tou" / "TouTouOrb.tsx"
ORB_CSS = FRONTEND_SRC / "features" / "tou-tou" / "tou-tou.css"
CARD_CSS = FRONTEND_SRC / "features" / "tou-tou" / "tou-tou-assistant.css"


def test_orb_no_longer_renders_satellite_icons():
    component = ORB_TSX.read_text(encoding="utf-8")
    stylesheet = ORB_CSS.read_text(encoding="utf-8")
    assert "PlaneIcon" not in component
    assert "StarIcon" not in component
    assert "tt-orbit" not in component
    assert "tt-orbit" not in stylesheet


def test_orb_position_supports_all_four_edges():
    component = ORB_TSX.read_text(encoding="utf-8")
    hook = (FRONTEND_SRC / "features" / "tou-tou" / "useTouTouOrbDrag.ts").read_text(
        encoding="utf-8"
    )
    for edge in ("left", "right", "top", "bottom"):
        assert f'"{edge}"' in hook
        assert 'is-edge-${position.side}' in component


def test_floating_panel_layout_prerequisites_stay_in_place():
    """浮窗排版有两条"规则静默失效"的坑，各钉一处。

    ① 输入框那条规定必须**直接落在 textarea 上**：当前 antd 的 `Input.TextArea` 不再渲染
    `.ant-input-textarea` 这层包装（实测 textarea 的父节点就是 `.assistant-composer`），
    选择器里串上它会匹配不到，规则一声不吭地失效——`styles/assistant-composer.css` 里那条
    104px 就是这么死的。

    ② 浮窗页容器必须是 `border-box`：全站默认 content-box 时，`height: 100%` 再加上内边距
    会比卡片高出一截，底部那行（发送按钮）被卡片的 `overflow: hidden` 裁掉。
    """
    # 先压平空白：prettier 会按行宽折行，直接比子串会被"换行位置"误伤。
    stylesheet = " ".join(CARD_CSS.read_text(encoding="utf-8").split())

    assert "composer textarea.ant-input" in stylesheet
    assert "box-sizing: border-box" in stylesheet
