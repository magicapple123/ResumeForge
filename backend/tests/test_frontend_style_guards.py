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
COMPOSER_CSS = FRONTEND_SRC / "styles" / "assistant-composer.css"
MAIN_TSX = FRONTEND_SRC / "main.tsx"


def test_popup_zindex_base_stays_above_the_floating_cards():
    """antd 弹层基准 z 必须高于投投助手卡（2990）/剪贴板卡（2985）。

    所有弹层经 getPopupContainer 挂到 body，z 由 seed token ``zIndexPopupBase``（默认
    1000）派生——不提基准的话，浮窗里的右键菜单、下拉、confirm、message 会被卡片整个
    盖住，表现为"点了没反应"（2026-10-02 用户报告的两处 bug 同根因）。jsdom 测不到
    视觉遮挡，在这里钉住配置防回漂。
    """
    text = MAIN_TSX.read_text(encoding="utf-8")
    assert "zIndexPopupBase: 3100" in text


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


def test_full_page_composer_height_rule_targets_the_real_dom():
    """整页的 104px 规则必须落在真实 DOM 上，且"锁高 + 内部滚动"两件套齐全。

    那条规则曾串着 `.ant-input-textarea`（antd 5 不渲染这层包装）静默失效了很久——
    浮窗的同款修复时顺手把它救活，这里钉住两件事防止回归：选择器里**不许再出现**
    那层包装类；高度必须上下同时锁死并允许内部滚动，否则 autoSize 写的内联样式
    会把长文本粘贴时的输入框重新撑开。
    """
    stylesheet = " ".join(COMPOSER_CSS.read_text(encoding="utf-8").split())

    height_rule = stylesheet[stylesheet.index(".assistant-composer textarea.ant-input") :]
    assert "min-height: 104px !important" in height_rule
    assert "max-height: 104px !important" in height_rule
    assert "overflow-y: auto !important" in height_rule
    # 修复后的文件里不允许再有任何 `.ant-input-textarea` 选择器。
    assert ".ant-input-textarea" not in stylesheet


def test_peek_and_petted_presentations_stay_retrievable():
    """探头张望与被抚摸的展示层状态必须保持可检索（组件类名 ↔ 样式表动画成对出现）。

    这两个姿态各自由"JS 侧的类名"与"CSS 侧的关键帧"拼成：任何一半被改名或删除，
    球就会静静躺在边上毫无反应——jsdom 不加载 CSS，只能在这里钉住两半都还在。
    """
    component = ORB_TSX.read_text(encoding="utf-8")
    stylesheet = " ".join(ORB_CSS.read_text(encoding="utf-8").split())

    # 被抚摸：组件叠 is-petted 类，样式表有对应的摇摆关键帧。
    assert '"is-petted"' in component
    assert "tt-pet-sway" in stylesheet
    # 探头张望：动画关键帧在样式表里（脸的选择在组件侧，由 TouTouOrb.test 钉住）。
    assert "tt-peek" in stylesheet
