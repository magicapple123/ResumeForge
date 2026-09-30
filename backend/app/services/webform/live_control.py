"""专用浏览器内的实时填表悬浮球。

页面只负责把用户的开关/拖动动作写进一个受控的 window 状态；
Python 侧通过 CDP 轮询这个状态，再决定当前标签页是否继续处理焦点。
这样网页不需要、也不能直接访问 ResumeForge 的本地 API。
"""
from __future__ import annotations

import json


def install_live_control_script(enabled: bool = True) -> str:
    """返回幂等的悬浮球安装脚本。"""
    initial = "true" if enabled else "false"
    return f"""
(() => {{
  /* rf:live-control */
  const host = document.getElementById('__rf_live_host__');
  if (!host || !host.shadowRoot) return 'missing';
  const shadow = host.shadowRoot;
  if (shadow.querySelector('.rf-live-switch')) return '1';

  const style = document.createElement('style');
  style.textContent = [
    '.rf-live-switch{{position:fixed;right:20px;bottom:20px;z-index:2147483646;width:54px;height:54px;',
    'box-sizing:border-box;border:1px solid rgba(255,255,255,.82);border-radius:50%;',
    'background:linear-gradient(145deg,#2f80ed,#155eef);color:#fff;',
    'box-shadow:0 14px 34px rgba(16,56,108,.26),0 3px 9px rgba(16,56,108,.18);',
    'font:700 12px/1 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;',
    'letter-spacing:.02em;cursor:pointer;touch-action:none;user-select:none;appearance:none;',
    'transition:transform .16s ease,background .16s ease,box-shadow .16s ease,opacity .16s ease;',
    'display:grid;place-items:center;padding:0;isolation:isolate}}',
    '.rf-live-switch::before{{content:"";position:absolute;inset:5px;border:1px solid rgba(255,255,255,.3);',
    'border-radius:50%;pointer-events:none}}',
    '.rf-live-switch::after{{content:"";position:absolute;inset:-4px;border:2px solid #52c41a;',
    'border-radius:50%;opacity:.9;pointer-events:none;transition:border-color .16s ease,opacity .16s ease}}',
    '.rf-live-switch.off{{background:linear-gradient(145deg,#667085,#475467);opacity:.92;',
    'box-shadow:0 8px 20px rgba(16,24,40,.2),0 2px 6px rgba(16,24,40,.16)}}',
    '.rf-live-switch.off::after{{border-color:#98a2b3;opacity:.75}}',
    '.rf-live-switch:hover{{transform:translateY(-2px);box-shadow:0 16px 36px rgba(16,56,108,.32),0 4px 10px rgba(16,56,108,.2)}}',
    '.rf-live-switch:active{{transform:scale(.96)}}',
    '.rf-live-switch.dragging{{transform:scale(1.06);cursor:grabbing;box-shadow:0 14px 32px rgba(16,56,108,.3)}}',
    '.rf-live-switch:focus-visible{{outline:3px solid rgba(145,202,255,.9);outline-offset:4px}}',
    '.rf-live-expand{{position:fixed;z-index:2147483647;width:20px;height:20px;border:1px solid rgba(255,255,255,.9);',
    'border-radius:50%;background:#fff;color:#155eef;box-shadow:0 4px 12px rgba(16,56,108,.22);',
    'font:700 14px/16px -apple-system,"Segoe UI",sans-serif;cursor:pointer;padding:0;transition:transform .18s ease,opacity .18s ease}}',
    '.rf-live-expand:hover{{transform:scale(1.12)}}',
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
  ].join('');
  shadow.appendChild(style);

  const trail = document.createElement('div');
  trail.className = 'rf-live-trail';
  shadow.appendChild(trail);

  const ball = document.createElement('button');
  ball.className = 'rf-live-switch';
  ball.type = 'button';
  ball.setAttribute('aria-label', '智能逐项填表：已开启，长按拖动');
  shadow.appendChild(ball);

  const expand = document.createElement('button');
  expand.className = 'rf-live-expand';
  expand.type = 'button';
  expand.textContent = '+';
  expand.setAttribute('aria-label', '展开网申智能助手');
  shadow.appendChild(expand);

  const menu = document.createElement('div');
  menu.className = 'rf-live-autofill-menu';
  menu.innerHTML = '<div class="rf-live-autofill-title">当前页面助手<span>仅填写，不替你提交</span></div>' +
    '<button class="rf-live-autofill-button" type="button">自动填写当前页面</button>' +
    '<div class="rf-live-autofill-progress" aria-live="polite"></div>';
  shadow.appendChild(menu);
  const autoFillButton = menu.querySelector('.rf-live-autofill-button');
  const autoFillProgress = menu.querySelector('.rf-live-autofill-progress');

  let enabled = window.__rfLiveEnabled !== false && {initial};
  let sequence = Number(window.__rfLiveControl && window.__rfLiveControl.seq) || 0;
  let dragTimer = 0;
  let dragging = false;
  let moved = false;
  let startX = 0;
  let startY = 0;
  let originLeft = 0;
  let originTop = 0;
  let expanded = false;
  let autoSequence = Number(window.__rfAutoFillRequest && window.__rfAutoFillRequest.seq) || 0;
  let autoStatus = window.__rfAutoFillStatus || {{state: 'idle', total: 0, completed: 0, filled: 0, failed: 0}};
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
    expand.style.left = clamp(rect.right - 12, 8, Math.max(8, innerWidth - 24)) + 'px';
    expand.style.top = clamp(rect.top - 8, 8, Math.max(8, innerHeight - 24)) + 'px';
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
      const completed = Number(autoStatus && autoStatus.completed) || 0;
      const filled = Number(autoStatus && autoStatus.filled) || 0;
      const current = String(autoStatus && autoStatus.current_label || '');
      if (running) autoFillProgress.textContent = current ? `正在填写：${{current}}（${{completed}}/${{total}}）` : '正在识别当前页面…';
      else if (state === 'done') autoFillProgress.textContent = String(autoStatus.message || `已完成 ${{filled}}/${{total}} 项，请回到页面核对`);
      else if (state === 'cancelled' || state === 'error') autoFillProgress.textContent = String(autoStatus.message || '自动填写已停止');
      else autoFillProgress.textContent = '识别到的字段会逐项写入，已有内容不会覆盖。';
    }}
    menu.classList.toggle('on', expanded);
    expand.textContent = expanded ? '−' : '+';
    expand.setAttribute('aria-expanded', expanded ? 'true' : 'false');
    positionDock();
  }};

  const render = () => {{
    ball.classList.toggle('off', !enabled);
    ball.textContent = enabled ? '填' : '关';
    ball.title = enabled ? '智能逐项填表：已开启。长按可拖动' : '智能逐项填表：已关闭。点击开启，长按可拖动';
    ball.setAttribute('aria-label', enabled ? '智能逐项填表：已开启，长按拖动' : '智能逐项填表：已关闭，点击开启');
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
          autoStatus = {{state: 'idle', total: current.total || 0, completed: current.completed || 0, filled: current.filled || 0, failed: current.failed || 0}};
          renderAutoFill();
        }}
      }}, 2200);
    }}
  }};
  const stopDrag = () => {{
    window.clearTimeout(dragTimer);
    window.removeEventListener('pointermove', move, true);
    window.removeEventListener('pointerup', stopDrag, true);
    window.removeEventListener('pointercancel', stopDrag, true);
    if (dragging) {{
      dragging = false;
      ball.classList.remove('dragging');
      savePosition();
      positionDock();
    }} else if (!moved) {{
      enabled = !enabled;
      publish(true);
    }}
  }};
  const move = (event) => {{
    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    if (!dragging && Math.hypot(dx, dy) > 8) {{
      moved = true;
      window.clearTimeout(dragTimer);
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
    dragTimer = window.setTimeout(() => {{
      if (!moved) {{ dragging = true; ball.classList.add('dragging'); }}
    }}, 280);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', stopDrag, true);
    window.addEventListener('pointercancel', stopDrag, true);
    event.preventDefault();
  }});
  expand.addEventListener('click', (event) => {{
    event.preventDefault();
    event.stopPropagation();
    expanded = !expanded;
    renderAutoFill();
  }});
  if (autoFillButton) autoFillButton.addEventListener('click', (event) => {{
    event.preventDefault();
    event.stopPropagation();
    if (!enabled || (autoStatus && (autoStatus.state === 'requested' || autoStatus.state === 'filling'))) return;
    autoSequence += 1;
    window.__rfAutoFillRequest = {{seq: autoSequence}};
    autoStatus = {{state: 'requested', seq: autoSequence, total: 0, completed: 0, filled: 0, failed: 0}};
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


__all__ = [
    "LIVE_CONTROL_STATE_SCRIPT",
    "install_live_control_script",
    "set_autofill_status_script",
    "set_live_enabled_script",
]
