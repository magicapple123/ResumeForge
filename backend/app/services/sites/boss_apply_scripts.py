"""boss_apply 的页面脚本构造器（纯 JS 模板片段，无业务流程）。

从 ``boss_apply.py`` 拆出：投递/沟通链路里所有 ``evaluate`` 用的脚本构造函数
与 ``_CHAT_INPUT_FINDER_JS`` 公共查找片段，便于独立审阅脚本本身；
业务流程编排与发送结果判定仍留在 ``boss_apply.py``。
"""

from __future__ import annotations

import json

from .boss_page import _SELECTORS, _blocker_js


def _entry_script(marker: str, *, click: bool) -> str:
    action = "node.click();" if click else ""
    return f"""(() => {{ /* {marker} */
  const ENTRY = {json.dumps(_SELECTORS["apply_entry"])};
{_blocker_js()}
  const labels = ['立即沟通', '继续沟通', '开始沟通', '投递简历', '立即申请'];
  const candidates = [...new Set([
    ...document.querySelectorAll(ENTRY),
    ...document.querySelectorAll("button, a, [role='button']")
  ])];
  const visible = (node) => !!(node && node.getClientRects().length);
  const label = (node) => ((node.innerText || node.textContent ||
    node.getAttribute('aria-label') || node.getAttribute('title') || '')).trim();
  const node = candidates.find((item) => visible(item) &&
    !item.disabled && labels.some((word) => label(item).includes(word)));
  if (node) {{ {action} }}
  return JSON.stringify({{
    ok: !!node, found: !!node, matched: node ? 1 : 0,
    label: node ? label(node) : '', url: location.href,
    title: document.title || '',
    captcha: shown(CAPTCHA),
    login_required: shown(LOGIN)
  }});
}})()"""


def _apply_entry_script() -> str:
    return _entry_script("rf:apply-entry", click=False)


def _click_apply_script() -> str:
    """旧的合成点击探针，仅保留用于离线对照；生产流程已改用可信鼠标事件。"""
    return _entry_script("rf:click-apply", click=True)


def _entry_rect_script() -> str:
    """定位沟通入口并返回其视口中心坐标（供可信鼠标点击）。"""
    return f"""(() => {{ /* rf:entry-rect */
  const ENTRY = {json.dumps(_SELECTORS["apply_entry"])};
{_blocker_js()}
  const labels = ['立即沟通', '继续沟通', '开始沟通', '投递简历', '立即申请'];
  const candidates = [...new Set([
    ...document.querySelectorAll(ENTRY),
    ...document.querySelectorAll("button, a, [role='button']")
  ])];
  const visible = (node) => {{
    if (!node || node.disabled) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 5 && rect.height > 5 &&
      style.display !== 'none' && style.visibility !== 'hidden';
  }};
  const label = (node) => ((node.innerText || node.textContent ||
    node.getAttribute('aria-label') || node.getAttribute('title') || '')).trim();
  const node = candidates.find((item) => visible(item) &&
    labels.some((word) => label(item).includes(word)));
  let rect = null;
  if (node) {{ node.scrollIntoView({{ block: 'center' }}); rect = node.getBoundingClientRect(); }}
  return JSON.stringify({{
    ok: !!node, found: !!node, matched: node ? 1 : 0,
    label: node ? label(node) : '',
    x: rect ? rect.x + rect.width / 2 : 0,
    y: rect ? rect.y + rect.height / 2 : 0,
    width: rect ? rect.width : 0, height: rect ? rect.height : 0,
    url: location.href, title: document.title || '',
    captcha: shown(CAPTCHA), login_required: shown(LOGIN)
  }});
}})()"""


