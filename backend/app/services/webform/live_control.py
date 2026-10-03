"""专用浏览器内的实时填表悬浮球「历历」。

页面只负责把用户的开关/拖动动作写进一个受用的 window 状态；
Python 侧通过 CDP 轮询这个状态，再决定当前标签页是否继续处理焦点。
这样网页不需要、也不能直接访问 ResumeForge 的本地 API。

历历与主界面的「投投」是两个吉祥物：历历是**静态**的（一张图，无表情动画），
交互为——单击切换实时填表开关、双击展开/收起菜单、按住左键即可拖动（无需长按）。

「问历历」问答走同一条中转纪律：页面把 ``{seq, text}`` 写进
``window.__rfAssistantAsk``，Python 轮询读到后调模型，再把 ``{seq, text|error}``
写回 ``window.__rfAssistantReply``。**注入脚本里没有任何对本地 API 的请求**——
素材也以 base64 data URI 随脚本携带，不给第三方页面留直连通道。
"""
from __future__ import annotations

import base64
import json
from pathlib import Path

# 吉祥物素材目录（``backend/app/assets``，透明底小图，由美术原图切出）。
_ASSET_DIR = Path(__file__).resolve().parents[2] / "assets"
# 历历的形象：``deliverables/mascot/02-投投-悬浮球B-简历球.png`` 的 128px 透明底版，
# 由 ``backend/scripts/build_lili_orb.py`` 生成（抠底 / 按内容重新定框 / 缩放）。
# **别按"圆形裁切"处理这张图**：右上角的星星探出球体、球下还有一层投影，
# 裁圆会把它们切掉。资产缺失时回退为渐变球 + 文字，不炸功能。
_LILI_ORB_FILE = "lili/lili-orb-128.png"


def _load_face_data_uri(filename: str) -> str | None:
    """把 96px 吉祥物形象读成 base64 data URI；文件缺失时返回 None（脚本侧降级为渐变球）。

    为什么内嵌而不是让页面去取：注入脚本运行在第三方网页上下文，任何对本地 API 的
    请求都是被禁止的安全边界；素材随脚本一起进去是唯一合规的携带方式。
    """
    try:
        raw = (_ASSET_DIR / filename).read_bytes()
    except OSError:
        return None
    return f"data:image/png;base64,{base64.b64encode(raw).decode('ascii')}"


