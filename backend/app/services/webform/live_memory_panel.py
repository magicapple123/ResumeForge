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

  const style = document.createElement('style');
  style.textContent = [
    '.rf-memory{display:none;border-top:1px solid #e8e8e8;padding:12px;background:#fbfdff}',
    '.rf-memory-title{font-weight:600;color:#1677ff;margin-bottom:8px}',
    '.rf-memory-label{display:block;color:#555;font-size:12px;margin:6px 0}',
    '.rf-memory input[type=text]{display:block;width:100%;border:1px solid #d9d9d9;border-radius:6px;padding:6px 8px;font-size:12px;outline:none}',
    '.rf-memory input[type=text]:focus{border-color:#1677ff}',
    '.rf-memory-targets{max-height:min(280px,42vh);overflow:auto;border:1px solid #edf0f5;border-radius:6px;background:#fff}',
    '.rf-memory-group{position:sticky;top:0;padding:6px 9px;color:#1677ff;font-size:11px;font-weight:600;background:#f5f8ff;z-index:1}',
    '.rf-memory-row{display:flex;gap:8px;padding:7px 9px;cursor:pointer;border-bottom:1px solid #f2f2f2}',
    '.rf-memory-row:hover,.rf-memory-row.selected{background:#f5f8ff}',
    '.rf-memory-radio{width:14px;flex:none;color:#1677ff}',
    '.rf-memory-content{min-width:0;flex:1}',
    '.rf-memory-name{font-weight:600;color:#222}',
    '.rf-memory-value{color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.rf-memory-hint{color:#888;font-size:11px;min-height:18px;margin-top:6px}',
    '.rf-memory-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}',
    '.rf-memory-empty{padding:12px;color:#999}',
  ].join('');
  root.appendChild(style);
  const editor = document.createElement('div');
  editor.className = 'rf-memory';
  editor.innerHTML = [
    '<div class="rf-memory-title">记住这条：确认字段名与保存位置</div>',
    '<label class="rf-memory-label">字段名<input class="rf-memory-label-input" type="text" maxlength="40"></label>',
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
  const search = editor.querySelector('.rf-memory-search');
  const list = editor.querySelector('.rf-memory-targets');
  const hint = editor.querySelector('.rf-memory-hint');
  const targets = () => Array.isArray(window.__rfMemoryTargets) ? window.__rfMemoryTargets : [];
  const control = () => window.__rfFocus || {};
  const formLabel = () => {
    const field = control();
    return String(field.label || field.placeholder || field.aria_label || field.nearby_text || field.name || '').trim();
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
    let lastGroup = '';
    for (const item of matches) {
      const group = '网申资料 · ' + (item.group || '其他');
      if (group !== lastGroup) {
        const title = document.createElement('div');
        title.className = 'rf-memory-group';
        title.textContent = group;
        list.appendChild(title);
        lastGroup = group;
      }
      const row = document.createElement('div');
      row.className = 'rf-memory-row' + (item.target_id === selectedId ? ' selected' : '');
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
        if (selectedId !== 'custom') { name.value = item.label; }
        render();
        updateHint();
      });
      list.appendChild(row);
    }
    if (!matches.length) {
      const empty = document.createElement('div');
      empty.className = 'rf-memory-empty';
      empty.textContent = '没有匹配的保存位置';
      list.appendChild(empty);
    }
  };
  const close = () => {
    editing = false;
    editor.style.display = 'none';
    panel.style.width = '';
    button.style.display = '';
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
    search.value = '';
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
    render();
    updateHint();
  });
  search.addEventListener('input', render);
  editor.querySelector('.rf-memory-cancel').addEventListener('click', close);
  editor.querySelector('.rf-memory-save').addEventListener('click', () => {
    const label = String(name.value || '').trim();
    const field = control();
    const element = document.querySelector('[data-rf-focus="1"]');
    const typed = element && (element.getAttribute('contenteditable') === 'true' ? element.textContent : element.value);
    const value = String(typed || payload.value || field.value || '').trim();
    if (!label) { hint.textContent = '请先填写字段名。'; name.focus(); return; }
    if (!value) { hint.textContent = '请先在目标表单里填写内容。'; return; }
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