# 定位聊天输入框的公共 JS 片段（**填写与状态检查必须用同一份**，否则"检查说找到了、
# 填写却找不到"，两边各改一次就会漂移）。要求调用方先定义好 ``INPUT``。
#
# 三步走，**每一步都比上一步更宽松，但都守在"聊天/对话框容器内"**：
# 1. 现有的类选择器（覆盖现版与几个历史形态）；
# 2. 找**可见且未禁用**的那个（而不是第一个命中的）；
# 3. 站点把输入框的类名换掉时的兜底：在聊天 / 对话框容器里找 textarea / contenteditable。
#
# **容器兜底只认 textarea 与 contenteditable，绝不接受 `<input>`**——这一条是 2026-09-21 在
# 真实聊天页上实测撞出来的：聊天页在没有打开会话时**根本没有输入框**，而 `.chat-container`
# 里有一个「搜索30天内的联系人」的 `<input class="boss-search-input">`，它可见、未禁用、
# 尺寸也正常，于是"容器内找输入框"会**稳稳地命中搜索框**——差一步就把招呼语打进站点的搜索框。
# 消息框（textarea / contenteditable）与搜索框（input）在形态上本来就是两类，用这个区分比
# 用容器范围可靠得多。**选择器那条路仍然接受 input**（它可能是 `#chat-input` 这类明确命中的），
# 只是额外挡掉"看起来是搜索框"的——收紧兜底不能顺手把既有能力也砍掉。
#
# 这条纪律的方向始终是**"宁可不做，也不能做错"**：找不到会如实报"页面结构可能已变化"并停下，
# 而认错一次就是一条发错地方的消息。
_CHAT_INPUT_FINDER_JS = """
  const CHAT_SCOPES = ['.chat-container', '.chat-content', '.chat-box', '.dialog-wrap',
    '.dialog-container', '[class*=chat-]', '[class*=dialog]'];
  const SEARCH_WORDS = ['搜索', '查找', 'search'];
  const rectVisible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 5 && rect.height > 5;
  };
  const looksLikeSearch = (node) => {
    const hint = (node.getAttribute('placeholder') || '') + ' ' +
      (node.getAttribute('aria-label') || '') + ' ' +
      ((node.getAttribute('class') || '') + ' ' + (node.getAttribute('type') || '')).toLowerCase();
    return SEARCH_WORDS.some((word) => hint.includes(word));
  };
  const basic = (node) => !!node && !node.disabled && !node.readOnly &&
    !looksLikeSearch(node) && rectVisible(node);
  // 选择器路径：**信我们自己的选择器**（它覆盖现版与几个历史形态，输入框可能是 input），
  // 只额外挡掉"看起来是搜索框"的，免得哪天选择器写宽了误伤。
  const usableBySelector = (node) => {
    if (!basic(node)) return false;
    if (node.isContentEditable) return true;
    const tag = (node.tagName || '').toLowerCase();
    if (tag === 'textarea') return true;
    if (tag === 'input') {
      const kind = (node.getAttribute('type') || 'text').toLowerCase();
      return kind === 'text' || kind === 'search';
    }
    return false;
  };
  // 容器兜底：**只认 textarea 与 contenteditable**。消息框不是这两者就是 input，
  // 而 input 在聊天页上十有八九是"搜索联系人"——实测就是这么撞上的。
  const usableByContainer = (node) => {
    if (!basic(node)) return false;
    const tag = (node.tagName || '').toLowerCase();
    return node.isContentEditable || tag === 'textarea';
  };
  const findChatInput = () => {
    const direct = [...document.querySelectorAll(INPUT)].find(usableBySelector);
    if (direct) return { node: direct, matched_by: 'selector' };
    for (const scope of CHAT_SCOPES) {
      for (const box of document.querySelectorAll(scope)) {
        const hit = [...box.querySelectorAll("textarea, [contenteditable='true']")]
          .find(usableByContainer);
        if (hit) return { node: hit, matched_by: 'container' };
      }
    }
    return { node: null, matched_by: '' };
  };
"""


def _greeting_state_script() -> str:
    return f"""(() => {{ /* rf:greeting-state */
  const INPUT = {json.dumps(_SELECTORS["greeting_input"])};
{_CHAT_INPUT_FINDER_JS}
{_blocker_js()}
  const hit = findChatInput();
  const node = hit.node;
  return JSON.stringify({{
    url: location.href, title: document.title || '',
    found: !!node, matched: node ? 1 : 0,
    matched_by: hit.matched_by,
    required: !!(node && (node.required || node.getAttribute('required') !== null)),
    kind: node ? (node.isContentEditable ? 'contenteditable' : node.tagName.toLowerCase()) : '',
    captcha: shown(CAPTCHA),
    login_required: shown(LOGIN)
  }});
}})()"""