def install_live_control_script(enabled: bool = True) -> str:
    """返回幂等的悬浮球安装脚本。"""
    initial = "true" if enabled else "false"
    avatar = _load_face_data_uri(_LILI_ORB_FILE)
    avatar_literal = json.dumps(avatar)
    return f"""
(() => {{
  /* rf:live-control */
  const host = document.getElementById('__rf_live_host__');
  if (!host || !host.shadowRoot) return 'missing';
  const shadow = host.shadowRoot;
  const avatarDataUri = {avatar_literal};
  const hasAvatar =
    typeof avatarDataUri === 'string' && avatarDataUri.indexOf('data:image/png;base64,') === 0;
  const stylesheet = [
    '.rf-live-switch{{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:64px;height:64px;',
    'box-sizing:border-box;border:1px solid rgba(255,255,255,.82);border-radius:50%;',
    'background:#fff;color:#fff;',
    'box-shadow:0 14px 34px rgba(16,56,108,.26),0 3px 9px rgba(16,56,108,.18);',
    'font:700 12px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    'letter-spacing:.02em;cursor:pointer;touch-action:none;user-select:none;appearance:none;',
    'transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease;',
    'display:grid;place-items:center;padding:0;isolation:isolate}}',
    '.rf-live-switch.off{{background:#e6ebf2;opacity:.92;',
    'box-shadow:0 8px 20px rgba(16,24,40,.2),0 2px 6px rgba(16,24,40,.16)}}',
    '.rf-live-switch:hover{{transform:translateY(-2px);box-shadow:0 16px 36px rgba(16,56,108,.32),0 4px 10px rgba(16,56,108,.2)}}',
    '.rf-live-switch:active{{transform:scale(.96)}}',
    '.rf-live-switch.dragging{{cursor:grabbing;box-shadow:0 14px 32px rgba(16,56,108,.3)}}',
    '.rf-live-switch:focus-visible{{outline:3px solid rgba(145,202,255,.9);outline-offset:4px}}',
    '.rf-live-autofill-menu{{position:fixed;z-index:2147483646;width:236px;padding:10px;',
    'border:1px solid rgba(145,202,255,.62);border-radius:16px;background:rgba(255,255,255,.96);',
    'box-shadow:0 18px 46px rgba(16,56,108,.22);backdrop-filter:blur(14px);opacity:0;',
    'transform:translateY(8px) scale(.96);pointer-events:none;transition:opacity .18s ease,transform .18s ease}}',
    '.rf-live-autofill-menu.on{{opacity:1;transform:translateY(0) scale(1);pointer-events:auto}}',
    '.rf-live-autofill-title{{display:flex;align-items:center;justify-content:space-between;gap:8px;',
    'color:#19324d;font:700 12px/1.5 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif}}',
    '.rf-live-autofill-title span{{color:#7a8da6;font-size:10px;font-weight:500}}',
    '.rf-live-autofill-button{{width:100%;margin-top:9px;padding:8px 10px;border:0;border-radius:10px;',
    'background:linear-gradient(135deg,#1677ff,#155eef);color:#fff;font:700 12px/1.4 inherit;',
    'cursor:pointer;transition:transform .16s ease,box-shadow .16s ease,opacity .16s ease}}',
    '.rf-live-autofill-button:hover{{transform:translateY(-1px);box-shadow:0 7px 18px rgba(22,119,255,.28)}}',
    '.rf-live-autofill-button:disabled{{opacity:.55;cursor:default;transform:none;box-shadow:none}}',
    '.rf-live-autofill-progress{{min-height:18px;margin-top:7px;color:#667991;font:11px/1.5 inherit}}',
    '.rf-live-trail{{position:fixed;inset:0;z-index:2147483645;pointer-events:none;overflow:hidden}}',
    '.rf-live-trail-dot{{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;',
    'background:radial-gradient(circle,#91caff 0%,rgba(22,119,255,.8) 42%,rgba(22,119,255,0) 72%);',
    'animation:rf-live-trail-fade .42s ease-out forwards}}',
    '@keyframes rf-live-trail-fade{{0%{{opacity:.82;transform:scale(1)}}100%{{opacity:0;transform:scale(.15)}}}}',
    /* 历历：整颗球就是形象本身，**不加白底、不加白描边、不裁圆**。
       以前这里写的是 border-radius:50% + object-fit:cover，等于把方形素材裁成圆：星星
       在素材里探出圆盘右上角，正好落在圆外，于是被切掉一块（用户反馈过）。改成整块方形
       显示，阴影也跟着形象走（drop-shadow 按 alpha 描边），而不是给按钮画一个圆影。 */
    /* 不再额外加 drop-shadow：素材自己带一层投影，再叠一层会多出一个晕圈。 */
    '.rf-live-avatar{{width:100%;height:100%;object-fit:contain;display:block}}',
    '.rf-live-switch.has-avatar{{background:transparent;border-color:transparent;box-shadow:none;padding:0}}',
    '.rf-live-switch.has-avatar:hover,.rf-live-switch.has-avatar.dragging{{box-shadow:none}}',
    '.rf-live-switch.off .rf-live-avatar{{filter:grayscale(1) opacity(.8)}}',
    '.rf-live-switch.off{{background:#e6ebf2}}',
    '.rf-live-switch.has-avatar.off{{background:transparent}}',
    '.rf-live-ask-toggle{{width:100%;margin-top:9px;padding:8px 10px;border:1px solid rgba(21,94,239,.35);',
    'border-radius:10px;background:#fff;color:#155eef;font:700 12px/1.4 inherit;cursor:pointer;',
    'transition:background .16s ease}}',
    '.rf-live-ask-toggle:hover{{background:#eff6ff}}',
    '.rf-live-ask-panel{{display:none;margin-top:9px}}',
    '.rf-live-ask-panel.on{{display:block}}',
    '.rf-live-ask-log{{display:flex;flex-direction:column;gap:6px;max-height:180px;overflow-y:auto;padding:2px}}',
    '.rf-live-ask-bubble{{max-width:88%;padding:6px 9px;border-radius:10px;white-space:pre-wrap;',
    'word-break:break-word;font:12px/1.55 inherit}}',
    '.rf-live-ask-bubble.user{{align-self:flex-end;background:#e8f1ff;color:#173a5e;border:1px solid #cfe3ff}}',
    '.rf-live-ask-bubble.assistant{{align-self:flex-start;background:#f4f7fb;color:#244364;border:1px solid #dbe6f2}}',
    '.rf-live-ask-input{{display:block;width:100%;box-sizing:border-box;margin-top:8px;padding:6px 8px;',
    'border:1px solid #c9d9ec;border-radius:8px;font:12px/1.5 inherit;resize:vertical}}',
    '.rf-live-ask-input:focus{{outline:2px solid rgba(22,119,255,.35);border-color:#1677ff}}',
    '.rf-live-ask-send{{width:100%;margin-top:7px;padding:7px 10px;border:0;border-radius:10px;',
    'background:linear-gradient(135deg,#1677ff,#155eef);color:#fff;font:700 12px/1.4 inherit;',
    'cursor:pointer;transition:opacity .16s ease}}',
    '.rf-live-ask-send:disabled{{opacity:.55;cursor:default}}',
    '.rf-live-ask-note{{min-height:16px;margin-top:6px;color:#a05a1f;font:11px/1.5 inherit}}',
  ].join('');

  /*
   * 已经装过就不再重建 DOM，但**样式与形象要刷新成最新的**：这段脚本跟着应用版本走，
   * 而页面里那颗球是"注入那一刻"的样子。不刷新的话，升级后不重载页面就永远看不到新外观
   * ——用户反馈的"悬停仍有一圈深蓝底色"就是这么来的（那条 :hover 阴影早删了，
   * 页面上用的还是老样式表）。
   */
  const existing = shadow.querySelector('.rf-live-switch');
  if (existing) {{
    let existingStyle = shadow.querySelector('style.rf-live-style');
    if (!existingStyle) {{
      existingStyle = document.createElement('style');
      shadow.appendChild(existingStyle);
    }}
    existingStyle.className = 'rf-live-style';
    existingStyle.textContent = stylesheet;
    const existingAvatar = shadow.querySelector('.rf-live-avatar');
    if (hasAvatar && existingAvatar) existingAvatar.src = avatarDataUri;
    return '1';
  }}

  const style = document.createElement('style');
  style.className = 'rf-live-style';
  style.textContent = stylesheet;
  shadow.appendChild(style);

  const trail = document.createElement('div');
  trail.className = 'rf-live-trail';
  shadow.appendChild(trail);

  const ball = document.createElement('button');
  ball.className = 'rf-live-switch';
  ball.type = 'button';
  ball.setAttribute('aria-label', '历历求职助手：实时填表已开启，单击切换，双击打开菜单，按住拖动');
  shadow.appendChild(ball);

  // 历历形象：data URI 由 Python 侧随脚本内嵌（资产缺失时为 null，回退渐变球 + 文字）。
  if (hasAvatar) {{
    ball.classList.add('has-avatar');
    const avatarImg = document.createElement('img');
    avatarImg.className = 'rf-live-avatar';
    avatarImg.alt = '';
    avatarImg.src = avatarDataUri;
    ball.appendChild(avatarImg);
  }}

  const menu = document.createElement('div');
  menu.className = 'rf-live-autofill-menu';
  menu.innerHTML = '<div class="rf-live-autofill-title">当前页面助手<span>仅填写，不替你提交</span></div>' +
    '<button class="rf-live-autofill-button" type="button">自动填写当前页面</button>' +
    '<div class="rf-live-autofill-progress" aria-live="polite"></div>';
  shadow.appendChild(menu);
  const autoFillButton = menu.querySelector('.rf-live-autofill-button');
  const autoFillProgress = menu.querySelector('.rf-live-autofill-progress');

  // ===== 问历历：精简版问答（问题文本 in / 回答文本 out，一切经 Python 中转） =====
  const askToggle = document.createElement('button');
  askToggle.className = 'rf-live-ask-toggle';
  askToggle.type = 'button';
  askToggle.textContent = '问历历';
  askToggle.setAttribute('aria-expanded', 'false');
  menu.appendChild(askToggle);

  const askPanel = document.createElement('div');
  askPanel.className = 'rf-live-ask-panel';
  // maxlength 与后端 live_assistant.ASK_MAX_CHARS（2000）同值：页面拦一层，Python 再兜一层。
  askPanel.innerHTML = '<div class="rf-live-ask-log"></div>' +
    '<textarea class="rf-live-ask-input" rows="2" maxlength="2000" ' +
    'placeholder="问历历：岗位、简历、填表问题…"></textarea>' +
    '<button class="rf-live-ask-send" type="button">发送</button>' +
    '<div class="rf-live-ask-note" aria-live="polite"></div>';
  menu.appendChild(askPanel);
  const askLog = askPanel.querySelector('.rf-live-ask-log');
  const askInput = askPanel.querySelector('.rf-live-ask-input');
  const askSend = askPanel.querySelector('.rf-live-ask-send');
  const askNote = askPanel.querySelector('.rf-live-ask-note');

  let askOpen = false;
  let askSequence = 0;
  let pendingAskSeq = null;
  let askNoteText = '';
  const askEntries = [];
  const ASK_LOG_LIMIT = 10; /* 气泡只留最近 10 条（历史上下文轮数由 Python 侧管理）。 */

  const renderAsk = () => {{
    askPanel.classList.toggle('on', askOpen);
    askToggle.textContent = askOpen ? '收起问答' : '问历历';
    askToggle.setAttribute('aria-expanded', askOpen ? 'true' : 'false');
    if (askSend) askSend.disabled = pendingAskSeq !== null;
    if (askNote) askNote.textContent = pendingAskSeq !== null ? '历历思考中…' : askNoteText;
    if (askLog) {{
      askLog.textContent = '';
      askEntries.forEach((item) => {{
        const bubble = document.createElement('div');
        bubble.className = 'rf-live-ask-bubble ' + (item.role === 'user' ? 'user' : 'assistant');
        bubble.textContent = item.text;
        askLog.appendChild(bubble);
      }});
      askLog.scrollTop = askLog.scrollHeight;
    }}
    positionDock();
  }};
  askToggle.addEventListener('click', (event) => {{
    event.preventDefault();
    event.stopPropagation();
    askOpen = !askOpen;
    renderAsk();
  }});
  if (askSend) askSend.addEventListener('click', (event) => {{
    event.preventDefault();
    event.stopPropagation();
    if (pendingAskSeq !== null) return;
    const text = String((askInput && askInput.value) || '').trim();
    if (!text) return;
    askSequence += 1;
    pendingAskSeq = askSequence;
    askNoteText = '';
    askEntries.push({{role: 'user', text: text}});
    while (askEntries.length > ASK_LOG_LIMIT) askEntries.shift();
    if (askInput) askInput.value = '';
    // 写进受控全局，由 Python 轮询取走（ACK 后清空）；页面**绝不**直连本地 API。
    window.__rfAssistantAsk = {{seq: askSequence, text: text}};
    renderAsk();
  }});
  // Python 侧的回写入口：seq 对上才渲染，过期回答直接丢弃（最新一问才有意义）。
  window.__rfSetAssistantReply = (payload) => {{
    if (!payload || typeof payload !== 'object') return;
    const replySeq = Number(payload.seq) || 0;
    if (replySeq !== pendingAskSeq) return;
    pendingAskSeq = null;
    if (payload.error) {{
      askNoteText = String(payload.error);
    }} else if (payload.text) {{
      askNoteText = '';
      askEntries.push({{role: 'assistant', text: String(payload.text)}});
      while (askEntries.length > ASK_LOG_LIMIT) askEntries.shift();
    }}
    renderAsk();
  }};

  let enabled = window.__rfLiveEnabled !== false && {initial};
  let sequence = Number(window.__rfLiveControl && window.__rfLiveControl.seq) || 0;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let expanded = false;
  /* 单击（切换实时填表）与双击（展开/收起菜单）的判窗：第一次点击挂起 300ms，
     第二次落进窗口就取消挂起、改切菜单——两套手势共享一次按压。 */
  const CLICK_WINDOW_MS = 300;
  let lastClickAt = 0;
  let clickTimer = 0;
  let autoSequence = Number(window.__rfAutoFillRequest && window.__rfAutoFillRequest.seq) || 0;
  let autoStatus = window.__rfAutoFillStatus || {{state: 'idle', total: 0, form_control_total: 0, recognized_total: 0, completed: 0, filled: 0, failed: 0}};
  let lastTrailAt = 0;

  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));
  const savePosition = () => {{
    try {{
      sessionStorage.setItem('rf-live-switch-position', JSON.stringify({{
        left: parseFloat(ball.style.left || '0'), top: parseFloat(ball.style.top || '0')
      }}));
    }} catch (_error) {{}}
  }};
  const restorePosition = () => {{
    try {{
      const saved = JSON.parse(sessionStorage.getItem('rf-live-switch-position') || 'null');
      if (!saved || !Number.isFinite(saved.left) || !Number.isFinite(saved.top)) return;
      ball.style.left = clamp(saved.left, 8, Math.max(8, innerWidth - ball.offsetWidth - 8)) + 'px';
      ball.style.top = clamp(saved.top, 8, Math.max(8, innerHeight - ball.offsetHeight - 8)) + 'px';
      ball.style.right = 'auto'; ball.style.bottom = 'auto';
    }} catch (_error) {{}}
  }};
  const positionDock = () => {{
    const rect = ball.getBoundingClientRect();
    const gap = 8;
    const menuWidth = menu.offsetWidth || 236;
    const menuHeight = menu.offsetHeight || 104;
    const left = clamp(rect.right - menuWidth, gap, Math.max(gap, innerWidth - menuWidth - gap));
    const top = rect.top - menuHeight - gap >= gap ? rect.top - menuHeight - gap : rect.bottom + gap;
    menu.style.left = left + 'px';
    menu.style.top = clamp(top, gap, Math.max(gap, innerHeight - menuHeight - gap)) + 'px';
  }};

  const renderAutoFill = () => {{
    const state = String(autoStatus && autoStatus.state || 'idle');
    const running = state === 'requested' || state === 'filling';
    if (autoFillButton) {{
      autoFillButton.disabled = !enabled || running;
      autoFillButton.textContent = running ? '正在填写中…' : '自动填写当前页面';
    }}
    if (autoFillProgress) {{
      const total = Number(autoStatus && autoStatus.total) || 0;
      const formTotal = Number(autoStatus && autoStatus.form_control_total) || total;
      const recognizedTotal = Number(autoStatus && autoStatus.recognized_total) || total;
      const completed = Number(autoStatus && autoStatus.completed) || 0;
      const filled = Number(autoStatus && autoStatus.filled) || 0;
      const current = String(autoStatus && autoStatus.current_label || '');
      if (running) autoFillProgress.textContent = current ? `正在填写：${{current}}（${{completed}}/${{recognizedTotal}}）` : '正在识别当前页面…';
      else if (state === 'done') autoFillProgress.textContent = String(autoStatus.message || `已完成 ${{filled}}/${{formTotal}} 个表单框，请回到页面核对`);
      else if (state === 'cancelled' || state === 'error') autoFillProgress.textContent = String(autoStatus.message || '自动填写已停止');
      else autoFillProgress.textContent = '识别到的字段会逐项写入，已有内容不会覆盖。';
    }}
    menu.classList.toggle('on', expanded);
    positionDock();
  }};

  const render = () => {{
    ball.classList.toggle('off', !enabled);
    // 渐变球回退时用文字承载「填」的语义；有历历形象时用置灰表达关闭态。
    if (!hasAvatar) ball.textContent = enabled ? '填' : '关';
    ball.title = enabled
      ? '历历求职助手：实时填表已开启。单击切换，双击打开菜单，按住拖动'
      : '历历求职助手：实时填表已关闭。单击开启，双击打开菜单，按住拖动';
    ball.setAttribute('aria-label', enabled
      ? '历历求职助手：实时填表已开启，单击切换，双击打开菜单，按住拖动'
      : '历历求职助手：实时填表已关闭，单击开启，双击打开菜单');
    ball.setAttribute('aria-pressed', enabled ? 'true' : 'false');
    window.__rfLiveEnabled = enabled;
    renderAutoFill();
  }};
  const publish = (bump) => {{
    if (bump) sequence += 1;
    window.__rfLiveControl = {{enabled, seq: sequence}};
    if (!enabled) {{
      expanded = false;
      window.__rfHidePanel && window.__rfHidePanel();
      window.__rfAccept = null;
      window.__rfRemember = null;
    }}
    render();
  }};
  window.__rfSetLiveEnabled = (next) => {{
    enabled = Boolean(next);
    publish(false);
  }};
  window.__rfSetAutoFillStatus = (next) => {{
    autoStatus = next && typeof next === 'object' ? next : {{state: 'idle'}};
    renderAutoFill();
    if (autoStatus.state === 'done' || autoStatus.state === 'cancelled' || autoStatus.state === 'error') {{
      const current = autoStatus;
      window.setTimeout(() => {{
        if (autoStatus === current || autoStatus.state === current.state) {{
          autoStatus = {{state: 'idle', total: current.total || 0, form_control_total: current.form_control_total || 0, recognized_total: current.recognized_total || 0, completed: current.completed || 0, filled: current.filled || 0, failed: current.failed || 0}};
          renderAutoFill();
        }}
      }}, 2200);
    }}
  }};
  const stopDrag = () => {{
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', stopDrag, true);
    window.removeEventListener('pointercancel', stopDrag, true);
    if (dragging) {{
      // 按住并移动了：这是一次拖动，落点已跟手写好，保存即可。
      dragging = false;
      ball.classList.remove('dragging');
      savePosition();
      positionDock();
    }} else if (!moved) {{
      // 没有移动：这是一次点击。进单击/双击判窗——第一次挂起 300ms 后切换
      // 实时填表开关；第二次落进窗口则取消挂起、改为展开/收起菜单。
      const now = Date.now();
      if (now - lastClickAt <= CLICK_WINDOW_MS) {{
        lastClickAt = 0;
        window.clearTimeout(clickTimer);
        expanded = !expanded;
        renderAutoFill();
        return;
      }}
      lastClickAt = now;
      window.clearTimeout(clickTimer);
      clickTimer = window.setTimeout(() => {{
        clickTimer = 0;
        enabled = !enabled;
        publish(true);
      }}, CLICK_WINDOW_MS);
    }}
  }};
  const move = (event) => {{
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    // 按住即可拖（不再等长按计时）：位移超过阈值就进入拖拽、开始跟手。
    if (!dragging && Math.hypot(dx, dy) > 8) {{
      moved = true;
      dragging = true;
      ball.classList.add('dragging');
      window.clearTimeout(clickTimer);
      lastClickAt = 0;
      return;
    }}
    if (!dragging) return;
    const left = clamp(originLeft + dx, 8, Math.max(8, innerWidth - ball.offsetWidth - 8));
    const top = clamp(originTop + dy, 8, Math.max(8, innerHeight - ball.offsetHeight - 8));
    ball.style.left = left + 'px'; ball.style.top = top + 'px';
    ball.style.right = 'auto'; ball.style.bottom = 'auto';
    const now = performance.now();
    if (now - lastTrailAt > 30) {{
      lastTrailAt = now;
      const dot = document.createElement('i');
      dot.className = 'rf-live-trail-dot';
      dot.style.left = (left + ball.offsetWidth / 2) + 'px';
      dot.style.top = (top + ball.offsetHeight / 2) + 'px';
      trail.appendChild(dot);
      window.setTimeout(() => dot.remove(), 460);
    }}
    positionDock();
  }};
  ball.addEventListener('pointerdown', (event) => {{
    if (event.button !== 0) return;
    moved = false; dragging = false;
    startX = event.clientX; startY = event.clientY;
    const rect = ball.getBoundingClientRect();
    originLeft = rect.left; originTop = rect.top;
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', stopDrag, true);
    window.addEventListener('pointercancel', stopDrag, true);
    event.preventDefault();
  }});
  if (autoFillButton) autoFillButton.addEventListener('click', (event) => {{
    event.preventDefault();
    event.stopPropagation();
    if (!enabled || (autoStatus && (autoStatus.state === 'requested' || autoStatus.state === 'filling'))) return;
    autoSequence += 1;
    window.__rfAutoFillRequest = {{seq: autoSequence}};
    autoStatus = {{state: 'requested', seq: autoSequence, total: 0, form_control_total: 0, recognized_total: 0, completed: 0, filled: 0, failed: 0}};
    expanded = true;
    renderAutoFill();
  }});
  window.addEventListener('resize', () => {{ restorePosition(); positionDock(); }}, true);
  restorePosition();
  publish(false);
  return '1';
}})()
"""


