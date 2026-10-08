"""目标浏览器里的逐框记忆编辑器；不直接请求本地 API。"""
from __future__ import annotations

import json
from typing import Any


def memory_targets_script(targets: list[dict[str, Any]]) -> str:
    """后端经 CDP 主动提供可保存的目标，避免招聘网站直接调用本地接口。"""
    return (
        "(() => { /* rf:live-memory-targets */"
        f" window.__rfMemoryTargets = {json.dumps(targets, ensure_ascii=False)};"
        " return '1'; })()"
    )


REMEMBER_EDITOR_SCRIPT = r"""(() => { /* rf:live-memory-editor */
  const host = document.getElementById('__rf_live_host__');
  const root = host && host.shadowRoot;
  const panel = root && root.querySelector('.p');
  const oldButton = root && root.querySelector('.remember');
  if (!root || !panel || !oldButton) { return '0'; }
  if (window.__rfMemoryEditorInstalled) { return '1'; }
  window.__rfMemoryEditorInstalled = true;
  const oldShow = window.__rfShowPanel;
  const oldUninstall = window.__rfUninstall;
  let editing = false;
  let focusSeq = 0;
  let payload = {};
  let selectedId = 'custom';
  let originalLabel = '';
  let pickerWasOpen = false;
  let pickerInlineDisplay = '';
  let moreInlineDisplay = '';
  let collapsedGroups = new Set();

  const style = document.createElement('style');
  style.textContent = [
    '.rf-memory{display:none;border-top:1px solid #e8e8e8;padding:16px;background:linear-gradient(180deg,#f7fbff 0%,#fff 42%);max-height:min(680px,76vh);overflow:hidden}',
    '.rf-memory-title{font-weight:700;color:#1557a6;margin-bottom:3px;font-size:14px}',
    '.rf-memory-subtitle{color:#718096;font-size:11px;line-height:1.6;margin-bottom:10px}',
    '.rf-memory-label{display:block;color:#44546a;font-size:12px;font-weight:600;margin:8px 0}',
    '.rf-memory input[type=text]{display:block;width:100%;min-height:32px;border:1px solid #d9e2ef;border-radius:8px;padding:7px 9px;font-size:12px;outline:none;background:#fff}',
    '.rf-memory input[type=text]:focus{border-color:#1677ff;box-shadow:0 0 0 2px rgba(22,119,255,.12)}',
    '.rf-memory-targets{max-height:min(430px,50vh);overflow:auto;border:1px solid #dfe8f3;border-radius:10px;background:#fff;box-shadow:0 2px 8px rgba(31,56,88,.04)}',
    // 选择器必须带 `button` 前缀：焦点面板的基础规则 `button:not(.rf-live-switch)`（深蓝底
    // 白字）特异性是 (0,1,1)，裸 `.rf-memory-group`(0,1,0) 会输给它——分组头全被染成
    // 深蓝、糊成选中态（用户反馈）。本样式表挂在面板样式之后，同特异性即可胜出，
    // 与 scripts.py 里 navchip / button.close 的既有修法同一套。
    '  button.rf-memory-group{position:relative;display:flex;align-items:center;gap:6px;width:100%;border:0;border-bottom:1px solid #e4edf8;padding:8px 10px;color:#1557a6;font-size:11px;font-weight:700;background:#f2f7ff;cursor:pointer;text-align:left}',
    '  button.rf-memory-group:hover{background:#e8f2ff}',
    '.rf-memory-group .caret{width:12px;flex:none;color:#6a91c5;transition:transform .12s}',
    '.rf-memory-group.collapsed .caret{transform:rotate(-90deg)}',
    '.rf-memory-group .group-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rf-memory-group .group-count{margin-left:auto;flex:none;color:#7d94b4;font-weight:500}',
    '.rf-memory-row{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;cursor:pointer;border-bottom:1px solid #f0f4f8;min-width:0}',
    '.rf-memory-row:hover,.rf-memory-row.selected{background:#f5f8ff}',
    '.rf-memory-radio{width:14px;flex:none;color:#1677ff}',
    '.rf-memory-content{min-width:0;flex:1}',
    '.rf-memory-name{font-weight:600;color:#222;min-width:0;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rf-memory-value{color:#78879a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;margin-top:2px}',
    '.rf-memory-hint{color:#888;font-size:11px;min-height:18px;margin-top:6px}',
    '.rf-memory-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}',
    '.rf-memory-empty{padding:12px;color:#999}',
  ].join('');
  root.appendChild(style);
  const editor = document.createElement('div');
  editor.className = 'rf-memory';
  editor.innerHTML = [
    '<div class="rf-memory-title">记住这条：确认字段名与保存位置</div>',
    '<div class="rf-memory-subtitle">默认先保存到网申资料·自定义；如果已有对应字段，也可以在下面展开后选择。</div>',
    '<label class="rf-memory-label">字段名<input class="rf-memory-label-input" type="text" maxlength="40"></label>',
    '<label class="rf-memory-label">字段内容<input class="rf-memory-value-input" type="text" maxlength="2000"></label>',
    '<label class="rf-memory-label">保存到哪里（支持模糊搜索）<input class="rf-memory-search" type="text" placeholder="搜索资料模块、字段名或当前值"></label>',
    '<div class="rf-memory-targets"></div>',
    '<div class="rf-memory-hint"></div>',
    '<div class="rf-memory-actions"><button class="ghost rf-memory-cancel" type="button">取消</button><button class="rf-memory-save" type="button">保存这条</button></div>',
  ].join('');
  panel.insertBefore(editor, root.querySelector('.pick'));
  // 原按钮绑定着直接落库的旧监听；替换节点而不是叠加事件监听，避免一次点击写入两次。
  const button = oldButton.cloneNode(true);
  oldButton.replaceWith(button);
  const name = editor.querySelector('.rf-memory-label-input');
  const valueInput = editor.querySelector('.rf-memory-value-input');
  const search = editor.querySelector('.rf-memory-search');
  const list = editor.querySelector('.rf-memory-targets');
  const hint = editor.querySelector('.rf-memory-hint');
  const picker = root.querySelector('.pick');
  const moreButton = root.querySelector('.more');
  const targets = () => Array.isArray(window.__rfMemoryTargets) ? window.__rfMemoryTargets : [];
  const control = () => window.__rfFocus || {};
  const cleanLabel = (raw) => String(raw || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[＊*]+/g, '')
    .replace(/[\s:：\-—–·]+$/g, '')
    .replace(/^[\s:：\-—–·]+/g, '')
    .trim();
  const cleanPlaceholder = (raw) => {
    let text = cleanLabel(raw);
    if (!text) { return ''; }
    text = text.replace(/^(?:如有|若有|如果有|如需|若需)\s*/u, '');
    text = text.replace(/^(?:请输入|请填写|请录入|请提供|请选择|请先选择|请搜索|请在此|请于此)\s*/u, '');
    text = text.replace(/(?:可在此|请在此|可填写|可输入|填写|输入|选择|录入)[\s\S]*$/u, '');
    text = text.replace(/[（(](?:必填|选填|可选)[)）]$/u, '');
    return cleanLabel(text);
  };
  const nearbyLabel = (field) => {
    const nearby = cleanLabel(field.nearby_text);
    const placeholder = cleanLabel(field.placeholder);
    if (!nearby) { return ''; }
    const chunks = nearby.split(/[\s|/\\·•:：,，;；]+/u)
      .map(cleanLabel)
      .filter((item) => item && item !== placeholder && item.length <= 32)
      .filter((item) => !/^(?:请输入|请填写|请录入|请选择|如有|若有|如果有)/u.test(item));
    return chunks.sort((left, right) => left.length - right.length)[0] || '';
  };
  const formLabel = () => {
    const field = control();
    const direct = [field.label, field.aria_label, field.aria_labelledby, field.legend, field.title]
      .map(cleanLabel)
      .filter(Boolean)[0];
    return direct || nearbyLabel(field) || cleanPlaceholder(field.placeholder) || cleanLabel(field.name);
  };
  // 字段内容的初始值与旧版保存时的取值链完全一致：用户在表单里敲的字 >
  // 面板建议值 > 控件现值。放进输入框而不是只在保存时现取，用户才能改。
  const formValue = () => {
    const field = control();
    const element = document.querySelector('[data-rf-focus="1"]');
    const typed = element && (element.getAttribute('contenteditable') === 'true' ? element.textContent : element.value);
    return String(typed || payload.value || field.value || '');
  };
  const normalize = (text) => String(text || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const fuzzy = (text, term) => {
    const source = String(text || '').toLocaleLowerCase();
    const needle = String(term || '').trim().toLocaleLowerCase();
    if (!needle || source.includes(needle)) { return true; }
    let cursor = 0;
    for (const char of source) {
      if (char === needle[cursor] && ++cursor === needle.length) { return true; }
    }
    return false;
  };
  const selected = () => targets().find((item) => item.target_id === selectedId);
  // 目标**只来自「网申资料」**（见 services/webform/profile_targets.py）。这里没有
  // "我的资料"那一支：简历资料会被生成进简历正文，按一下「记住这条」不该改到它。
  const defaultTarget = (label) => {
    const key = String(payload.remember_field_key || '');
    const items = targets();
    if (key) {
      const exact = items.find((item) => item.field_key === key);
      if (exact) { return exact.target_id; }
    }
    const same = items.filter((item) => normalize(item.label) === normalize(label));
    if (same.length === 1) { return same[0].target_id; }
    return 'custom';
  };
  const updateHint = () => {
    const target = selected();
    hint.textContent = target
      ? '将更新「网申资料 · ' + target.group + ' · ' + target.label + '」。已有字段名称不变。'
      : '将按上方字段名新增或更新「网申资料 · 自定义」。';
  };
  const render = () => {
    const custom = {target_id: 'custom', source: 'extra', group: '自定义', label: name.value || '新增自定义字段', value: ''};
    const matches = [custom, ...targets()].filter((item) => fuzzy(
      [item.group, item.label, item.value, item.field_key, '网申资料'].join(' '), search.value,
    ));
    list.textContent = '';
    const groups = new Map();
    for (const item of matches) {
      const group = String(item.group || '其他');
      if (!groups.has(group)) { groups.set(group, []); }
      groups.get(group).push(item);
    }
    if (!groups.size) {
      const empty = document.createElement('div');
      empty.className = 'rf-memory-empty';
      empty.textContent = '没有匹配的保存位置';
      list.appendChild(empty);
      return;
    }
    const searching = Boolean(String(search.value || '').trim());
    for (const [group, items] of groups) {
      const expanded = searching || !collapsedGroups.has(group);
      const title = document.createElement('button');
      title.type = 'button';
      title.className = 'rf-memory-group' + (expanded ? '' : ' collapsed');
      title.setAttribute('aria-expanded', String(expanded));
      title.title = expanded ? '点击折叠这一组' : '点击展开这一组';
      const caret = document.createElement('span');
      caret.className = 'caret';
      caret.textContent = '▾';
      const groupName = document.createElement('span');
      groupName.className = 'group-name';
      groupName.textContent = '网申资料 · ' + group;
      const groupCount = document.createElement('span');
      groupCount.className = 'group-count';
      groupCount.textContent = `${items.length} 条`;
      title.append(caret, groupName, groupCount);
      title.addEventListener('click', () => {
        if (collapsedGroups.has(group)) { collapsedGroups.delete(group); }
        else { collapsedGroups.add(group); }
        render();
      });
      list.appendChild(title);
      if (!expanded) { continue; }
      for (const item of items) {
        const row = document.createElement('div');
        row.className = 'rf-memory-row' + (item.target_id === selectedId ? ' selected' : '');
        row.title = `${item.label || ''}：${item.target_id === 'custom' ? '使用上方字段名' : (item.value || '（尚未填写）')}`;
        const icon = document.createElement('span');
        icon.className = 'rf-memory-radio';
        icon.textContent = item.target_id === selectedId ? '●' : '○';
        const content = document.createElement('div');
        content.className = 'rf-memory-content';
        const label = document.createElement('div');
        label.className = 'rf-memory-name';
        label.textContent = item.label;
        const value = document.createElement('div');
        value.className = 'rf-memory-value';
        value.textContent = item.target_id === 'custom' ? '使用上方字段名' : '当前值：' + (item.value || '（尚未填写）');
        content.append(label, value);
        row.append(icon, content);
        row.addEventListener('click', () => {
          selectedId = item.target_id;
          collapsedGroups.delete(group);
          if (selectedId !== 'custom') { name.value = item.label; }
          render();
          updateHint();
        });
        list.appendChild(row);
      }
    }
  };
  const close = () => {
    editing = false;
    editor.style.display = 'none';
    panel.style.width = '';
    button.style.display = '';
    if (moreButton) { moreButton.style.display = moreInlineDisplay; }
    if (picker) {
      picker.style.display = pickerInlineDisplay;
      picker.classList.toggle('on', pickerWasOpen);
    }
  };
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    payload = window.__rfCurrentPanel || {};
    editing = true;
    focusSeq = window.__rfFocusSeq || 0;
    originalLabel = formLabel() || String(payload.field_label || '').trim();
    selectedId = defaultTarget(originalLabel);
    name.value = selected() ? selected().label : originalLabel;
    valueInput.value = formValue();
    search.value = '';
    collapsedGroups = new Set(targets().map((item) => String(item.group || '其他')));
    collapsedGroups.delete('自定义');
    pickerWasOpen = Boolean(picker && picker.classList.contains('on'));
    pickerInlineDisplay = picker ? picker.style.display : '';
    moreInlineDisplay = moreButton ? moreButton.style.display : '';
    if (picker) { picker.classList.remove('on'); picker.style.display = 'none'; }
    if (moreButton) { moreButton.style.display = 'none'; }
    editor.style.display = 'block';
    panel.style.width = 'min(680px,calc(100vw - 16px))';
    button.style.display = 'none';
    render();
    updateHint();
    window.setTimeout(() => name.focus(), 0);
  });
  name.addEventListener('input', () => {
    // 改名意味着新自定义字段；用户随后仍可手动选回原有字段。
    if (selected() && normalize(name.value) !== normalize(selected().label)) { selectedId = 'custom'; }
    collapsedGroups.delete('自定义');
    render();
    updateHint();
  });
  search.addEventListener('input', render);
  editor.querySelector('.rf-memory-cancel').addEventListener('click', close);
  editor.querySelector('.rf-memory-save').addEventListener('click', () => {
    const label = String(name.value || '').trim();
    const field = control();
    // 字段内容以**编辑器里的值**为准（打开时已按 typed > payload.value > field.value
    // 初始化，用户可改）。不再保存时回头读表单——那会悄悄覆盖用户改过的内容。
    const value = String(valueInput.value || '').trim();
    if (!label) { hint.textContent = '请先填写字段名。'; name.focus(); return; }
    if (!value) { hint.textContent = '请先填写字段内容。'; valueInput.focus(); return; }
    window.__rfRemember = {target_id: selectedId, label, value, control: field, selector: field.selector || ''};
    close();
  });
  window.__rfShowPanel = (next) => {
    if (editing && (window.__rfFocusSeq || 0) !== focusSeq) { close(); }
    window.__rfCurrentPanel = next || {};
    const result = oldShow(next);
    const fieldType = String(control().type || '');
    const status = String((next || {}).status || '');
    const available = !['select', 'checkbox', 'radio', 'file'].includes(fieldType)
      && !['blocked', 'thinking', 'ai_thinking', 'hidden'].includes(status);
    if (!available) { close(); }
    button.style.display = available && !editing ? '' : 'none';
    button.disabled = !available;
    return result;
  };
  window.__rfUninstall = () => {
    close();
    const result = oldUninstall();
    window.__rfMemoryEditorInstalled = false;
    window.__rfMemoryTargets = null;
    window.__rfCurrentPanel = null;
    return result;
  };
  return '1';
})()"""


__all__ = ["REMEMBER_EDITOR_SCRIPT", "memory_targets_script"]