def _chat_state_script() -> str:
    """点击沟通入口后的页面状态：是否已到聊天页、输入框是否可用、当前会话是谁。

    ready 判据只看"可见的聊天输入框"——现版是整页跳转到 ``/web/geek/chat``，
    但保留对"页内聊天弹层"形态的兼容；``on_chat`` / ``position`` / ``name`` 仅作诊断。
    """
    return f"""(() => {{ /* rf:chat-state */
  const INPUT = {json.dumps(_SELECTORS["greeting_input"])};
{_blocker_js()}
  const url = location.href;
  const onChat = /\\/web\\/geek\\/chat/.test(url);
  const visible = (node) => {{
    if (!node || node.disabled) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 5 && rect.height > 5 &&
      style.display !== 'none' && style.visibility !== 'hidden';
  }};
  const node = [...document.querySelectorAll(INPUT)].find(visible);
  const text = (sel) => {{
    const hit = document.querySelector(sel);
    return hit ? (hit.innerText || '').trim() : '';
  }};
  // 可见的模态弹窗（隐藏的模板不计）：新会话可能出现"发送简历/完善简历"之类的拦截。
  const dialog = [...document.querySelectorAll(
      '.dialog-wrap, [role=dialog], .dialog-container, .modal-mask, [class*=modal]'
    )].filter(visible).map((n) => (n.innerText || '').trim()).filter(Boolean)[0] || '';
  return JSON.stringify({{
    url, title: document.title || '',
    on_chat: onChat,
    found: !!node, input_found: !!node, matched: node ? 1 : 0,
    kind: node ? (node.isContentEditable ? 'contenteditable' : node.tagName.toLowerCase()) : '',
    position: text('.position-name, .chat-position-content .position-name').slice(0, 60),
    name: text('.name-text, .chat-person .name, .geek-chat-name').slice(0, 30),
    dialog: dialog.slice(0, 120),
    captcha: shown(CAPTCHA),
    login_required: shown(LOGIN)
  }});
}})()"""


def _fill_greeting_script(greeting: str) -> str:
    return f"""(() => {{ /* rf:fill-greeting */
  const INPUT = {json.dumps(_SELECTORS["greeting_input"])};
  const TEXT = {json.dumps(greeting)};
{_CHAT_INPUT_FINDER_JS}
  const hit = findChatInput();
  const node = hit.node;
  if (!node) return JSON.stringify({{ ok: false, matched: 0, matched_by: '',
    url: location.href, title: document.title }});
  node.focus();
  if (node.isContentEditable) {{
    node.textContent = TEXT;
  }} else {{
    const owner = node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype :
      HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(owner, 'value');
    if (setter && setter.set) setter.set.call(node, TEXT); else node.value = TEXT;
  }}
  try {{
    node.dispatchEvent(new InputEvent('input', {{
      bubbles: true, inputType: 'insertText', data: TEXT
    }}));
  }} catch (error) {{
    node.dispatchEvent(new Event('input', {{ bubbles: true }}));
  }}
  node.dispatchEvent(new Event('change', {{ bubbles: true }}));
  const value = node.isContentEditable ? node.textContent : node.value;
  return JSON.stringify({{ ok: value === TEXT, matched: 1, value,
    matched_by: hit.matched_by,
    url: location.href, title: document.title }});
}})()"""


def _send_rect_script() -> str:
    """定位聊天页发送按钮并返回坐标；空内容时按钮带 ``disabled`` class，一并上报。"""
    return f"""(() => {{ /* rf:send-rect */
  const SEND = {json.dumps(_SELECTORS["greeting_send"])};
{_blocker_js()}
  const visible = (node) => {{
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    const style = getComputedStyle(node);
    return rect.width > 5 && rect.height > 5 &&
      style.display !== 'none' && style.visibility !== 'hidden';
  }};
  const label = (node) => ((node.innerText || node.textContent ||
    node.getAttribute('aria-label') || node.getAttribute('title') || '')).trim();
  const candidates = [...new Set([
    ...document.querySelectorAll(SEND),
    ...document.querySelectorAll("button, [role='button']")
  ])];
  const sendWords = ['发送', '发出', '发送消息'];
  const isSend = (node) => !node.disabled &&
    !node.classList.contains('disabled') &&
    sendWords.some((word) => label(node).includes(word));
  const node = candidates.find((item) => visible(item) && isSend(item));
  const anySend = candidates.find((item) => visible(item) &&
    sendWords.some((word) => label(item).includes(word)));
  let rect = null;
  if (node) {{ node.scrollIntoView({{ block: 'center' }}); rect = node.getBoundingClientRect(); }}
  return JSON.stringify({{
    ok: !!node, found: !!node,
    matched: candidates.filter((n) => visible(n) &&
      sendWords.some((w) => label(n).includes(w))).length,
    disabled: !!anySend && !node,
    label: node ? label(node) : (anySend ? label(anySend) : ''),
    x: rect ? rect.x + rect.width / 2 : 0,
    y: rect ? rect.y + rect.height / 2 : 0,
    width: rect ? rect.width : 0, height: rect ? rect.height : 0,
    url: location.href, title: document.title || '',
    captcha: shown(CAPTCHA), login_required: shown(LOGIN)
  }});
}})()"""