LIVE_CONTROL_STATE_SCRIPT = """
(() => {
  /* rf:live-control-state */
const value = window.__rfLiveControl;
  return JSON.stringify(value && typeof value === 'object'
    ? {
        enabled: value.enabled !== false,
        seq: Number(value.seq) || 0,
        autofill: window.__rfAutoFillRequest || null,
        autofill_status: window.__rfAutoFillStatus || null,
      }
    : {enabled: true, seq: 0, autofill: window.__rfAutoFillRequest || null, autofill_status: window.__rfAutoFillStatus || null});
})()
"""


def set_live_enabled_script(enabled: bool) -> str:
    value = json.dumps(bool(enabled))
    return (
        "(() => { /* rf:live-control-set */"
        f" window.__rfSetLiveEnabled && window.__rfSetLiveEnabled({value}); return '1'; }})()"
    )


def set_autofill_status_script(status: dict[str, object]) -> str:
    """把后台逐项填充进度推回悬浮球，不依赖主应用轮询。"""
    payload = json.dumps(status, ensure_ascii=False)
    return (
        "(() => { /* rf:autofill-status */"
        f" window.__rfAutoFillStatus = {payload};"
        f" window.__rfSetAutoFillStatus && window.__rfSetAutoFillStatus({payload});"
        " return '1'; })()"
    )


def set_assistant_reply_script(payload: dict[str, object]) -> str:
    """把「问投投」的回答/错误写回页面（``{seq, text}`` 或 ``{seq, error}``）。

    与 ``set_autofill_status_script`` 同款先存全局再调回调的写法：即使面板刚好错过
    回调（比如正在重渲染），状态也从 ``window.__rfAssistantReply`` 拿得到。
    """
    serialized = json.dumps(payload, ensure_ascii=False)
    return (
        "(() => { /* rf:assistant-reply */"
        f" window.__rfAssistantReply = {serialized};"
        f" window.__rfSetAssistantReply && window.__rfSetAssistantReply({serialized});"
        " return '1'; })()"
    )


__all__ = [
    "LIVE_CONTROL_STATE_SCRIPT",
    "install_live_control_script",
    "set_assistant_reply_script",
    "set_autofill_status_script",
    "set_live_enabled_script",
]