def _click_send_script() -> str:
    """旧的合成点击探针，仅保留用于离线对照；生产流程已改用可信鼠标事件。"""
    return f"""(() => {{ /* rf:click-send */
  const SEND = {json.dumps(_SELECTORS["greeting_send"])};
  const scope = document.querySelector(
    '.dialog-container, .chat-container, .conversation-container, [class*=chat]'
  ) || document;
  const candidates = [...new Set([
    ...scope.querySelectorAll(SEND),
    ...scope.querySelectorAll("button, [role='button']")
  ])];
  const label = (node) => ((node.innerText || node.textContent ||
    node.getAttribute('aria-label') || node.getAttribute('title') || '')).trim();
  const node = candidates.find((item) => item.getClientRects().length &&
    !item.disabled && ['发送', '发出', '发送消息'].some((word) => label(item).includes(word)));
  if (node) node.click();
  return JSON.stringify({{
    ok: !!node, matched: node ? 1 : 0, label: node ? label(node) : '',
    url: location.href, title: document.title || ''
  }});
}})()"""


def _click_script(selector: str, marker: str) -> str:
    return f"""(() => {{ /* {marker} */
  const node = document.querySelector({json.dumps(selector)});
  if (!node) return JSON.stringify({{ ok: false, matched: 0 }});
  node.click();
  return JSON.stringify({{ ok: true, matched: 1 }});
}})()"""


def _submit_state_script(greeting: str = "") -> str:
    return f"""(() => {{ /* rf:submit-state */
{_blocker_js()}
  const TEXT = {json.dumps(greeting.strip())};
  const MINE = {json.dumps(_SELECTORS["my_message"])};
  const body = (document.body && document.body.innerText) || '';
  const successWords = ['发送成功', '沟通成功', '消息已发送'];
  const outgoing = [...document.querySelectorAll(MINE)];
  const sentMessage = !!TEXT && outgoing.some((node) =>
    (node.innerText || node.textContent || '').trim().includes(TEXT));
  const toastSuccess = successWords.some((word) => body.includes(word));
  // startchat 打招呼对话框（2026-09-20 实测的新会话形态：点击沟通后不跳聊天页，
  // 而是详情页弹出对话框）。三种"已发出"的形态都算成功：
  //   a) 对话框关闭（发送成功的常规收尾）；
  //   b) 对话框切到「已发送」预览态且草稿已不在输入框里；
  //   c) 预览文本里出现我们刚发的那句话。
  // 反例必须排除：对话框开着、输入框里还躺着我们没发出去的草稿（点击没生效）——不算。
  const dialogState = (() => {{
    const dialog = document.querySelector('.startchat-dialog, .dialog-container');
    if (!dialog) return {{ present: false, visible: false, text: '', draft: '' }};
    const visible = !!dialog.getClientRects().length;
    const text = visible ? (dialog.innerText || '') : '';
    const ta = dialog.querySelector('textarea');
    const draft = ta ? (ta.value || '').trim() : '';
    return {{ present: true, visible, text, draft }};
  }})();
  const dialogSent =
    (dialogState.present && !dialogState.visible) ||
    (dialogState.visible && dialogState.text.includes('已发送') && dialogState.draft !== TEXT) ||
    (dialogState.visible && !!TEXT && dialogState.text.includes(TEXT));
  return JSON.stringify({{
    url: location.href, title: document.title || '',
    captcha: shown(CAPTCHA),
    login_required: shown(LOGIN),
    sent_message: sentMessage || dialogSent,
    success: sentMessage || toastSuccess || dialogSent,
    matched: outgoing.length
  }});
}})()"""

