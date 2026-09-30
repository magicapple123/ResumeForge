"""通用表单理解与填写引擎（站点无关）。

它回答两个问题：

1. **页面上有哪些可见控件，各是什么类型、当前值是什么**（文本 / 下拉 / 单选 / 复选 /
   富文本 / 文件 / 日期）。
2. **资料里的字段该填到哪个控件里**——靠 ``label`` / ``placeholder`` / ``aria-label`` /
   ``name`` / 邻近文本做启发式映射，而不是把某站点的选择器堆死。

这条"启发式映射 + 站点适配器兜底"的取舍是设计的关键决策：站点选择器会变，字段语义相对
稳定，所以**理解表单**用通用逻辑，**定位站点特有元素**才交给适配器。

## 2026-09-26 从 ``services/apply/`` 迁来并修了五个缺陷

迁到 ``services/webform/`` 是因为它现在真正服务于「网申填表」；投递链路（BOSS）只往聊天框
发招呼语，从不填表单，留着它在 ``apply/`` 只会让依赖方向变成 webform → apply。

修掉的五处（前四处原先都有测试"覆盖"，但那些测试用不执行 JS 的假客户端，只断言脚本字符串
里出现了某个标记，所以全都测不出来）：

1. ``select`` 原先落进 ``else`` 分支，用 ``HTMLInputElement.prototype`` 的 value setter
   作用在 ``<select>`` 上——Chrome 会抛 ``Illegal invocation``。现在单列一个分支。
2. 快照原先**不采集控件当前值**，``options`` 只采文本不采 ``value``。而网申下拉普遍是
   ``<option value="3">本科</option>``——只拿文本无法回填。现在两者都采。
3. ``Control.options`` 采了却从未被消费（没有"值 → 哪个选项"的逻辑）。现在判断在
   ``matching.resolve_select_option`` 里，是纯函数、可穷举测。
4. 单选/复选原先用合成 ``el.click()``（``isTrusted=false``），站点会静默忽略。现在走
   ``browser.interaction.click_selector`` 的可信鼠标事件，且**只在需要改变状态时才点**
   （对已勾选的复选框再点一下会把它取消勾选）。
5. ``file`` 控件原先直接调 ``set_file_input``，但导出管线不落临时文件，没有本地路径可给，
   真实站点上会抛 ``CdpError`` 并**中断整轮填充**。现在 ``match_fields`` 不产生 ``file``
   映射，预览里固定提示"简历附件请自己上传"。
"""
from __future__ import annotations

import json
import logging
import time
from dataclasses import dataclass, field, replace
from typing import Any

from ..browser.cdp_client import CdpClient
from ..browser.interaction import click_selector
from .fields import (
    AUTOCOMPLETE_DENY,
    AUTOCOMPLETE_FIELDS,
    CLAIM_LABELS,
    CONSENT_HINTS,
    FIELD_BLOCK_HINTS,
    FIELD_DENYLIST,
    FIELD_EXCLUDE_HINTS,
    FIELD_PREFERRED_TYPES,
    FIELD_SYNONYMS,
)
from .matching import (
    DateResolution,
    SelectOption,
    SelectResolution,
    format_date,
    is_date_hint,
    is_placeholder,
    meaningful_options,
    resolve_choice,
    resolve_select_option,
)
from .repeated_fields import (
    compatible_block,
    family_for_field,
    field_key_for_block,
    parse_block_label,
    split_repeated_key,
)

logger = logging.getLogger(__name__)

_DEPENDENT_SELECT_WAIT_SECONDS = 2.0
_DEPENDENT_SELECT_POLL_SECONDS = 0.1

CONTROL_TYPES = (
    "text",
    "textarea",
    "select",
    "radio",
    "checkbox",
    "richtext",
    "file",
    "date",
    "month",
    "email",
    "tel",
    "number",
    "unknown",
)

# 读取页面可见控件的脚本。给每个控件打上 data-rf-index，保证生成的 selector 唯一。
#
# **密码框直接跳过**（连值都不读）：它永远不会被自动填，扫进来只会把用户输入的密码
# 带进内存快照。提交类控件同样跳过——这是"绝不自动提交"的第一道机械保证。
# ===== 识别一个控件的共用 JS =====
#
# 这段被**两个**脚本嵌进去用：整页扫描（``CONTROLS_SCRIPT``）与焦点监听
# （``FOCUS_LISTENER_SCRIPT``）。抽出来是因为"标签往上找几层、遇到什么要停"这类规则
# 是踩了三次坑才收敛出来的（腾讯的深层单选、美团的标签清单、字节的六层包装），
# **绝不能再有第二份实现**——两份就会分叉，而分叉的那一份没人测。
#
# 内容按 ``runtime/_rf_helpers.js`` 逐行转写（那份可读、可单独跑）；改的话两边一起改。
_CONTROL_HELPERS_JS = [
    "const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);\n",
    "const text = (el) => (el ? (el.textContent || '').replace(/\\s+/g, ' ').trim() : '');\n",
    "const labelFor = (el) => {\n",
    "  if (el.id) {\n",
    "    const l = document.querySelector('label[for=\"' + el.id + '\"]');\n",
    "    if (l) { return text(l); }\n",
    "  }\n",
    "  const wrap = el.closest('label');\n",
    "  if (wrap) { return text(wrap); }\n",
    "  return (el.getAttribute('aria-label') || '').trim();\n",
    "};\n",
    "// \u5f80\u4e0a\u627e\u6807\u7b7e\uff0c\u76f4\u5230\u8fd9\u4e00\u5c42\u4e0d\u518d\u662f\u300c\u4e00\u4e2a\u6807\u7b7e\u300d\u4e3a\u6b62\u3002\n",
    "//\n",
    "// **\u6df1\u5ea6\u4e0d\u80fd\u5199\u6210\u56fa\u5b9a\u7684\u5c0f\u6570\u5b57**\uff1a\u7ec4\u4ef6\u5e93\u7684\u5305\u88c5\u5c42\u6570\u5dee\u5f97\u5f88\u8fdc\u3002\u817e\u8baf/\u7f8e\u56e2\u7684\u6807\u7b7e\u5728\u5f80\u4e0a\n",
    "// 1~3 \u5c42\uff0c\u800c\u5b57\u8282\u90a3\u5957 ud__ \u628a input \u57cb\u5728 6 \u5c42\u91cc\uff08input \u2192 5 \u4e2a\u5305\u88c5 div \u2192\n",
    "// ud-formily-item\uff0c\u6807\u7b7e\u300e\u59d3\u540d*\u300f\u5c31\u5728\u7b2c 6 \u5c42\uff09\u3002\u5199\u6b7b 5 \u5c42\u65f6\u5b57\u8282\u9875\u9762\u4e0a**\u4e00\u534a\u63a7\u4ef6\u7684\n",
    "// \u6807\u7b7e\u5168\u53d6\u4e0d\u5230**\uff0c\u8868\u73b0\u4e3a\u6574\u9875\u300c\u6ca1\u8ba4\u51fa\u6765\u300d\u3002\n",
    "//\n",
    "// **\u4f46\u4e5f\u4e0d\u80fd\u4e00\u8def\u5f80\u4e0a\u5806**\uff1a\u518d\u4e0a\u4e00\u5c42\u5c31\u662f\u300e\u59d3\u540d*\u624b\u673a\u53f7\u7801*+86\u90ae\u7bb1*\u4e2a\u4eba\u8bc1\u4ef6*\u2026\u300f\u8fd9\u79cd\n",
    "// \u6574\u5757\u8868\u5355\u7684\u6807\u7b7e\u6e05\u5355\uff0c\u6536\u8fdb\u6765\u4f1a\u8ba9\u6bcf\u4e2a\u5b57\u6bb5\u90fd\u300c\u5339\u914d\u5f97\u4e0a\u300d\u4efb\u4f55\u63a7\u4ef6\u3002\u6240\u4ee5\u5224\u636e\u662f\n",
    "// \u300c\u8fd9\u4e00\u5c42\u8fd8\u50cf\u4e0d\u50cf**\u4e00\u4e2a**\u6807\u7b7e\u300d\u2014\u2014\n",
    "//   * \u5fc5\u586b\u6807\u8bb0 * \u51fa\u73b0 3 \u6b21\u4ee5\u4e0a \u2192 \u662f\u6807\u7b7e\u6e05\u5355\uff08\u4e00\u4e2a\u6807\u7b7e\u6700\u591a\u4e00\u4e2a\uff09\n",
    "//   * \u300c\u8bf7\u9009\u62e9 / \u8bf7\u8f93\u5165\u300d\u51fa\u73b0 2 \u6b21\u4ee5\u4e0a \u2192 \u540c\u7406\n",
    "//   * \u542b\u53e5\u672b\u6807\u70b9 \u2192 \u662f\u6b63\u6587\u8bf4\u660e\uff0c\u4e0d\u662f\u6807\u7b7e\n",
    "//   * \u8d85\u8fc7 200 \u5b57 \u2192 \u662f\u6574\u5757\u8868\u5355\n",
    "const SENTENCE_PUNCT = /[\u3002\uff01\uff1f\uff1b!?;]/;\n",
    "const LABEL_PREFIX = /\u8bf7\u9009\u62e9|\u8bf7\u8f93\u5165|\u8bf7\u586b\u5199/g;\n",
    "const REQUIRED_MARK = /\\*/g;\n",
    "const isLabelChunk = (chunk) =>\n",
    "  (chunk.match(REQUIRED_MARK) || []).length < 3 &&\n",
    "  (chunk.match(LABEL_PREFIX) || []).length < 2 &&\n",
    "  !SENTENCE_PUNCT.test(chunk) &&\n",
    "  chunk.length <= 200;\n",
    "const labelText = (el) => {\n",
    "  const parts = [];\n",
    "  let total = 0;\n",
    "  let node = el.closest('div, td, li, section, form');\n",
    "  for (let i = 0; i < 10 && node; i++) {\n",
    "    const chunk = text(node);\n",
    "    if (chunk) {\n",
    "      if (!isLabelChunk(chunk)) { break; }\n",
    "      if (total + chunk.length > 200) { break; }\n",
    "      parts.push(chunk);\n",
    "      total += chunk.length;\n",
    "    }\n",
    "    node = node.parentElement;\n",
    "  }\n",
    "  return parts.join(' ');\n",
    "};\n",
    "const blockIndex = (raw) => {\n",
    "  const value = String(raw || '').normalize('NFKC').trim();\n",
    "  if (!value) { return null; }\n",
    "  if (/^\\d+$/.test(value)) { const number = Number(value); return number > 0 ? number : null; }\n",
    "  const digits = {零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9};\n",
    "  const units = {十: 10, 百: 100, 千: 1000, 万: 10000};\n",
    "  let total = 0; let section = 0; let number = 0;\n",
    "  for (const char of value) {\n",
    "    if (Object.prototype.hasOwnProperty.call(digits, char)) { number = digits[char]; continue; }\n",
    "    const unit = units[char]; if (!unit) { return null; }\n",
    "    if (unit === 10000) { section = (section + number) * unit; total += section; section = 0; number = 0; }\n",
    "    else if (number) { section += number * unit; number = 0; }\n",
    "    else { section += unit; }\n",
    "  }\n",
    "  const result = total + section + number; return result > 0 ? result : null;\n",
    "};\n",
    "const blockFamily = (alias) => {\n",
    "  if (/实习|工作/.test(alias)) { return 'experience'; }\n",
    "  if (/项目/.test(alias)) { return 'project'; }\n",
    "  if (/校园|校内|社会实践/.test(alias)) { return 'campus'; }\n",
    "  if (/教育|学习/.test(alias)) { return 'education'; }\n",
    "  if (/获奖|奖项|荣誉/.test(alias)) { return 'award'; }\n",
    "  if (/学术|科研|论文/.test(alias)) { return 'academic'; }\n",
    "  if (/语言|外语/.test(alias)) { return 'language'; }\n",
    "  if (/证书/.test(alias)) { return 'certificate'; }\n",
    "  if (/技能/.test(alias)) { return 'skill'; }\n",
    "  if (/紧急联系人|紧急联络人/.test(alias)) { return 'contact'; }\n",
    "  if (/作品/.test(alias)) { return 'portfolio'; }\n",
    "  if (/社交/.test(alias)) { return 'social'; }\n",
    "  return '';\n",
    "};\n",
    "const parseBlockChunk = (chunk) => {\n",
    "  const aliases = '(实习和工作补充|实习和工作经历|实习经历|工作经历|工作经验|实习工作经历|项目经历|项目经验|校园和社会实践|校园经历|校内经历|社会实践|教育经历|学习经历|获奖信息|奖项信息|荣誉奖项|获奖经历|学术成果|语言能力|证书信息|技能信息|紧急联系人|作品和附件|作品经历|作品集|作品展示|社交账号|社交平台账号)';\n",
    "  let match = chunk.match(new RegExp('第\\s*([0-9０-９一二三四五六七八九十百千万]+)\\s*(?:条|段|项|个|份)?\\s*' + aliases));\n",
    "  let alias = ''; let rawIndex = '';\n",
    "  if (match) { alias = match[2]; rawIndex = match[1]; }\n",
    "  if (!match) { match = chunk.match(new RegExp(aliases + '\\s*(?:[-‐‑‒–—―－_＿:：]\\s*|第\\s*)?([0-9０-９一二三四五六七八九十百千万]+)\\s*(?:条|段|项|个|份)?')); }\n",
    "  if (match && !alias) { alias = match[1]; rawIndex = match[2]; }\n",
    "  if (!match) { return {label: '', family: '', index: null}; }\n",
    "  const index = blockIndex(rawIndex); if (!index) { return {label: '', family: '', index: null}; }\n",
    "  return {label: match[0].trim(), family: blockFamily(alias), index: index};\n",
    "};\n",
    "const blockInfo = (el) => {\n",
    "  let node = el ? el.parentElement : null;\n",
    "  for (let i = 0; i < 12 && node; i++) {\n",
    "    const chunk = text(node).slice(0, 800);\n",
    "    const found = parseBlockChunk(chunk);\n",
    "    if (found.family && found.index) {\n",
    "      const remainder = chunk.slice(chunk.indexOf(found.label) + found.label.length);\n",
    "      const other = parseBlockChunk(remainder);\n",
    "      if (other.family && (other.family !== found.family || other.index !== found.index)) { break; }\n",
    "      return found;\n",
    "    }\n",
    "    node = node.parentElement;\n",
    "  }\n",
    "  return {label: '', family: '', index: null};\n",
    "};\n",
    "const referencedText = (el, attribute) => {\n",
    "  const ids = (el.getAttribute(attribute) || '').trim().split(/\\s+/).slice(0, 5);\n",
    "  return ids.map((id) => text(document.getElementById(id))).filter(Boolean).join(' ').slice(0, 160);\n",
    "};\n",
    "const datePairOrder = (el) => {\n",
    "  if (el.tagName.toLowerCase() !== 'input') { return null; }\n",
    "  const placeholder = (el.getAttribute('placeholder') || '').trim();\n",
    "  const type = (el.getAttribute('type') || '').toLowerCase();\n",
    "  if (!/日期|时间|date/i.test(placeholder) && type !== 'date' && type !== 'month') { return null; }\n",
    "  let node = el.parentElement;\n",
    "  for (let i = 0; i < 6 && node; i++) {\n",
    "    const peers = [...node.querySelectorAll('input')].filter((item) => visible(item) && ((item.getAttribute('placeholder') || '').trim() === placeholder || (type && type === item.getAttribute('type'))));\n",
    "    if (peers.length === 2 && peers.includes(el)) { return peers.indexOf(el) + 1; }\n",
    "    if (peers.length > 2) { break; }\n",
    "    node = node.parentElement;\n",
    "  }\n",
    "  return null;\n",
    "};\n",
    "// \u5355\u9009/\u590d\u9009\u7684\u300c\u540c\u7ec4\u300d\u6807\u8bc6\u3002**\u4f18\u5148\u7528 name\uff0c\u4f46\u5f88\u591a\u7ad9\u70b9\u6839\u672c\u4e0d\u5199 name**\n",
    "// \uff082026-09-26 \u817e\u8baf\u6821\u62db\u7b80\u5386\u9875\u5b9e\u6d4b\uff1a\u6027\u522b\u7684\u4e24\u4e2a radio \u7684 name \u90fd\u662f\u7a7a\u4e32\uff09\uff0c\n",
    "// \u8fd9\u65f6\u9000\u56de\u300c\u6700\u8fd1\u7684\u5bb9\u5668\u300d\u2014\u2014\u540c\u4e00\u7ec4\u9009\u9879\u5fc5\u7136\u5728\u540c\u4e00\u4e2a\u5bb9\u5668\u91cc\u3002\n",
    "let groupSeq = 0;\n",
    "const groupOf = (el) => {\n",
    "  const own = el.getAttribute('name');\n",
    "  if (own) { return 'n:' + own; }\n",
    "  const box = el.closest('div, td, li, section, form');\n",
    "  if (!box) { return ''; }\n",
    "  if (!box.hasAttribute('data-rf-group')) {\n",
    "    box.setAttribute('data-rf-group', String(groupSeq++));\n",
    "  }\n",
    "  return 'g:' + box.getAttribute('data-rf-group');\n",
    "};\n",
    "// \u63a7\u4ef6\u7c7b\u578b\uff1b\u8fd4\u56de null \u8868\u793a**\u8fd9\u4e2a\u63a7\u4ef6\u4e0d\u8be5\u88ab\u78b0**\u2014\u2014\u5bc6\u7801\u6846\u8fde\u503c\u90fd\u4e0d\u8bfb\uff0c\u63d0\u4ea4\u7c7b\u63a7\u4ef6\n",
    "// \u6c38\u8fdc\u4e0d\u8be5\u88ab\u6253\u4e0a\u5b9a\u4f4d\u7b26\uff08\u8fd9\u662f\u300c\u7edd\u4e0d\u81ea\u52a8\u63d0\u4ea4\u300d\u7684\u7b2c\u4e00\u9053\u673a\u68b0\u4fdd\u8bc1\uff09\u3002\n",
    "const controlType = (el) => {\n",
    "  const tag = el.tagName.toLowerCase();\n",
    "  if (tag === 'textarea') { return 'textarea'; }\n",
    "  if (tag === 'select') { return 'select'; }\n",
    "  if (el.getAttribute('contenteditable') === 'true') { return 'richtext'; }\n",
    "  const t = (el.getAttribute('type') || 'text').toLowerCase();\n",
    "  if (t === 'file') { return 'file'; }\n",
    "  if (t === 'radio') { return 'radio'; }\n",
    "  if (t === 'checkbox') { return 'checkbox'; }\n",
    "  if (t === 'password' || t === 'hidden' || t === 'submit' || t === 'button' || t === 'reset' || t === 'image') {\n",
    "    return null;\n",
    "  }\n",
    "  if (t === 'date' || t === 'month') { return t; }\n",
    "  if (t === 'email' || t === 'tel' || t === 'number') { return t; }\n",
    "  return 'text';\n",
    "};\n",
    "const describeControl = (el, index, selector) => {\n",
    "  const tag = el.tagName.toLowerCase();\n",
    "  const selected = tag === 'select' && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;\n",
    "  const block = blockInfo(el);\n",
    "  return {\n",
    "    index: index,\n",
    "    type: controlType(el),\n",
    "    name: el.getAttribute('name') || '',\n",
    "    label: labelFor(el),\n",
    "    placeholder: el.getAttribute('placeholder') || '',\n",
    "    aria_label: el.getAttribute('aria-label') || '',\n",
    "    aria_labelledby: referencedText(el, 'aria-labelledby'),\n",
    "    aria_describedby: referencedText(el, 'aria-describedby'),\n",
    "    legend: text(el.closest('fieldset')?.querySelector('legend')).slice(0, 160),\n",
    "    title: (el.getAttribute('title') || '').slice(0, 160),\n",
    "    id: (el.id || '').slice(0, 160),\n",
    "    // \u6807\u51c6\u5316\u7684\u5b57\u6bb5\u7c7b\u578b\u63d0\u793a\u3002**\u8fd9\u662f\u552f\u4e00\u4e00\u4e2a\u4e0d\u9700\u8981\u731c\u7684\u4fe1\u53f7**\u2014\u2014\u89c4\u8303\u5199\u5f97\u597d\u7684\u8868\u5355\u4f1a\u5e26\u4e0a\uff0c\n",
    "    // \u8bfb\u5230\u5c31\u662f\u9ad8\u7f6e\u4fe1\u547d\u4e2d\uff08Chrome \u7684\u81ea\u52a8\u586b\u5145\u4e5f\u628a\u5b83\u5f53\u7b2c\u4e00\u4f18\u5148\u7ea7\uff09\u3002\n",
    "    autocomplete: (el.getAttribute('autocomplete') || '').trim().toLowerCase(),\n",
    "    required: el.required === true || el.getAttribute('aria-required') === 'true',\n",
    "    // 原生联动下拉的子级首次读取时可能只有占位项；只标记有明确联动信号的 select，\n",
    "    // 普通的「请选择」不能因此被误当成可延迟填充。\n",
    "    linked_select: tag === 'select' && (\n",
    "      el.getAttribute('data-rf-dependent') === 'true' ||\n",
    "      el.hasAttribute('data-parent') || el.hasAttribute('data-cascade') ||\n",
    "      !!el.getAttribute('aria-controls')\n",
    "    ),\n",
    "    // 只读 = 值不由用户敲进来。**级联选择器（省/市/区那类）的输入框几乎都是只读的**：\n",
    "    // 它是把内部状态显示出来，脚本直接写 `.value` 只会让框里出现一行字，组件的状态\n",
    "    // 一点没变——表单交上去还是空的。所以这类控件不能当普通文本框填。\n",
    "    readonly: el.readOnly === true,\n",
    "    // 点开会弹层的输入框（`aria-haspopup` / `role=combobox`）：自定义下拉、级联选择器。\n",
    "    // 原生 `<select>` 不算——它有隐式 role，但走的是 `type === 'select'` 那条路。\n",
    "    has_popup: !!el.getAttribute('aria-haspopup') || el.getAttribute('role') === 'combobox',\n",
    "    selector: selector,\n",
    "    options: tag === 'select'\n",
    "      ? [...el.options].map((o) => ({ v: String(o.value), t: (o.textContent || '').trim(), d: o.disabled === true }))\n",
    "      : [],\n",
    "    nearby_text: labelText(el).slice(0, 200),\n",
    "    block_label: block.label,\n",
    "    block_family: block.family,\n",
    "    block_index: block.index,\n",
    "    date_order: datePairOrder(el),\n",
    "    group: (controlType(el) === 'radio' || controlType(el) === 'checkbox') ? groupOf(el) : '',\n",
    "    value: String(el.value == null ? '' : el.value),\n",
    "    display: selected ? (selected.textContent || '').trim() : '',\n",
    "    checked: el.checked === true,\n",
    "  };\n",
    "};\n"]

# 整页扫描：给每个控件打上 ``data-rf-index``，返回控件清单。
#
# **IIFE 必须开在 helpers 之前**：``Runtime.evaluate`` 在全局作用域求值，helpers 里那些
# ``const`` 若落在函数外面就成了全局声明——第一次执行没事，**同一页面第二次执行会抛
# ``SyntaxError: Identifier 'visible' has already been declared``**（「读取当前表单」
# 点两次就中）。这个坑是端到端跑真页面时抓到的，canary 里也补了一条守卫。
CONTROLS_SCRIPT = "".join(
    [
        "(() => { /* rf:form-controls */\n",
        *_CONTROL_HELPERS_JS,
    "  const nodes = [...document.querySelectorAll('input, textarea, select, [contenteditable=\"true\"]')];\n",
    "  const out = [];\n",
    "  let idx = 0;\n",
    "  for (const el of nodes) {\n",
    "    const type = controlType(el);\n",
    "    if (type === null) { continue; }\n",
    "    if (type !== 'file' && !visible(el)) { continue; }\n",
    "    el.setAttribute('data-rf-index', String(idx));\n",
    "    out.push(describeControl(el, idx, '[data-rf-index=\"' + idx + '\"]'));\n",
    "    idx += 1;\n",
    "  }\n",
    "  return JSON.stringify({ url: location.href, title: document.title || '', controls: out });\n",
        "})()",
    ]
)



# 「点哪个填哪个」：在页面里装一个焦点监听与提示面板。
#
# 与整页扫描的关键差别是**不做预先快照**：你点到哪个框，才在现场描述那个框、现场匹配。
# 因此不存在"序号失效"的问题——那是我最初设计里最大的风险（页面联动会重排 DOM）。
#
# 面板用 shadow DOM 隔离；写入**不在这里做**——按钮只把"用户点了填入"记到
# ``window.__rfAccept``，真正的写入交给 Python 侧走同一套哑执行器，这样
# 写入 / 回读校验 / 失败上报都只有一份实现。
FOCUS_LISTENER_SCRIPT = "".join(
    [
        "(() => { /* rf:live-listener */\n",
        *_CONTROL_HELPERS_JS,
    "  if (window.__rfInstalled) { return JSON.stringify({ ok: true, already: true }); }\n",
    "  window.__rfInstalled = true;\n",
    "\n",
    "  // \u9762\u677f\u6302\u5728 shadow DOM \u91cc\uff1a\u7ad9\u70b9\u7684\u6837\u5f0f\u8fdb\u4e0d\u6765\uff0c\u6211\u4eec\u7684\u6837\u5f0f\u4e5f\u51fa\u4e0d\u53bb\u3002\n",
    "  // \u4e0d\u8fd9\u4e48\u505a\u7684\u8bdd\uff0c\u968f\u4fbf\u4e00\u4e2a `input { width: 100% }` \u4e4b\u7c7b\u7684\u5168\u5c40\u89c4\u5219\u5c31\u80fd\u628a\u9762\u677f\u641e\u53d8\u5f62\u3002\n",
    "  const host = document.createElement('div');\n",
    "  host.id = '__rf_live_host__';\n",
    "  host.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;';\n",
    "  document.documentElement.appendChild(host);\n",
    "  const shadow = host.attachShadow({ mode: 'open' });\n",
    "  shadow.innerHTML = [\n",
    "    '<style>',\n",
    "    '  *{box-sizing:border-box}',\n",
    "    // **面板是竖排的 flex 列**：`.body`（固定的头部与按钮）、`.alts`、`.pick`（可滚的资料区）\n",
    "    // 依次排下去。这样 `.pick` 拿到的是「面板上限减去上面几块」，而不是自己写一个\n",
    "    // `max-height`——两处各写一个的话它们互不知情：窗口偏矮或「其他候选」多几行时，\n",
    "    // 资料区会被面板的 `overflow:hidden` 裁掉，最后几行资料滚也看不到。\n",
    "    '  .p{position:fixed;display:flex;flex-direction:column;width:min(620px,calc(100vw - 16px));max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);background:#fff;border:1px solid #d6e0eb;border-radius:14px;',\n",
    "    '     box-shadow:0 14px 34px rgba(31,56,88,.16),0 3px 10px rgba(31,56,88,.08);font:13px/1.5 -apple-system,\"Segoe UI\",',\n",
    "    '     \"Microsoft YaHei\",sans-serif;color:#24364a;overflow:hidden}',\n",
    "    '  .body{padding:15px 16px 16px;background:linear-gradient(180deg,#f8fbfe 0%,#fff 74%)}',\n",
    "    '  .head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;cursor:grab;user-select:none}',\n",
    "    '  .head:active{cursor:grabbing}',\n",
    "    '  .drag-hint{margin-top:3px;color:#8b9bad;font-size:10px;line-height:1.4;user-select:none}',\n",
    "    '  .f{color:#435a72;font-size:12px;font-weight:600;display:flex;gap:6px;align-items:center;min-width:0}',\n",
    "    '  .src{display:none;padding:0 6px;border-radius:8px;font-size:11px;',\n",
    "    '       background:#eef4ff;color:#3978b0;border:1px solid #d9e7f6;flex:0 0 auto}',\n",
    "    '  .v{margin:7px 0 13px;word-break:break-word;font-weight:600;line-height:1.65;max-height:96px;overflow:auto;padding:9px 11px;border:1px solid #e4ebf3;border-radius:9px;background:#fff;color:#1f344a}',\n",
    "    '  .close{width:28px;height:28px;display:grid;place-items:center;flex:0 0 auto;padding:0;border:1px solid transparent;border-radius:8px;background:transparent;color:#8291a2;font-size:18px;line-height:1;transition:background .12s,border-color .12s,color .12s}',\n",
    "    '  .close:hover{background:#eef4f9;border-color:#d9e4ee;color:#263b50}',\n",
    "    '  .r{display:flex;gap:7px;align-items:center;flex-wrap:wrap}',\n",
    "    '  button{cursor:pointer;border:1px solid transparent;border-radius:8px;min-height:30px;padding:5px 12px;font-size:12px;font-weight:600;',\n",
    "    '         background:#3d82bd;color:#fff;font-family:inherit;white-space:nowrap;transition:background .12s,border-color .12s,box-shadow .12s}',\n",
    "    '  button:not(.navchip):not(.close):not(.navhead):hover:not(:disabled){background:#3475ad;box-shadow:0 2px 6px rgba(61,130,189,.18)}',\n",
    "    '  button.ghost{background:#f7f9fb;border-color:#dbe4ed;color:#4f647a}',\n",
    "    '  button.ghost:hover:not(:disabled){background:#eef4f9;border-color:#c7d6e4;color:#304b65;box-shadow:none}',\n",
    "    '  button:focus-visible,.navchip:focus-visible{outline:2px solid #8eb8dc;outline-offset:2px}',\n",
    "    '  button:disabled{background:#dce3ea;border-color:#dce3ea;color:#8794a2;cursor:default}',\n",
    "    // 提示**独占一行**（`flex:1 1 100%`）。原先它和按钮挤在同一行里，而按钮默认会被\n",
    "    // 压缩换行——提示写长一点（比如只读控件那句）就会把「填入」「收起」挤成竖排的两行。\n",
    "    // 上面那条 `flex-wrap:wrap` 是配套的：提示换到下一行，按钮留在原位。\n",
    "    '  .n{flex:1 1 100%;margin-top:6px;color:#999;font-size:12px;line-height:1.6}',\n",
    "    '  /* \u5176\u4ed6\u5019\u9009\uff1aAI \u62ff\u4e0d\u51c6\u65f6\u7ed9\u7684\u7b2c 2\u30013 \u540d\uff0c\u6bcf\u6761\u81ea\u5e26\u300c\u586b\u5165\u300d */',\n",
    "    '  .alts{display:none;border-top:1px solid #e7edf3;background:#fbfcfe}',\n",
    "    '  .alts.on{display:block}',\n",
    "    '  .alt{display:flex;gap:8px;align-items:center;padding:7px 14px}',\n",
    "    '  .alt:hover{background:#f3f7fb}',\n",
    "    '  .alt .al{color:#536b82;font-size:12px;flex:0 0 auto;font-weight:600}',\n",
    "    '  .alt .av{color:#263b50;flex:1 1 auto;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',\n",
    "    '  .alt button{flex:0 0 auto;padding:4px 10px;min-height:28px}',\n",
    "    '  /* \u5c55\u5f00\u533a\uff1a\u641c\u7d22 + \u5206\u7ec4\u8df3\u8f6c + \u6309\u5206\u533a\u5217\u51fa\u5168\u90e8\u8d44\u6599 */',\n",
    "    '  .pick{border-top:1px solid #e1e8f0;display:none;flex:1 1 auto;min-height:0;overflow:auto;background:#fbfcfe}',\n",
    "    '  .pick.on{display:block}',\n",
    "    '  .search{position:sticky;top:0;z-index:2;background:rgba(248,251,254,.98);padding:11px 14px 10px;border-bottom:1px solid #e3eaf2;box-shadow:0 3px 9px rgba(31,56,88,.06)}',\n",
    "    '  .search input{width:100%;box-sizing:border-box;height:34px;border:1px solid #d4dfe9;border-radius:9px;',\n",
    "    '                padding:7px 10px;background:#fff;color:#263b50;font-family:inherit;font-size:12px;line-height:1.5;outline:none;transition:border-color .12s,box-shadow .12s}',\n",
    "    '  .search input::placeholder{color:#9aa8b7}',\n",
    "    '  .search input:focus{border-color:#78a8d0;box-shadow:0 0 0 3px rgba(120,168,208,.16)}',\n",
    "    '  .hits{color:#7d8ea1;font-size:11px;margin-top:5px;min-height:16px}',\n",
    "    '  .hits:empty{display:none}',\n",
    "    // **换行铺开，不横向滚动。** 资料一多分组就有十几个，横向排会溢出去：用户得先横向\n",
    "    // 滚一段才能看见后面的组、再点——那和纵向滚着找条目是同一种累，等于白做了跳转。\n",
    "    // 换行之后所有组一眼可见，代价是占两三行高度（比\"找不到\"便宜得多）。\n",
    "    //\n",
    "    // 但换行**必须配一个高度上限，整块还得能折起来**：这块挂在 `position:sticky` 的搜索块\n",
    "    // 里，分组一多（真实资料库 50 组）胶囊能铺十几行，sticky 块便跟着长到超过资料区的可见\n",
    "    // 高度，把下面的「可能是这几个」和完整清单整片盖住——用户滚也滚不出来。所以拆成\n",
    "    // 折叠头（`.navhead`）+ 有上限的胶囊区（`.navbody`）：最坏情况只占一行。\n",
    "    '  .nav{display:flex;flex-direction:column;margin-top:8px;background:#f3f6fa;border:1px solid #e1e8f0;border-radius:10px;box-shadow:inset 0 1px 0 rgba(255,255,255,.8)}',\n",
    "    '  .navhead{display:flex;align-items:center;gap:6px;width:100%;min-height:0;border:0;border-radius:9px 9px 0 0;background:transparent;padding:7px 9px;color:#74869a;',\n",
    "    '           font-family:inherit;font-size:11px;font-weight:600;line-height:16px;text-align:left;white-space:nowrap;cursor:pointer}',\n",
    "    '  .nav.fold .navhead{border-radius:9px}',\n",
    "    '  .navhead:hover{background:#e9f0f8}',\n",
    "    '  .navhead:focus-visible{outline:2px solid #8eb8dc;outline-offset:-2px}',\n",
    "    '  .navhead .caret{flex:0 0 10px;color:#7d94b4;transition:transform .12s}',\n",
    "    '  .nav.fold .navhead .caret{transform:rotate(-90deg)}',\n",
    "    '  .navhead .sum{margin-left:auto;color:#8ea1b5;font-weight:500;font-variant-numeric:tabular-nums}',\n",
    "    // 胶囊区的上限由脚本按「资料区可见高度的三分之一」写进 `--rf-navmax`（那才是真正\n",
    "    // 保证跳转条吃不到资料区的那个值）；后面两个写死的数是没算出来之前的兜底。\n",
    "    '  .navbody{display:flex;flex-wrap:wrap;align-content:flex-start;gap:6px;padding:0 8px 8px;max-height:min(22vh,132px,var(--rf-navmax,132px));',\n",
    "    '           overflow:auto;overscroll-behavior:contain}',\n",
    "    '  .nav.fold .navbody{display:none}',\n",
    "    // 同类分组（「荣誉奖项 1 / 2 / 3」）**聚成一块**：家族胶囊 + 它的成员胶囊。家族胶囊的\n",
    "    // 折叠语义与列表里的 `.grp` 分组标题一致（点一下展开/收起），真正跳过去的是成员胶囊。\n",
    "    '  .navfam{display:flex;flex-wrap:wrap;align-items:center;gap:4px;flex:0 1 auto;max-width:100%}',\n",
    "    '  .navfam .navkids{display:none;flex-wrap:wrap;align-items:center;gap:4px}',\n",
    "    '  .navfam.open .navkids{display:flex}',\n",
    "    // 展开着的家族胶囊、以及\"人就在这一族里\"的家族胶囊，都点出来；成员胶囊自己另有 `.on`。\n",
    "    '  .navfam.open>.navchip,.navfam.active:not(.open)>.navchip{font-weight:700;box-shadow:0 0 0 2px rgba(82,125,165,.12)}',\n",
    "    '  .navchip.kid{min-height:25px;gap:5px;padding:2px 7px 2px 6px;font-size:11px}',\n",
    "    '  .navchip.kid .c{min-width:16px;padding:0 4px;line-height:15px}',\n",
    "    '  .navchip{--chip-border:#d5e0ea;--chip-bg:#f5f8fb;--chip-text:#40566e;--chip-accent:#82a7c8;display:inline-flex;align-items:center;gap:6px;flex:0 1 auto;max-width:100%;min-height:29px;border:1px solid var(--chip-border);background:#fff;border-radius:8px;padding:4px 8px 4px 7px;',\n",
    "    '           font-family:inherit;font-size:12px;line-height:1.35;color:var(--chip-text);cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s,box-shadow .12s}',\n",
    "    '  .navchip::before{content:\"\";width:6px;height:6px;flex:0 0 6px;border-radius:50%;background:var(--chip-accent);box-shadow:0 0 0 2px var(--chip-bg)}',\n",
    "    '  .navchip:hover{background:var(--chip-bg);border-color:var(--chip-accent);box-shadow:0 2px 6px rgba(31,56,88,.08)}',\n",
    "    '  .navchip.on{background:var(--chip-bg);border-color:var(--chip-accent);color:var(--chip-text);font-weight:700;box-shadow:0 0 0 2px rgba(82,125,165,.12)}',\n",
    "    '  .navchip .nm{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',\n",
    "    '  .navchip[data-tone=\"0\"]{--chip-border:#c9dbe9;--chip-bg:#f4f8fb;--chip-text:#2e6da4;--chip-accent:#7fa7ca}',\n",
    "    '  .navchip[data-tone=\"1\"]{--chip-border:#c9ddd7;--chip-bg:#f4f9f7;--chip-text:#3d7668;--chip-accent:#78a996}',\n",
    "    '  .navchip[data-tone=\"2\"]{--chip-border:#d4cfe4;--chip-bg:#f8f7fb;--chip-text:#64598e;--chip-accent:#968bc4}',\n",
    "    '  .navchip[data-tone=\"3\"]{--chip-border:#dfd2bc;--chip-bg:#fbf9f4;--chip-text:#8b6e3f;--chip-accent:#b59a6e}',\n",
    "    '  .navchip[data-tone=\"4\"]{--chip-border:#dfcbd1;--chip-bg:#fbf8f9;--chip-text:#945d6b;--chip-accent:#b98b99}',\n",
    "    '  .navchip[data-tone=\"5\"]{--chip-border:#c8dadd;--chip-bg:#f4f9fa;--chip-text:#3d747d;--chip-accent:#77aab1}',\n",
    "    // 条数做成独立的小胶囊。分组名常以数字结尾（「专业技能 1」），跟条数拼在一起\n",
    "    // （「专业技能 1 2」）会被读成「专业技能12」——有边界就不会。\n",
    "    '  .navchip .c{min-width:19px;margin-left:1px;padding:1px 5px;border:1px solid #e0e7ee;border-radius:999px;background:#f0f3f7;',\n",
    "    '               color:#718196;font-size:11px;line-height:16px;text-align:center;font-weight:600;font-variant-numeric:tabular-nums}',\n",
    "    '  .navchip.on .c{background:#fff;border-color:var(--chip-accent);color:var(--chip-text)}',\n",
    "    '  .navchip .caret{flex:0 0 9px;margin-left:1px;color:var(--chip-accent);font-size:10px;line-height:1;transition:transform .12s}',\n",
    "    '  .navfam.open>.navchip .caret{transform:rotate(180deg)}',\n",
    "    '  .grp{--grp-border:#d5e0ea;--grp-bg:#f7f9fb;--grp-text:#40566e;--grp-accent:#82a7c8;position:relative;display:flex;align-items:center;gap:7px;',\n",
    "    '       padding:9px 14px 9px 11px;color:var(--grp-text);font-size:12px;font-weight:700;background:var(--grp-bg);',\n",
    "    '       border-bottom:1px solid #e5ebf1;border-left:3px solid var(--grp-accent);cursor:pointer;transition:background .12s}',\n",
    "    '  .grp:hover{background:#f1f5f9}',\n",
    "    '  .grp[data-tone=\"0\"]{--grp-border:#c9dbe9;--grp-bg:#f4f8fb;--grp-text:#2e6da4;--grp-accent:#7fa7ca}',\n",
    "    '  .grp[data-tone=\"1\"]{--grp-border:#c9ddd7;--grp-bg:#f4f9f7;--grp-text:#3d7668;--grp-accent:#78a996}',\n",
    "    '  .grp[data-tone=\"2\"]{--grp-border:#d4cfe4;--grp-bg:#f8f7fb;--grp-text:#64598e;--grp-accent:#968bc4}',\n",
    "    '  .grp[data-tone=\"3\"]{--grp-border:#dfd2bc;--grp-bg:#fbf9f4;--grp-text:#8b6e3f;--grp-accent:#b59a6e}',\n",
    "    '  .grp[data-tone=\"4\"]{--grp-border:#dfcbd1;--grp-bg:#fbf8f9;--grp-text:#945d6b;--grp-accent:#b98b99}',\n",
    "    '  .grp[data-tone=\"5\"]{--grp-border:#c8dadd;--grp-bg:#f4f9fa;--grp-text:#3d747d;--grp-accent:#77aab1}',\n",
    "    '  .grp:focus-visible{outline:2px solid #8eb8dc;outline-offset:-2px}',\n",
    "    '  .grp .caret{flex:0 0 auto;width:10px;color:var(--grp-accent);transition:transform .12s}',\n",
    "    '  .grp.fold .caret{transform:rotate(-90deg)}',\n",
    "    '  .grp .gt{flex:0 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',\n",
    "    '  .grp .gc{flex:0 0 auto;padding:1px 6px;border:1px solid #e0e7ee;border-radius:999px;background:#fff;color:#8090a2;font-size:11px;font-weight:600;line-height:16px}',\n",
    "    '  .row{padding:10px 14px;cursor:pointer;display:grid;grid-template-columns:minmax(0,1fr) auto;gap:10px;align-items:center;border-bottom:1px solid #edf1f5;min-height:64px;background:#fff;transition:background .12s}',\n",
    "    '  .row:hover,.row:focus-visible{background:#f6f9fc}',\n",
    "    '  .row:focus-visible{outline:2px solid #8eb8dc;outline-offset:-2px}',\n",
    "    '  .row .main{min-width:0;display:grid;gap:4px}',\n",
    "    '  .row .meta{display:flex;align-items:center;gap:6px;min-width:0;line-height:1.35}',\n",
    "    '  .row .l{color:var(--row-text,#53657c);font-weight:650;min-width:0;max-width:100%;display:-webkit-box;',\n",
    "    '           -webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;overflow-wrap:anywhere}',\n",
    "    '  .row .group{flex:0 1 auto;min-width:0;max-width:48%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;',\n",
    "    '              color:var(--row-text,#2e6da4);font-size:10px;line-height:16px;padding:0 6px;',\n",
    "    '              border:1px solid var(--row-border,#b8d4f2);background:var(--row-bg,#f2f7ff);border-radius:999px}',\n",
    "    '  .row .t{color:#253a50;min-width:0;max-width:100%;display:-webkit-box;-webkit-box-orient:vertical;',\n",
    "    '           -webkit-line-clamp:3;overflow:hidden;overflow-wrap:anywhere;word-break:break-word;text-align:left;line-height:1.55}',\n",
    "    '  .row .from{flex:0 0 auto;font-size:10px;line-height:16px;color:#527ca4;',\n",
    "    '              background:#f1f6fb;border:1px solid #d6e3ef;border-radius:999px;padding:0 6px}',\n",
    "    '  .row .go{align-self:center;min-width:56px;min-height:30px;border:1px solid #cbd9e6;background:#fff;border-radius:8px;padding:5px 10px;',\n",
    "    '           font-family:inherit;font-size:12px;line-height:1.5;font-weight:600;color:#3978b0;cursor:pointer;opacity:1;white-space:nowrap;transition:background .12s,border-color .12s,box-shadow .12s}',\n",
    "    '  .row .go:hover{border-color:var(--row-border,#b8d4f2);background:var(--row-bg,#f2f7ff);box-shadow:none}',\n",
    "    '  .row .go:focus-visible{outline:2px solid #8eb8dc;outline-offset:2px}',\n",
    "    '  .gofold{display:none}',\n",
    "    '  .empty{padding:22px 14px;color:#8796a6;font-size:12px;line-height:1.7;text-align:center}',\n",
    "    // 「可能是这几个」：按**当前这个框**的文字挑出的前几条，压在完整清单上面。\n",
    "    // 用浅蓝底与下面的清单区分开——它是「很可能就是这个」的意思，不是另一个分区。\n",
    "    '  .related{display:none;background:#f7fbfe;border-bottom:1px solid #e1edf6;padding-bottom:5px}',\n",
    "    '  .related.on{display:block}',\n",
    "    '  .rlt{padding:9px 14px 4px;color:#527da4;font-size:11px;font-weight:700}',\n",
    "    '  .related .row{border-bottom:0}',\n",
    "    '</style>',\n",
    "    '<div class=\"p\" style=\"display:none\">',\n",
    "    '  <div class=\"body\">',\n",
    "    '    <div class=\"head\"><div><div class=\"f\"><span class=\"src\"></span><span class=\"fl\"></span></div><div class=\"drag-hint\">可拖动标题栏调整位置</div></div><button class=\"close\" type=\"button\" aria-label=\"Close click-to-fill panel\">x</button></div><div class=\"v\"></div>',\n",
    "    '    <div class=\"r\">',\n",
    "    '      <button class=\"fill\">\u586b\u5165</button>',\n",
    "    '      <button class=\"ghost remember\">\u8bb0\u4f4f\u8fd9\u6761</button>',\n",
    "    '      <button class=\"ghost more\">\u6362\u4e2a\u8d44\u6599\u2026</button>',\n",
    "    '      <span class=\"n\"></span>',\n",
    "    '    </div>',\n",
    "    '  </div>',\n",
    "    '  <div class=\"alts\"></div>',\n",
    "    '  <div class=\"pick\">',\n",
    "    '    <div class=\"search\">',\n",
    "    '      <input type=\"text\" placeholder=\"\u641c\u7d22\u8d44\u6599\uff08\u5982\uff1a\u624b\u673a\u3001\u5b66\u6821\u3001\u5b9e\u4e60\uff09\">',\n",
    "    '      <div class=\"hits\"></div>',\n",
    "    '      <div class=\"nav\" role=\"group\" aria-label=\"分组快速定位\">',\n",
    "    '<button class=\"navhead\" type=\"button\" aria-expanded=\"true\"><span class=\"caret\">▾</span><span class=\"nhl\">分组快速定位</span><span class=\"sum\"></span></button>',\n",
    "    '<div class=\"navbody\"></div>',\n",
    "    '</div>',\n",
    "    '    </div>',\n",
    "    '    <div class=\"related\"></div>',\n",
    "    '    <div class=\"list\"></div>',\n",
    "    '  </div>',\n",
    "    '  </div>',\n",
    "    '</div>',\n",
    "  ].join('');\n",
    "  const panel = shadow.querySelector('.p');\n",
    "  const elField = shadow.querySelector('.f .fl');\n",
    "  const elClose = shadow.querySelector('.close');\n",
    "  const elSource = shadow.querySelector('.src');\n",
    "  const elValue = shadow.querySelector('.v');\n",
    "  const elFill = shadow.querySelector('.fill');\n",
    "  const elMore = shadow.querySelector('.more');\n",
    "  const elRemember = shadow.querySelector('.remember');\n",
    "  const elNote = shadow.querySelector('.n');\n",
    "  const elAlts = shadow.querySelector('.alts');\n",
    "  const elPick = shadow.querySelector('.pick');\n",
    "  const elSearchBox = shadow.querySelector('.search');\n",
    "  const elSearch = shadow.querySelector('.search input');\n",
    "  const elNav = shadow.querySelector('.nav');\n",
    "  const elNavHead = shadow.querySelector('.navhead');\n",
    "  const elNavBody = shadow.querySelector('.navbody');\n",
    "  const elNavSum = shadow.querySelector('.navhead .sum');\n",
    "  const elHits = shadow.querySelector('.hits');\n",
    "  const elRelated = shadow.querySelector('.related');\n",
    "  const elList = shadow.querySelector('.list');\n",
    "\n",
    "  // \u5f53\u524d\u805a\u7126\u7684\u63a7\u4ef6\u3002**\u6bcf\u6b21\u805a\u7126\u90fd\u91cd\u65b0\u6807\u8bb0**\uff0c\u800c\u4e0d\u662f\u590d\u7528\u6574\u9875\u626b\u63cf\u65f6\u6253\u7684\u5e8f\u53f7\uff1a\n",
    "  // \u5e8f\u53f7\u662f DOM \u987a\u5e8f\uff0c\u9875\u9762\u4e00\u8054\u52a8\uff08\u9009\u4e86\u56fd\u5bb6\u3001\u7701\u4efd\u624d\u52a0\u8f7d\uff09\u5c31\u53ef\u80fd\u9519\u4f4d\uff0c\u800c\u8fd9\u91cc\u6c38\u8fdc\u662f\u65b0\u9c9c\u7684\u3002\n",
    "  let focused = null;\n",
    "  // \u7126\u70b9\u63a7\u4ef6\u7684\u63cf\u8ff0\uff0c\u5728**\u805a\u7126\u90a3\u4e00\u523b**\u5c31\u5b58\u4e0b\u6765\u3002\n",
    "  //\n",
    "  // \u4e3a\u4ec0\u4e48\u4e0d\u80fd\u7b49\"\u7528\u6237\u70b9\u4e86\u6e05\u5355\"\u518d\u53bb\u95ee `window.__rfFocus`\uff1a\u70b9\u9762\u677f\u4f1a\u8ba9\u9875\u9762\u7684\u8f93\u5165\u6846\u5931\u7126\uff0c\n",
    "  // \u7126\u70b9\u8f6c\u79fb\u7684\u90a3\u4e00\u77ac\u95f4\u63cf\u8ff0\u5c31\u53ef\u80fd\u88ab\u6e05\u6389\u2014\u2014\u5b9e\u6d4b\u5230\u7684\u540e\u679c\u662f\"\u6311\u4e86\u4e00\u6761\u8d44\u6599\uff0c\u5199\u5165\u5374\u5931\u8d25\"\u3002\n",
    "  // \u6240\u4ee5\u9009\u62e9\u65f6\u628a\u63cf\u8ff0**\u968f\u9009\u62e9\u4e00\u8d77**\u4ea4\u7ed9 Python\uff0c\u4e0d\u4f9d\u8d56\u4efb\u4f55\u5168\u5c40\u72b6\u6001\u8fd8\u6d3b\u7740\u3002\n",
    "  let currentDescription = null;\n",
    "  // \u7126\u70b9\u63a7\u4ef6\u672c\u8eab\u3002\u9009\u5b9a\u65f6\u9760\u5b83\u6253\u4e00\u4e2a**\u4e0d\u4f1a\u88ab\u7126\u70b9\u53d8\u5316\u642c\u8d70\u7684\u6807\u8bb0**\u2014\u2014\n",
    "  // `data-rf-focus` \u4f1a\u5728\u4e0b\u4e00\u6b21\u805a\u7126\u65f6\u79fb\u8d70\uff08\u90a3\u662f\u5b83\u7684\u804c\u8d23\uff09\uff0c\u800c\"\u7528\u6237\u6311\u4e86\u8fd9\u6761\u3001\u7b49 Python \u6765\u5199\"\n",
    "  // \u8fd9\u4ef6\u4e8b\u5fc5\u987b\u6709\u4e00\u4e2a\u7a33\u5b9a\u7684\u843d\u70b9\u3002\n",
    "  let currentElement = null;\n",
    "  // \u9f20\u6807\u6309\u5728\u9762\u677f\u4e0a\u65f6\u4e0d\u8981\u6536\u8d77\u9762\u677f\uff1amousedown \u5148\u4e8e blur/focusout \u53d1\u751f\uff0c\u7528\u8fd9\u4e2a\u6807\u8bb0\u6321\u4f4f\u3002\n",
    "  let interacting = false;\n",
    "  // \u5c55\u5f00\u72b6\u6001**\u8de8\u7126\u70b9\u4fdd\u7559**\uff08\u7528\u6237\u8fde\u7740\u51e0\u4e2a\u6846\u90fd\u60f3\u81ea\u5df1\u6311\u65f6\uff0c\u4e0d\u7528\u6bcf\u6b21\u518d\u70b9\u4e00\u4e0b\uff09\u3002\n",
    "  // \u641c\u7d22\u8bcd\u5219\u4e0d\u4fdd\u7559\u2014\u2014\u641c\"\u624b\u673a\"\u4e4b\u540e\u70b9\u5230\u90ae\u7bb1\u6846\uff0c\u8fd8\u663e\u793a\u6ee4\u8fc7\u7684\u5217\u8868\u4f1a\u66f4\u8ba9\u4eba\u56f0\u60d1\u3002\n",
    "  let expanded = false;\n",
    "  let userInputValue = '';\n",
    "\n",
    "  // \u7528\u6237\u62d6\u52a8\u9762\u677f\u540e\uff0c\u8bb0\u4f4f\u7684\u662f**\u76f8\u5bf9\u951a\u70b9\u4f4d\u7f6e\u7684\u504f\u79fb**\uff0c\u4e0d\u662f\u7edd\u5bf9\u5750\u6807\u3002\n",
    "  //\n",
    "  // \u8fd9\u6837\"\u632a\u5f00\u4e00\u70b9\"\u548c\"\u8ddf\u7740\u8f93\u5165\u6846\u8d70\"\u53ef\u4ee5\u540c\u65f6\u6210\u7acb\uff1a\u6321\u4f4f\u4e86\u4e0b\u4e00\u4e2a\u5b57\u6bb5\u5c31\u5f80\u4e0a\u63a8\u4e00\u70b9\uff0c\u70b9\u5230\u522b\u7684\u6846\n",
    "  // \u65f6\u5b83\u4ecd\u7136\u8d34\u5728\u90a3\u4e2a\u6846\u65c1\u8fb9\u3002\u8bb0\u7edd\u5bf9\u5750\u6807\u7684\u8bdd\uff0c\u62d6\u8fc7\u4e00\u6b21\u4e4b\u540e\u5c31\u518d\u4e5f\u4e0d\u8ddf\u4e86\u2014\u2014\u800c\u90a3\u6b63\u662f\u8fd9\u4e2a\u529f\u80fd\n",
    "  // \u5b58\u5728\u7684\u610f\u4e49\uff08\u6309\u94ae\u8981\u79bb\u8f93\u5165\u6846\u8fd1\uff09\u3002\n",
    "  let dragOffset = null;\n",
    "\n",
    "  // \u8f93\u5165\u6846\u5728 iframe \u91cc\u65f6 `getBoundingClientRect()` \u662f**\u76f8\u5bf9\u90a3\u4e2a\u5b50\u6846\u67b6**\u7684\uff0c\u800c\u6211\u4eec\u7b97\u7684\u662f\n",
    "  // \u9876\u5c42\u7a97\u53e3\u7684\u89c6\u53e3\uff0c\u9762\u677f\u4f1a\u88ab\u7529\u5230\u9519\u7684\u5730\u65b9\u3002\u5f53\u524d\u6ce8\u5165\u53ea\u88c5\u4e3b\u6846\u67b6\uff08`Runtime.evaluate` \u4e0d\u5e26\n",
    "  // contextId \u5c31\u662f\u4e3b\u6846\u67b6\uff09\uff0c\u6240\u4ee5\u8fd9\u4e2a\u5206\u652f\u6b63\u5e38\u8d70\u4e0d\u5230\uff1b\u7559\u7740\u662f\u4e3a\u4e86\u4e07\u4e00\u54ea\u5929\u6539\u6210\u9010\u6846\u67b6\u6ce8\u5165\u65f6\uff0c\n",
    "  // \u5b9a\u4f4d\u81f3\u5c11\u662f\"\u53ef\u9884\u6d4b\u7684\u89d2\u843d\"\u800c\u4e0d\u662f\"\u83ab\u540d\u5176\u5999\u7684\u5730\u65b9\"\u3002\n",
    "  const inFrame = window.top !== window.self;\n",
    "\n",
    "  /** \u7b97\u51fa\u9762\u677f\u8be5\u5728\u54ea\u3002**\u53ea\u7b97\u4e0d\u5199**\uff0c\u8fd9\u6837\"\u5750\u6807\u6ca1\u53d8\u5c31\u4e0d\u78b0 DOM\"\u80fd\u505a\u5230\u3002 */\n",
    "  const targetPosition = () => {\n",
    "    const rect = focused.getBoundingClientRect();\n",
    "    const width = panel.offsetWidth || 500;\n",
    "    const height = panel.offsetHeight || 240;\n",
    "    const gap = 8;\n",
    "    const maxLeft = Math.max(gap, window.innerWidth - width - gap);\n",
    "    const maxTop = Math.max(gap, window.innerHeight - height - gap);\n",
    "\n",
    "    if (inFrame) {\n",
    "      return { left: maxLeft, top: gap };\n",
    "    }\n",
    "\n",
    "    let left;\n",
    "    let top;\n",
    "    // **\u4f18\u5148\u8d34\u53f3\u4fa7**\uff1a\u7528\u6237\u521a\u70b9\u5b8c\u8f93\u5165\u6846\uff0c\u624b\u5c31\u5728\u6846\u9644\u8fd1\uff0c\u6309\u94ae\u653e\u53f3\u8fb9\u6700\u8fd1\u3002\n",
    "    const fitsRight = rect.right + gap + width <= window.innerWidth - gap;\n",
    "    const fitsLeft = rect.left - gap - width >= gap;\n",
    "    if (fitsRight || fitsLeft) {\n",
    "      left = fitsRight ? rect.right + gap : rect.left - gap - width;\n",
    "      top = rect.top;\n",
    "    } else {\n",
    "      // \u5de6\u53f3\u90fd\u653e\u4e0d\u4e0b\uff08\u7a84\u5c4f\u3001\u6216\u8005\u6574\u884c\u5bbd\u5ea6\u7684\u5b57\u6bb5\uff09\u624d\u9000\u56de\u4e0a\u4e0b\u3002\n",
    "      // **\u8fd9\u65f6\u7edd\u4e0d\u80fd\u4e0e\u8f93\u5165\u6846\u91cd\u53e0**\u2014\u2014\u6321\u4f4f\u7528\u6237\u6b63\u8981\u8f93\u5165\u7684\u6846\u662f\u6700\u7cdf\u7684\u4f4d\u7f6e\u3002\n",
    "      left = rect.left;\n",
    "      top = rect.bottom + gap;\n",
    "      if (top + height > window.innerHeight - gap) {\n",
    "        top = Math.max(gap, rect.top - height - gap);\n",
    "      }\n",
    "    }\n",
    "    left += dragOffset ? dragOffset.left : 0;\n",
    "    top += dragOffset ? dragOffset.top : 0;\n",
    "    return {\n",
    "      left: Math.max(gap, Math.min(left, maxLeft)),\n",
    "      top: Math.max(gap, Math.min(top, maxTop)),\n",
    "    };\n",
    "  };\n",
    "\n",
    "  // \u4e0a\u4e00\u6b21\u5199\u4e0b\u53bb\u7684\u5750\u6807\u3002**\u53ea\u6709\u771f\u7684\u53d8\u4e86\u624d\u78b0 style**\u2014\u2014\u5426\u5219\u4e0b\u9762\u90a3\u4e2a\u5b9a\u65f6\u5668\u6bcf 200ms \u90fd\u4f1a\n",
    "  // \u89e6\u53d1\u4e00\u6b21\u65e0\u8c13\u7684\u6837\u5f0f\u5199\u5165\uff0c\u9875\u9762\u56e0\u6b64\u4e00\u76f4\u5728\u91cd\u6392\u3002\n",
    "  let lastLeft = -1;\n",
    "  let lastTop = -1;\n",
    "\n",
    "  const position = () => {\n",
    "    if (!focused || panel.style.display === 'none') { return; }\n",
    "    const next = targetPosition();\n",
    "    if (next.left === lastLeft && next.top === lastTop) { return; }\n",
    "    lastLeft = next.left;\n",
    "    lastTop = next.top;\n",
    "    panel.style.left = next.left + 'px';\n",
    "    panel.style.top = next.top + 'px';\n",
    "  };\n",
    "\n",
    "  // **\u9875\u9762\u81ea\u5df1\u4f1a\u52a8\uff0c\u800c scroll / resize \u4e00\u4e2a\u90fd\u4e0d\u4f1a\u89e6\u53d1**\uff1a\u7ea7\u8054\u4e0b\u62c9\u9009\u4e86\u56fd\u5bb6\u624d\u52a0\u8f7d\u7701\u4efd\u3001\n",
    "  // \u6821\u9a8c\u9519\u8bef\u63d0\u793a\u63d2\u5728\u5b57\u6bb5\u4e0a\u65b9\u3001\u6298\u53e0\u533a\u5c55\u5f00\u2014\u2014\u8f93\u5165\u6846\u7684\u4f4d\u7f6e\u53d8\u4e86\uff0c\u9875\u9762\u65e2\u6ca1\u6eda\u4e5f\u6ca1\u7f29\u3002\n",
    "  // \u5149\u9760\u4e8b\u4ef6\u8ddf\u4e0d\u4f4f\uff0c\u6240\u4ee5\u9762\u677f\u663e\u793a\u671f\u95f4\u5b9a\u671f\u5bf9\u4e00\u6b21\u5750\u6807\uff08\u5750\u6807\u6ca1\u53d8\u5c31\u4ec0\u4e48\u90fd\u4e0d\u505a\uff09\u3002\n",
    "  // \u7528\u5b9a\u65f6\u5668\u800c\u4e0d\u662f `ResizeObserver`\uff1a\u540e\u8005\u76ef\u7684\u662f**\u5c3a\u5bf8**\uff0c\u800c\u8fd9\u91cc\u8981\u8ddf\u7684\u662f**\u4f4d\u7f6e**\uff0c\n",
    "  // \u800c\u4e14\u5b83\u8fd8\u5f97\u968f\u7126\u70b9\u6362\u89c2\u5bdf\u76ee\u6807\u3001\u5378\u8f7d\u65f6\u8bb0\u5f97\u65ad\u5f00\u2014\u2014\u4e00\u4e2a `clearInterval` \u89e3\u51b3\u7684\u4e8b\uff0c\u4e0d\u5fc5\u3002\n",
    "  const REFLOW_CHECK_MS = 200;\n",
    "  const reflowTimer = window.setInterval(position, REFLOW_CHECK_MS);\n",
    "\n",
    "  /**\n",
    "   * \u6309\u4f4f\u9762\u677f\u7a7a\u767d\u5904\u53ef\u4ee5\u62d6\u8d70\u3002\n",
    "   *\n",
    "   * \u8868\u5355\u7a84\u7684\u65f6\u5019\u8d34\u8fb9\u4f1a\u76d6\u4f4f\u76f8\u90bb\u5b57\u6bb5\u2014\u2014\u800c\"\u76d6\u4f4f\u4e86\u54ea\u4e00\u5757\"\u53ea\u6709\u7528\u6237\u81ea\u5df1\u77e5\u9053\uff0c\u6240\u4ee5\u7ed9\u4ed6\u4e00\u6839\n",
    "   * \u624b\u6307\u5934\uff0c\u6bd4\u6211\u4eec\u731c\u4e00\u767e\u79cd\u907f\u8ba9\u89c4\u5219\u90fd\u7ba1\u7528\u3002\u70b9\u5728\u6309\u94ae / \u8f93\u5165\u6846 / \u6e05\u5355\u884c\u4e0a\u4e0d\u7b97\u62d6\u52a8\u3002\n",
    "   */\n",
    "  const onDragStart = (event) => {\n",
    "    if (event.button !== 0 || !focused) { return; }\n",
    "    const target = event.target;\n",
    "    if (target && target.closest && target.closest('button, input, .row, .alt')) { return; }\n",
    "    const startX = event.clientX;\n",
    "    const startY = event.clientY;\n",
    "    const baseLeft = dragOffset ? dragOffset.left : 0;\n",
    "    const baseTop = dragOffset ? dragOffset.top : 0;\n",
    "    const move = (moveEvent) => {\n",
    "      // \u62d6\u52a8\u91cf\u53e0\u52a0\u5728\u539f\u6709\u504f\u79fb\u4e0a\u2014\u2014\u9762\u677f\u59cb\u7ec8\u662f\"\u8d34\u7740\u8f93\u5165\u6846\u3001\u518d\u632a\u5f00\u8fd9\u4e48\u591a\"\u3002\n",
    "      dragOffset = {\n",
    "        left: baseLeft + (moveEvent.clientX - startX),\n",
    "        top: baseTop + (moveEvent.clientY - startY),\n",
    "      };\n",
    "      // \u62d6\u52a8\u662f\"\u7acb\u523b\u8981\u770b\u5230\"\u7684\uff0c\u7ed5\u5f00\"\u5750\u6807\u6ca1\u53d8\u5c31\u4e0d\u5199\"\u90a3\u5c42\u7f13\u5b58\u3002\n",
    "      lastLeft = -1;\n",
    "      lastTop = -1;\n",
    "      position();\n",
    "    };\n",
    "    const up = () => {\n",
    "      window.removeEventListener('mousemove', move, true);\n",
    "      window.removeEventListener('mouseup', up, true);\n",
    "    };\n",
    "    window.addEventListener('mousemove', move, true);\n",
    "    window.addEventListener('mouseup', up, true);\n",
    "    event.preventDefault();\n",
    "  };\n",
    "  panel.addEventListener('mousedown', onDragStart, true);\n",
    "\n",
    "  const catalog = () => (Array.isArray(window.__rfCatalog) ? window.__rfCatalog : []);\n",
    "\n",
    "  /** \u6e05\u5355\u4e0e\u300c\u53ef\u80fd\u662f\u8fd9\u51e0\u4e2a\u300d\u5171\u7528\u7684\u4e00\u884c\uff1a\u6807\u7b7e + \u503c + \u6765\u6e90\u6807\u8bb0 + \u300c\u586b\u5165\u300d\u3002 */\n",
    "  const makePickerRow = (item, toneByGroup = null) => {\n",
    "    const row = document.createElement('div');\n",
    "    row.className = 'row';\n",
    "    row.tabIndex = 0;\n",
    "    const group = String(item.group || '\u5176\u4ed6');\n",
    "    const tone = groupTone(group, toneByGroup || buildGroupTones());\n",
    "    row.dataset.group = group;\n",
    "    applyTone(row, tone);\n",
    "    // \u5b8c\u6574\u5185\u5bb9\u6302\u5728 title \u4e0a\uff1a\u540d\u5b57\u88ab\u622a\u65ad\u4e4b\u540e\uff0c\u9f20\u6807\u505c\u4e00\u4e0b\u5c31\u770b\u5f97\u5168\u3002\n",
    "    row.title = `${item.label || ''}\uff1a${item.value || ''}`;\n",
    "    const main = document.createElement('div');\n",
    "    main.className = 'main';\n",
    "    const meta = document.createElement('div');\n",
    "    meta.className = 'meta';\n",
    "    const label = document.createElement('span');\n",
    "    label.className = 'l';\n",
    "    label.textContent = item.label || '';\n",
    "    label.title = item.label || '';\n",
    "    const groupTag = document.createElement('span');\n",
    "    groupTag.className = 'group';\n",
    "    groupTag.textContent = group;\n",
    "    groupTag.title = group;\n",
    "    const text = document.createElement('span');\n",
    "    text.className = 't';\n",
    "    text.textContent = item.value || '';\n",
    "    text.title = item.value || '';\n",
    "    meta.append(label, groupTag);\n",
    "    if (item.source === 'extra') {\n",
    "      // \u7c7b\u540d\u7528 `from` \u800c\u4e0d\u662f `src`\uff1a\u9762\u677f\u9876\u4e0a\u90a3\u4e2a `.src` \u662f AI \u5efa\u8bae\u5fbd\u6807\uff0c\u5b83\u7684\u57fa\u7840\u89c4\u5219\u662f\n",
    "      // `display:none`\uff08\u7b49 showPanel \u53bb\u70b9\u4eae\uff09\u3002\u540c\u540d\u7684\u8bdd\u8fd9\u6761\u6807\u7b7e\u4f1a\u88ab\u90a3\u6761\u89c4\u5219\u6309\u6389\uff0c\n",
    "      // \u800c\u4e14**\u6ca1\u6709\u4efb\u4f55\u62a5\u9519**\u2014\u2014\u53ea\u6709\u622a\u56fe\u770b\u5f97\u51fa\u6765\u3002\n",
    "      const from = document.createElement('span');\n",
    "      from.className = 'from';\n",
    "      from.textContent = '\u7f51\u7533\u8d44\u6599';\n",
    "      from.title = '\u8fd9\u6761\u6765\u81ea\u300c\u7f51\u7533\u8d44\u6599\u300d\uff0c\u4e0d\u5728\u7b80\u5386\u91cc';\n",
    "      meta.appendChild(from);\n",
    "    }\n",
    "    main.append(meta, text);\n",
    "    row.appendChild(main);\n",
    "    const go = document.createElement('button');\n",
    "    go.type = 'button';\n",
    "    go.className = 'go';\n",
    "    go.tabIndex = -1;\n",
    "    go.textContent = '\u586b\u5165';\n",
    "    const fill = (event) => {\n",
    "      event.preventDefault();\n",
    "      event.stopPropagation();\n",
    "      accept(item.label, item.value);\n",
    "    };\n",
    "    go.addEventListener('click', fill);\n",
    "    row.appendChild(go);\n",
    "    row.addEventListener('click', fill);\n",
    "    // \u952e\u76d8\uff1a\u6574\u884c\u53ef\u805a\u7126\uff0c\u56de\u8f66\u6216\u7a7a\u683c\u5c31\u662f\u300c\u586b\u5165\u300d\u3002\n",
    "    row.addEventListener('keydown', (event) => {\n",
    "      if (event.key === 'Enter' || event.key === ' ') { fill(event); }\n",
    "    });\n",
    "    return row;\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * \u300c\u53ef\u80fd\u662f\u8fd9\u51e0\u4e2a\u300d\uff1aPython \u4fa7\u6309**\u5f53\u524d\u8fd9\u4e2a\u6846**\u7684\u6587\u5b57\u4ece\u5b8c\u6574\u6e05\u5355\u91cc\u6311\u51fa\u7684\u524d\u51e0\u6761\u3002\n",
    "   *\n",
    "   * \u5224\u636e\u5728 `service.related_entries`\uff08\u590d\u7528 `evidence_key` \u4e0e\u540c\u4e00\u4efd\u540c\u4e49\u8bcd\u8868\uff0c\u4e0d\u5728\u524d\u7aef\n",
    "   * \u53e6\u5199\u4e00\u5957\u76f8\u4f3c\u5ea6\uff09\u3002\u8fd9\u4e00\u680f\u89e3\u51b3\u7684\u662f\u6700\u5b9e\u9645\u7684\u95ee\u9898\uff1a\u6e05\u5355\u51e0\u5341\u6761\u3001\u9762\u677f\u53ea\u9732\u5f97\u4e0b\u516b\u4e5d\u884c\uff0c\n",
    "   * \u800c\u7528\u6237\u6b64\u523b\u70b9\u5728\u54ea\u4e2a\u6846\u672c\u8eab\u5c31\u662f\u4e2a\u5f3a\u4fe1\u53f7\u3002\n",
    "   *\n",
    "   * **\u5b83\u4e0d\u66ff\u4ee3\u4e0b\u9762\u7684\u5b8c\u6574\u6e05\u5355**\u2014\u2014\u6ca1\u8fdb\u524d\u51e0\u540d\u7684\u6761\u76ee\u5168\u5728\u4e0b\u9762\uff0c\u4e00\u6761\u90fd\u6ca1\u5c11\u3002\u6240\u4ee5\u8fd9\u91cc\u7684\n",
    "   * \u6392\u5e8f\u5224\u9519\u4e00\u6761\uff0c\u4ee3\u4ef7\u53ea\u662f\"\u591a\u770b\u4e00\u773c\"\u3002\n",
    "   */\n",
    "  const renderRelated = (items) => {\n",
    "    elRelated.textContent = '';\n",
    "    const picked = Array.isArray(items) ? items : [];\n",
    "    // \u4e00\u6761\u90fd\u6ca1\u6311\u51fa\u6765\u5c31\u6574\u5757\u4e0d\u663e\u793a\uff1a\u90a3\u65f6\u9762\u677f\u770b\u8d77\u6765\u548c\u4ee5\u524d\u5b8c\u5168\u4e00\u6837\uff0c\u4e0d\u591a\u5360\u4e00\u884c\u3002\n",
    "    if (!picked.length) { elRelated.classList.remove('on'); return; }\n",
    "    const title = document.createElement('div');\n",
    "    title.className = 'rlt';\n",
    "    title.textContent = `\u53ef\u80fd\u662f\u8fd9\u51e0\u4e2a\uff08\u5171 ${picked.length} \u6761\uff0c\u5b8c\u6574\u6e05\u5355\u5728\u4e0b\u9762\uff09`;\n",
    "    elRelated.appendChild(title);\n",
    "    for (const item of picked) { elRelated.appendChild(makePickerRow(item)); }\n",
    "    elRelated.classList.add('on');\n",
    "  };\n",
    "  /**\n",
    "   * \u6309\u5206\u533a\u6e32\u67d3\u6e05\u5355\uff1b`keyword` \u4e3a\u7a7a\u65f6\u5168\u5217\u3002\n",
    "   *\n",
    "   * \u5206\u7ec4\u4e00\u591a\uff0c\"\u4e00\u8def\u5f80\u4e0b\u6eda\"\u5c31\u662f\u6700\u7cdf\u7684\u627e\u6cd5\u3002\u6240\u4ee5\u8fd9\u91cc\u7ed9\u4e09\u6837\u4e1c\u897f\uff1a\u9876\u90e8\u7684\u5206\u7ec4\u8df3\u8f6c\u6761\n",
    "   * \uff08\u4e00\u952e\u8df3\u8fc7\u53bb\uff0c\u5e26\u6761\u6570\uff09\u3001\u6bcf\u7ec4\u53ef\u6298\u53e0\u3001\u641c\u7d22\u65f6\u7ed9\u51fa\u547d\u4e2d\u6570\u3002\n",
    "   *\n",
    "   * \u6298\u53e0\u72b6\u6001\u8bb0\u5728 `collapsed` \u91cc**\u8de8\u91cd\u7ed8\u4fdd\u7559**\u2014\u2014\u5426\u5219\u6bcf\u6572\u4e00\u4e2a\u5b57\u90fd\u4f1a\u5168\u5c55\u5f00\uff0c\n",
    "   * \u7528\u6237\u521a\u6298\u597d\u7684\u7ec4\u767d\u6298\u4e86\u3002\n",
    "   */\n",
    "  const collapsed = new Set();\n",
    "  const autoExpanded = new Set();\n",
    "  let groupEls = new Map();\n",
    "  let groupRows = new Map();\n",
    "  let activeGroup = '';\n",
    "\n",
    "  // —— 「分组快速定位」那一层的状态 ——\n",
    "  // 家族 = 同类分组（「荣誉奖项 1/2/3」）。序号是后端拼上去的（`data.py` 与\n",
    "  // `repeated_profile.py` 都写 `名字 + ' ' + 序号`），所以「去掉结尾的 ` 数字`」就是\n",
    "  // 认出它们的办法。`familyEls` 只放**多成员**家族：单成员家族就是一张普通胶囊。\n",
    "  let familyEls = new Map();    // 家族名 -> .navfam\n",
    "  let navChipEls = new Map();   // 分组名 -> 代表这个分组的胶囊（成员胶囊，或单成员家族自己）\n",
    "  let activeFamily = '';\n",
    "  const openFamilies = new Set();  // 展开的家族：跨重绘保留（理由同 `collapsed`）\n",
    "  let navFold = null;           // null = 用户还没手动折过，按规模自动决定\n",
    "  let navFamilies = 0;\n",
    "  let navEntries = 0;\n",
    "  // 家族多到这个数就默认把整条折起来：跳转条本来就是\"分组多到找不到\"时的解药，\n",
    "  // 但它自己长到十几行时又变成了同一个病——折起来只占一行。\n",
    "  const NAV_FOLD_AT = 12;\n",
    "\n",
    "  const familyOf = (name) => String(name || '其他').replace(/\\s+\\d+$/, '') || '其他';\n",
    "  const kidLabel = (name, base) => String(name).slice(base.length).trim() || String(name);\n",
    "\n",
    "  const paintGroup = (name) => {\n",
    "    const fold = collapsed.has(name);\n",
    "    const head = groupEls.get(name);\n",
    "    if (head) { head.classList.toggle('fold', fold); }\n",
    "    for (const row of groupRows.get(name) || []) { row.classList.toggle('gofold', fold); }\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 活动的那一格可能滚在胶囊区自己的视野之外（那块有高度上限），把它挪进来。\n",
    "   * 不这么做的话\"你在哪\"这个提示对用户根本不可见。\n",
    "   */\n",
    "  const revealInNav = (node) => {\n",
    "    if (!node || elNav.classList.contains('fold')) { return; }\n",
    "    const box = node.getBoundingClientRect();\n",
    "    const view = elNavBody.getBoundingClientRect();\n",
    "    if (!box.height || !view.height) { return; }\n",
    "    const pad = 6;\n",
    "    if (box.top < view.top + pad) { elNavBody.scrollTop -= (view.top + pad - box.top); }\n",
    "    else if (box.bottom > view.bottom - pad) { elNavBody.scrollTop += (box.bottom - view.bottom + pad); }\n",
    "  };\n",
    "\n",
    "  // 只涂 class、**不重建 DOM**：它会跟着滚动反复触发（每滚过一个分组就重算一次）。\n",
    "  const paintNav = () => {\n",
    "    for (const [base, node] of familyEls) {\n",
    "      node.classList.toggle('open', openFamilies.has(base));\n",
    "      node.classList.toggle('active', base === activeFamily);\n",
    "    }\n",
    "    for (const [name, chip] of navChipEls) { chip.classList.toggle('on', name === activeGroup); }\n",
    "    // 活动分组的成员胶囊只在家族展开时才可见，那时改盯家族本身。\n",
    "    const chip = navChipEls.get(activeGroup);\n",
    "    revealInNav((chip && chip.getBoundingClientRect().height) ? chip : familyEls.get(activeFamily));\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 记下\"现在活动的是哪个分组\"并刷新胶囊的涂色。\n",
    "   *\n",
    "   * **这里刻意不自动展开家族**：展开会改变胶囊区（它挂在 sticky 的搜索块里）的高度，\n",
    "   * 于是资料整体上下平移，而\"当前分组\"正是按位置算出来的——两个方向互相追着跑，\n",
    "   * 在家族交界处会来回闪。展开只由用户点（点家族胶囊），位置计算因此是单向的。\n",
    "   */\n",
    "  const setActiveGroup = (name) => {\n",
    "    activeGroup = name || '';\n",
    "    activeFamily = activeGroup ? familyOf(activeGroup) : '';\n",
    "    paintNav();\n",
    "  };\n",
    "\n",
    "  const syncActiveGroup = () => {\n",
    "    if (elNav.style.display === 'none' || !groupEls.size) {\n",
    "      setActiveGroup('');\n",
    "      return;\n",
    "    }\n",
    "    const pickTop = elPick.getBoundingClientRect().top;\n",
    "    const anchor = pickTop + elSearchBox.offsetHeight + 8;\n",
    "    let candidate = '';\n",
    "    let bestTop = -Infinity;\n",
    "    for (const [name, head] of groupEls) {\n",
    "      const top = head.getBoundingClientRect().top;\n",
    "      if (top <= anchor && top > bestTop) {\n",
    "        candidate = name;\n",
    "        bestTop = top;\n",
    "      }\n",
    "    }\n",
    "    if (!candidate) { candidate = groupEls.keys().next().value || ''; }\n",
    "    setActiveGroup(candidate);\n",
    "  };\n",
    "\n",
    "  const TONE_PALETTE = [\n",
    "    { border: '#c9dbe9', bg: '#f4f8fb', text: '#2e6da4', accent: '#7fa7ca' },\n",
    "    { border: '#c9ddd7', bg: '#f4f9f7', text: '#3d7668', accent: '#78a996' },\n",
    "    { border: '#d4cfe4', bg: '#f8f7fb', text: '#64598e', accent: '#968bc4' },\n",
    "    { border: '#dfd2bc', bg: '#fbf9f4', text: '#8b6e3f', accent: '#b59a6e' },\n",
    "    { border: '#dfcbd1', bg: '#fbf8f9', text: '#945d6b', accent: '#b98b99' },\n",
    "    { border: '#c8dadd', bg: '#f4f9fa', text: '#3d747d', accent: '#77aab1' },\n",
    "    { border: '#d0dbea', bg: '#f6f8fb', text: '#526b91', accent: '#8da7ca' },\n",
    "    { border: '#ddd4b9', bg: '#fbfaf4', text: '#806c3c', accent: '#b6a16f' },\n",
    "    { border: '#cddfc9', bg: '#f5faf4', text: '#4f7c4b', accent: '#83ae7c' },\n",
    "    { border: '#dfccdc', bg: '#fbf7fb', text: '#865f80', accent: '#b08caf' },\n",
    "    { border: '#c9dedb', bg: '#f5faf9', text: '#3e7771', accent: '#7eaca6' },\n",
    "    { border: '#e0cec6', bg: '#fbf8f6', text: '#875e50', accent: '#b78d7d' },\n",
    "  ];\n",
    "  const toneStyle = (tone) => {\n",
    "    const index = Math.max(0, Number(tone) || 0);\n",
    "    if (index < TONE_PALETTE.length) { return TONE_PALETTE[index]; }\n",
    "    const hue = Math.round((index * 137.508 + 17) % 360);\n",
    "    return { border: 'hsl(' + hue + ' 34% 78%)', bg: 'hsl(' + hue + ' 35% 97%)', text: 'hsl(' + hue + ' 32% 36%)', accent: 'hsl(' + hue + ' 38% 62%)' };\n",
    "  };\n",
    "  const applyTone = (element, tone) => {\n",
    "    const style = toneStyle(tone);\n",
    "    element.dataset.tone = String(tone);\n",
    "    element.style.setProperty('--chip-border', style.border);\n",
    "    element.style.setProperty('--chip-bg', style.bg);\n",
    "    element.style.setProperty('--chip-text', style.text);\n",
    "    element.style.setProperty('--chip-accent', style.accent || style.border);\n",
    "    element.style.setProperty('--grp-border', style.border);\n",
    "    element.style.setProperty('--grp-bg', style.bg);\n",
    "    element.style.setProperty('--grp-text', style.text);\n",
    "    element.style.setProperty('--grp-accent', style.accent || style.border);\n",
    "    element.style.setProperty('--row-border', style.border);\n",
    "    element.style.setProperty('--row-bg', style.bg);\n",
    "    element.style.setProperty('--row-text', style.text);\n",
    "    element.style.setProperty('--row-accent', style.accent || style.border);\n",
    "  };\n",
    "  const buildGroupTones = () => {\n",
    "    const counts = new Map();\n",
    "    const order = [];\n",
    "    for (const item of catalog()) {\n",
    "      const name = String(item.group || '\u5176\u4ed6');\n",
    "      if (!counts.has(name)) { order.push(name); counts.set(name, 0); }\n",
    "      counts.set(name, counts.get(name) + 1);\n",
    "    }\n",
    "    const tones = new Map();\n",
    "    let nextTone = 1;\n",
    "    for (const name of order) {\n",
    "      tones.set(name, counts.get(name) > 1 ? String(nextTone++) : '0');\n",
    "    }\n",
    "    return tones;\n",
    "  };\n",
    "  const groupTone = (name, tones = buildGroupTones()) => tones.get(String(name || '\u5176\u4ed6')) || '0';\n",
    "\n",
    "  const jumpTo = (name) => {\n",
    "    const head = groupEls.get(name);\n",
    "    if (!head) { return; }\n",
    "    // \u8df3\u8fc7\u53bb\u5f53\u7136\u8981\u770b\u5f97\u89c1\u5185\u5bb9\uff1a\u6298\u7740\u7684\u5148\u5c55\u5f00\u3002**\u5c55\u5f00\u4f1a\u6539\u53d8\u9ad8\u5ea6**\uff0c\u6240\u4ee5\u8981\u5728\u7b97\u6eda\u4f4d\u4e4b\u524d\u505a\u3002\n",
    "    if (collapsed.has(name)) { collapsed.delete(name); paintGroup(name); }\n",
    "    // \u6eda\u4f4d\u6309**\u89c6\u53e3\u5185\u7684\u76f8\u5bf9\u4f4d\u79fb**\u7b97\uff1a`scrollTop += (\u7ec4\u5934 \u2212 \u5bb9\u5668\u9876) \u2212 sticky \u9ad8\u5ea6`\uff0c\n",
    "    // \u8ba9\u7ec4\u5934\u6b63\u597d\u843d\u5728\u641c\u7d22\u6846\u4e0b\u6cbf\u3002\n",
    "    //\n",
    "    // **\u4e0d\u8981\u7528 `scrollIntoView` \u518d\u8865\u4e00\u6b21\u51cf\u6cd5**\u2014\u2014\u90a3\u662f\u539f\u6765\u5199\u6cd5\uff0c\u5b83\u6709\u4e24\u5904\u4e0d\u5bf9\uff1a\n",
    "    // 1) \u5bf9\u9f50\u4e4b\u540e\u51cf sticky \u9ad8\u5ea6\uff0c\u5728**\u9760\u540e\u7684\u5206\u7ec4**\u4e0a\u4f1a\u628a\u5df2\u7ecf\u5939\u5230\u6700\u5927\u503c\u7684\u6eda\u4f4d\u5f80\u56de\u632a\uff0c\n",
    "    //    \u90a3\u4e00\u7ec4\u53cd\u800c\u88ab\u63a8\u5230\u53ef\u89c6\u533a\u4e0b\u65b9\uff08\u7528\u6237\u62a5\u7684\u300c\u70b9\u4e86\u6ca1\u8df3\u5230\u76f8\u5173\u9879\u91cc\u300d\u5c31\u662f\u8fd9\u4e2a\uff0c\u5b9e\u6d4b\u70b9\n",
    "    //    \u300c\u5206\u7ec413\u300d\u505c\u5728\u8ddd\u9876 530px\u3001\u5bb9\u5668\u624d 560px\uff0c\u7ec4\u5934\u4e0b\u9762\u7684\u6761\u76ee\u5168\u5728\u6298\u53e0\u7ebf\u4ee5\u4e0b\uff09\uff1b\n",
    "    // 2) `scrollIntoView` \u8fd8\u80fd\u6eda\u5230**\u6839\u6eda\u52a8\u5bb9\u5668**\u4e0a\u53bb\uff0c\u800c\u4e0d\u53ea\u662f\u8fd9\u4e2a\u9762\u677f\u3002\n",
    "    // \u73b0\u5728\u8fd9\u4e2a\u5199\u6cd5\u53ea\u6539 `.pick` \u7684 scrollTop\uff0c\u8d85\u51fa\u8303\u56f4\u7531\u6d4f\u89c8\u5668\u81ea\u5df1\u5939\u4f4f\u2014\u2014\u5939\u4f4f\u4e4b\u540e\n",
    "    // \u90a3\u4e00\u7ec4\u8d34\u5728\u80fd\u5230\u7684\u6700\u9ad8\u5904\uff0c\u81f3\u5c11\u662f\u770b\u5f97\u89c1\u7684\u3002\n",
    "    const offset = head.getBoundingClientRect().top\n",
    "      - elPick.getBoundingClientRect().top\n",
    "      - elSearchBox.offsetHeight\n",
    "      - 2;\n",
    "    const maxTop = Math.max(0, elPick.scrollHeight - elPick.clientHeight);\n",
    "    elPick.scrollTop = Math.max(0, Math.min(maxTop, elPick.scrollTop + offset));\n",
    "    setActiveGroup(name);\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 一张跳转胶囊。**名字与条数分成两个元素**：拼在一起（「专业技能 1」+「2」）会被读成\n",
    "   * 「专业技能12」，而分组名以数字结尾是常态（「专业技能 1」「教育经历 1」）。\n",
    "   *\n",
    "   * `groupName` 为空 = 家族胶囊（它代表若干分组，自己不跳转，点击展开成员）。\n",
    "   */\n",
    "  const makeNavChip = (label, count, tone, groupName) => {\n",
    "    const chip = document.createElement('button');\n",
    "    chip.type = 'button';\n",
    "    chip.className = 'navchip';\n",
    "    applyTone(chip, tone);\n",
    "    const name = document.createElement('span');\n",
    "    name.className = 'nm';\n",
    "    name.textContent = label;\n",
    "    const num = document.createElement('span');\n",
    "    num.className = 'c';\n",
    "    num.textContent = String(count);\n",
    "    chip.append(name, num);\n",
    "    if (groupName) {\n",
    "      chip.dataset.group = groupName;\n",
    "      chip.title = `跳到「${groupName}」（${count} 条）`;\n",
    "      chip.addEventListener('click', (event) => {\n",
    "        event.preventDefault();\n",
    "        event.stopPropagation();\n",
    "        jumpTo(groupName);\n",
    "      });\n",
    "    }\n",
    "    return chip;\n",
    "  };\n",
    "\n",
    "  const toggleFamily = (base) => {\n",
    "    const wrap = familyEls.get(base);\n",
    "    if (!wrap) { return; }\n",
    "    const open = !openFamilies.has(base);\n",
    "    if (open) { openFamilies.add(base); } else { openFamilies.delete(base); }\n",
    "    wrap.querySelector('.navchip').setAttribute('aria-expanded', String(open));\n",
    "    paintNav();\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 折叠头的状态与文案。**默认看规模**：家族少（跳转条本来就矮）就摊开，多就折起来——\n",
    "   * 跳转条本是\"分组多到找不到\"的解药，可它自己长到十几行时又变成同一个病。\n",
    "   * 用户点过之后一律以他的选择为准（`navFold`）。\n",
    "   */\n",
    "  const applyNavFold = () => {\n",
    "    const folded = navFold === null ? navFamilies > NAV_FOLD_AT : navFold;\n",
    "    elNav.classList.toggle('fold', folded);\n",
    "    elNavHead.setAttribute('aria-expanded', String(!folded));\n",
    "    elNavHead.title = folded ? '点开快速跳转到某个分组' : '收起分组跳转条';\n",
    "    elNavSum.textContent = `${navFamilies} 组 · ${navEntries} 条`;\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 胶囊区的高度上限**从资料区的可见高度里倒推**，而不是按比例切一刀。\n",
    "   *\n",
    "   * 判据是\"资料区至少还剩多少\"：矮窗口里留一半，正常窗口里不少于 150px。这样\n",
    "   * 一个偏矮的窗口（实测 484px 高）里跳转条最多占掉一半，下面一定还看得见资料——\n",
    "   * 用户报的\"完全被挡住\"就是这条约束缺失时发生的事。折叠头与搜索框是**减掉**的：\n",
    "   * 它们是固定开销，不算进胶囊区的预算。\n",
    "   */\n",
    "  const measureNavLimit = () => {\n",
    "    const pickH = elPick.clientHeight || 0;\n",
    "    const chromeH = Math.max(0, elSearchBox.offsetHeight - elNavBody.offsetHeight);\n",
    "    const reserve = Math.max(150, Math.round(pickH * 0.5));\n",
    "    const limit = Math.min(132, Math.max(46, pickH - reserve - chromeH));\n",
    "    elPick.style.setProperty('--rf-navmax', (pickH ? limit : 70) + 'px');\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * 画「分组快速定位」：**按家族聚类**，并把折叠头刷成当前规模的样子。\n",
    "   *\n",
    "   * 单成员家族仍是一张普通胶囊（和以前一模一样，就是它自己）；多成员的聚成一块：\n",
    "   * 家族胶囊管展开、成员胶囊管跳转。折叠语义与列表里的 `.grp` 分组标题一致。\n",
    "   */\n",
    "  const renderNav = (groups, toneByGroup) => {\n",
    "    elNavBody.textContent = '';\n",
    "    familyEls = new Map();\n",
    "    navChipEls = new Map();\n",
    "    const families = new Map();\n",
    "    for (const [name, items] of groups) {\n",
    "      const base = familyOf(name);\n",
    "      if (!families.has(base)) { families.set(base, []); }\n",
    "      families.get(base).push({ name: name, count: items.length });\n",
    "    }\n",
    "    navFamilies = families.size;\n",
    "    navEntries = 0;\n",
    "    for (const members of families.values()) {\n",
    "      for (const member of members) { navEntries += member.count; }\n",
    "    }\n",
    "    for (const [base, members] of families) {\n",
    "      const total = members.reduce((sum, member) => sum + member.count, 0);\n",
    "      if (members.length === 1) {\n",
    "        const chip = makeNavChip(members[0].name, total, groupTone(members[0].name, toneByGroup), members[0].name);\n",
    "        navChipEls.set(members[0].name, chip);\n",
    "        elNavBody.appendChild(chip);\n",
    "        continue;\n",
    "      }\n",
    "      const wrap = document.createElement('div');\n",
    "      wrap.className = 'navfam';\n",
    "      wrap.dataset.family = base;\n",
    "      const head = makeNavChip(base, total, groupTone(members[0].name, toneByGroup));\n",
    "      head.dataset.family = base;\n",
    "      head.setAttribute('aria-expanded', String(openFamilies.has(base)));\n",
    "      head.title = `「${base}」共 ${members.length} 组、${total} 条，点击展开每一组`;\n",
    "      const caret = document.createElement('span');\n",
    "      caret.className = 'caret';\n",
    "      caret.textContent = '\\u25be';\n",
    "      head.appendChild(caret);\n",
    "      const kids = document.createElement('div');\n",
    "      kids.className = 'navkids';\n",
    "      for (const member of members) {\n",
    "        const kid = makeNavChip(kidLabel(member.name, base), member.count, groupTone(member.name, toneByGroup), member.name);\n",
    "        kid.classList.add('kid');\n",
    "        kids.appendChild(kid);\n",
    "        navChipEls.set(member.name, kid);\n",
    "      }\n",
    "      head.addEventListener('click', (event) => {\n",
    "        event.preventDefault();\n",
    "        event.stopPropagation();\n",
    "        toggleFamily(base);\n",
    "      });\n",
    "      wrap.append(head, kids);\n",
    "      familyEls.set(base, wrap);\n",
    "      elNavBody.appendChild(wrap);\n",
    "    }\n",
    "    applyNavFold();\n",
    "    paintNav();\n",
    "  };\n",
    "\n",
    "  const renderList = (keyword) => {\n",
    "    const raw = (keyword || '').trim();\n",
    "    const needle = raw.toLowerCase();\n",
    "    if (!needle && autoExpanded.size) {\n",
    "      for (const name of autoExpanded) { collapsed.add(name); }\n",
    "      autoExpanded.clear();\n",
    "    }\n",
    "    const fuzzy = (text) => { let cursor = 0; for (const char of text) { if (char === needle[cursor]) { cursor += 1; if (cursor === needle.length) return true; } } return false; };\n",
    "    const items = catalog().filter((item) => {\n",
    "      if (!needle) { return true; }\n",
    "      const searchable = [item.label, item.value, item.group].map((part) => String(part || '').toLowerCase());\n",
    "      return searchable.some((text) => text.includes(needle) || fuzzy(text));\n",
    "    });\n",
    "\n",
    "    // \u547d\u4e2d\u6570\u8981\u8bf4\u5f97\u51fa\u6765\uff1a\"\u4e00\u6761\u90fd\u6ca1\u6709\"\u548c\"\u8fd8\u6709\u51e0\u5341\u6761\"\u662f\u4e24\u79cd\u5b8c\u5168\u4e0d\u540c\u7684\u5904\u5883\u3002\n",
    "    elHits.textContent = needle ? (items.length ? `\u547d\u4e2d ${items.length} \u6761` : '\u6ca1\u6709\u5339\u914d\u7684\u8d44\u6599') : '';\n",
    "\n",
    "    // **\u7528 Map \u6536\u62e2\uff0c\u800c\u4e0d\u662f\"\u6bd4\u8f83\u76f8\u90bb\u9879\"**\uff1a\u641c\u7d22\u4f1a\u628a\u540c\u4e00\u7ec4\u7684\u9879\u6253\u6563\uff0c\n",
    "    // \u76f8\u90bb\u6bd4\u8f83\u4f1a\u753b\u51fa\u4e24\u4e2a\u540c\u540d\u7684\u7ec4\u5934\u3002\n",
    "    const groups = new Map();\n",
    "    for (const item of items) {\n",
    "      const name = String(item.group || '\u5176\u4ed6');\n",
    "      if (!groups.has(name)) { groups.set(name, []); }\n",
    "      groups.get(name).push(item);\n",
    "    }\n",
    "    if (needle) {\n",
    "      for (const name of groups.keys()) {\n",
    "        if (collapsed.has(name)) { autoExpanded.add(name); collapsed.delete(name); }\n",
    "      }\n",
    "    }\n",
    "\n",
    "    elNavBody.textContent = '';\n",
    "    elList.textContent = '';\n",
    "    groupEls = new Map();\n",
    "    groupRows = new Map();\n",
    "    familyEls = new Map();\n",
    "    navChipEls = new Map();\n",
    "\n",
    "    if (!items.length) {\n",
    "      const empty = document.createElement('div');\n",
    "      empty.className = 'empty';\n",
    "      empty.textContent = needle\n",
    "        ? `\u6ca1\u6709\u5339\u914d\u300c${raw}\u300d\u7684\u8d44\u6599\u3002\u6362\u4e2a\u8bcd\uff0c\u6216\u8005\u6e05\u7a7a\u641c\u7d22\u770b\u5168\u90e8\u3002`\n",
    "        : '\u8d44\u6599\u8fd8\u662f\u7a7a\u7684\uff0c\u5148\u53bb\u300c\u6211\u7684\u8d44\u6599\u300d\u586b\u4e00\u4e9b';\n",
    "      elList.appendChild(empty);\n",
    "      // \u4e00\u6761\u90fd\u6ca1\u6709\u65f6\u8df3\u8f6c\u6761**\u6574\u5757\u6536\u6389**\uff1a\u7559\u7740\u53ea\u5269\u4e00\u4e2a\"0 \u7ec4 \u00b7 0 \u6761\"\u7684\u7a7a\u58f3\u3002\n",
    "      elNav.style.display = 'none';\n",
    "      setActiveGroup('');\n",
    "      return;\n",
    "    }\n",
    "\n",
    "    // \u53ea\u5728**\u771f\u9700\u8981\u8df3**\u7684\u65f6\u5019\u7ed9\u8df3\u8f6c\u6761\uff1a\u6574\u5c4f\u5c31\u4e00\u4e2a\u5206\u7ec4\u65f6\u5b83\u662f\u7eaf\u5360\u4f4d\uff0c\u8fd8\u5360\u6389\u4e00\u884c\u9ad8\u5ea6\u3002\n",
    "    const showNav = !needle && groups.size > 1;\n",
    "    elNav.style.display = showNav ? 'flex' : 'none';\n",
    "    if (!showNav) { setActiveGroup(''); }\n",
    "    const toneByGroup = buildGroupTones();\n",
    "    if (showNav) { renderNav(groups, toneByGroup); }\n",
    "\n",
    "    for (const [name, groupItems] of groups) {\n",
    "      const head = document.createElement('div');\n",
    "      head.className = 'grp';\n",
    "      applyTone(head, groupTone(name, toneByGroup));\n",
    "      head.tabIndex = 0;\n",
    "      head.setAttribute('role', 'button');\n",
    "      head.title = `\u300c${name}\u300d\u5171 ${groupItems.length} \u6761\uff0c\u70b9\u51fb\u6298\u53e0\u6216\u5c55\u5f00`;\n",
    "      const caret = document.createElement('span');\n",
    "      caret.className = 'caret';\n",
    "      caret.textContent = '\\u25be';\n",
    "      const gtitle = document.createElement('span');\n",
    "      gtitle.className = 'gt';\n",
    "      gtitle.textContent = name;\n",
    "      const gcount = document.createElement('span');\n",
    "      gcount.className = 'gc';\n",
    "      gcount.textContent = `${groupItems.length} \u6761`;\n",
    "      head.appendChild(caret);\n",
    "      head.appendChild(gtitle);\n",
    "      head.appendChild(gcount);\n",
    "      const toggle = () => {\n",
    "        autoExpanded.delete(name);\n",
    "        if (collapsed.has(name)) { collapsed.delete(name); } else { collapsed.add(name); }\n",
    "        paintGroup(name);\n",
    "        syncActiveGroup();\n",
    "      };\n",
    "      head.addEventListener('click', (event) => { event.preventDefault(); event.stopPropagation(); toggle(); });\n",
    "      head.addEventListener('keydown', (event) => {\n",
    "        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); toggle(); }\n",
    "      });\n",
    "      elList.appendChild(head);\n",
    "      groupEls.set(name, head);\n",
    "\n",
    "      const rows = [];\n",
    "      for (const item of groupItems) {\n",
    "        const row = makePickerRow(item, toneByGroup);\n",
    "        rows.push(row);\n",
    "        elList.appendChild(row);\n",
    "      }\n",
    "      // 这一组的行要记下来，`paintGroup` 靠它折叠/展开。掉了这一行折叠就哑了。\n",
    "      groupRows.set(name, rows);\n",
    "      paintGroup(name);\n",
    "    }\n",
    "    // \u8df3\u8f6c\u6761\u7684\u9ad8\u5ea6\u4e0a\u9650\u8ddf\u7740\u8d44\u6599\u533a\u7684\u53ef\u89c1\u9ad8\u5ea6\u8d70\uff08\u5199\u6b7b\u7684 22vh \u5728\u77ee\u7a97\u53e3\u91cc\u4ecd\u7136\u504f\u5927\uff09\u3002\n",
    "    measureNavLimit();\n",
    "    syncActiveGroup();\n",
    "  };\n",
    "\n",
    "  /**\n",
    "   * \u6e32\u67d3\"\u5176\u4ed6\u53ef\u80fd\u7684\u5b57\u6bb5\"\uff08\u53ea\u6709 AI \u62ff\u4e0d\u51c6\u65f6\u624d\u6709\uff09\u3002\n",
    "   *\n",
    "   * **\u6bcf\u4e00\u6761\u81ea\u5e26\u300c\u586b\u5165\u300d\u6309\u94ae**\uff0c\u5c31\u5728\u8f93\u5165\u6846\u65c1\u8fb9\u2014\u2014\u7528\u6237\u4e0d\u7528\u5148\u60f3\"\u5230\u5e95\u662f\u54ea\u4e2a\"\u518d\u53bb\u6e05\u5355\u91cc\u7ffb\uff0c\n",
    "   * \u770b\u7740\u50cf\u54ea\u6761\u70b9\u54ea\u6761\u3002\u70b9\u4e2d\u54ea\u6761\u90fd\u8d70\u540c\u4e00\u4e2a `accept`\uff0c\u5199\u5165\u8def\u5f84\u4e00\u884c\u6ca1\u53d8\u3002\n",
    "   */\n",
    "  const renderAlternatives = (items) => {\n",
    "    const list = Array.isArray(items) ? items : [];\n",
    "    elAlts.textContent = '';\n",
    "    elAlts.classList.toggle('on', list.length > 0);\n",
    "    for (const item of list) {\n",
    "      const row = document.createElement('div');\n",
    "      row.className = 'alt';\n",
    "      const label = document.createElement('span');\n",
    "      label.className = 'al';\n",
    "      label.textContent = item.label || '';\n",
    "      const value = document.createElement('span');\n",
    "      value.className = 'av';\n",
    "      value.textContent = item.value || '';\n",
    "      const button = document.createElement('button');\n",
    "      button.type = 'button';\n",
    "      button.className = 'ghost';\n",
    "      button.textContent = '\u586b\u5165';\n",
    "      button.addEventListener('click', (event) => {\n",
    "        event.preventDefault();\n",
    "        event.stopPropagation();\n",
    "        button.disabled = true;\n",
    "        accept(item.label || '', item.value || '');\n",
    "      });\n",
    "      row.title = `${item.label || ''}\uff1a${item.value || ''}`;\n",
    "      row.appendChild(label);\n",
    "      row.appendChild(value);\n",
    "      row.appendChild(button);\n",
    "      elAlts.appendChild(row);\n",
    "    }\n",
    "  };\n",
    "\n",
    "  const setExpanded = (next) => {\n",
    "    expanded = next;\n",
    "    elPick.classList.toggle('on', expanded);\n",
    "    elMore.textContent = expanded ? '\u6536\u8d77' : '\u6362\u4e2a\u8d44\u6599\u2026';\n",
    "    if (expanded) {\n",
    "      elSearch.value = '';\n",
    "      renderList('');\n",
    "      position();\n",
    "      // \u5c55\u5f00\u5c31\u805a\u7126\u641c\u7d22\u6846\u2014\u2014\u7528\u6237\u70b9\u4e86\u300c\u6362\u4e00\u4e2a\u300d\u591a\u534a\u662f\u60f3\u641c\uff0c\u4e0d\u7136\u5c31\u662f\u60f3\u7ffb\u3002\n",
    "      window.setTimeout(() => elSearch.focus(), 0);\n",
    "    } else {\n",
    "      position();\n",
    "    }\n",
    "  };\n",
    "\n",
    "  const onFocus = (event) => {\n",
    "    // **\u9762\u677f\u81ea\u5df1\u7684\u7126\u70b9\u4e8b\u4ef6\u8981\u5ffd\u7565\u6389**\u3002\u4e8b\u4ef6\u4ece shadow DOM \u91cc\u51fa\u6765\u65f6\uff0c`event.target` \u4f1a\u88ab\n",
    "    // \u91cd\u5b9a\u5411\u6210\u5bbf\u4e3b\u5143\u7d20\u2014\u2014\u4e0d\u62e6\u7684\u8bdd\uff0c\u7528\u6237\u4e00\u70b9\u641c\u7d22\u6846\uff0c\u6211\u4eec\u5c31\u628a\u90a3\u4e2a div \u5f53\u6210\u4e86\"\u4ed6\u805a\u7126\u7684\u63a7\u4ef6\"\uff1a\n",
    "    // \u9875\u9762\u8f93\u5165\u6846\u7684\u6807\u8bb0\u88ab\u6e05\u6389\u3001\u5199\u5165\u6807\u8bb0\u6253\u5728\u4e86 div \u4e0a\uff0c\u6700\u540e\u5bf9\u7740 `<div>` \u8c03\n",
    "    // `HTMLInputElement` \u7684 setter\uff0c\u629b Illegal invocation\u3002\u5b9e\u6d4b\u5230\u7684\"\u6311\u4e86\u4e00\u6761\u8d44\u6599\u5374\u5199\u5165\u5931\u8d25\"\n",
    "    // \u5c31\u662f\u8fd9\u6761\u94fe\u3002\n",
    "    if (event.composedPath && event.composedPath().includes(host)) { return; }\n",
    "    const el = event.target;\n",
    "    if (!el || !el.tagName || el === host) { return; }\n",
    "    const type = controlType(el);\n",
    "    const allowed = ['text', 'textarea', 'richtext', 'date', 'month', 'email', 'tel', 'number'];\n",
    "    if (!allowed.includes(type)) {\n",
    "      // 单选、复选、下拉、附件：**不给面板，而且要把上一条收掉**。\n",
    "      //\n",
    "      // 只 `return` 是不够的——面板是上一次渲染留下来的，不收就会挂在屏幕上：\n",
    "      // 用户点着单选框，眼前却是\"将填入：姓名=张三\"，看起来就像程序要替他勾选。\n",
    "      hide();\n",
    "      // 序号也要动：Python 侧靠它判断\"换了框\"，不动的话它那份状态同样是旧的，\n",
    "      // ResumeForge 页面上会继续挂着上一条。\n",
    "      window.__rfFocusSeq = (window.__rfFocusSeq || 0) + 1;\n",
    "      return;\n",
    "    }\n",
    "    document.querySelectorAll('[data-rf-focus]').forEach((other) => {\n",
    "      other.removeAttribute('data-rf-focus');\n",
    "    });\n",
    "    el.setAttribute('data-rf-focus', '1');\n",
    "    focused = el;\n",
    "    // \u63cf\u8ff0\u4ea4\u7ed9 Python \u4fa7\u53bb\u5339\u914d\u2014\u2014**\u540c\u4e49\u8bcd\u8868\u53ea\u6709\u4e00\u4efd\uff0c\u5728 Python \u91cc**\u3002\n",
    "    // \u5e8f\u53f7\u8ba9 Python \u4fa7\u4e0d\u5fc5\u6bcf\u8f6e\u90fd\u505a\u6df1\u5ea6\u6bd4\u8f83\uff0c\u4e5f\u80fd\u533a\u5206\"\u53c8\u70b9\u4e86\u540c\u4e00\u4e2a\u6846\"\u3002\n",
    "    userInputValue = '';\n",
    "    window.__rfFocusSeq = (window.__rfFocusSeq || 0) + 1;\n",
    "    currentElement = el;\n",
    "    currentDescription = describeControl(el, 0, '[data-rf-focus=\"1\"]');\n",
    "    window.__rfFocus = currentDescription;\n",
    "    window.__rfAccept = null;\n",
    "    // 换了框就把\"记住这条\"也清掉——否则用户先点了记住、又没等 Python 取走就点到下一个框，\n",
    "    // 那条记忆会挂在新框上（值属于旧框，标签属于新框）。与 `__rfAccept` 同一条理由。\n",
    "    window.__rfRemember = null;\n",
    "    window.__rfShowPanel({ status: 'thinking' });\n",
    "  };\n",
    "\n",
    "  const inputValue = (el) => el && el.getAttribute('contenteditable') === 'true' ? String(el.textContent || '') : String(el && el.value == null ? '' : (el ? el.value : ''));\n",
    "  const onInput = (event) => {\n",
    "    if (event && event.composedPath && event.composedPath().includes(host)) { return; }\n",
    "    const el = event.target;\n",
    "    if (!currentElement || el !== currentElement) { return; }\n",
    "    userInputValue = inputValue(el);\n",
    "    currentDescription = describeControl(el, 0, '[data-rf-focus=\"1\"]');\n",
    "    window.__rfFocus = currentDescription;\n",
    "  };\n",
    "\n",
    "  const onFocusOut = (event) => {\n",
    "    if (event && event.composedPath && event.composedPath().includes(host)) { return; }\n",
    "    // \u7126\u70b9\u8dd1\u5230\u9762\u677f\u91cc\uff08\u641c\u7d22\u6846\u3001\u8d44\u6599\u884c\uff09\u65f6\u4e0d\u8981\u6536\u8d77\u2014\u2014\u5426\u5219\u70b9\u4e0d\u5230\u3002\n",
    "    window.setTimeout(() => {\n",
    "      if (!focused) { return; }\n",
    "      if (interacting) { return; }\n",
    "      const target = document.activeElement;\n",
    "      if (focused === target || (target && host.contains(target))) { return; }\n",
    "      hide();\n",
    "    }, 120);\n",
    "  };\n",
    "\n",
    "  // \u9f20\u6807\u4e00\u6309\u5230\u9762\u677f\u4e0a\u5c31\u6807\u4f4f\uff0c\u677e\u624b\u540e\u518d\u653e\u5f00\u2014\u2014\u4e2d\u95f4\u90a3\u6b21 focusout \u4e0d\u8be5\u628a\u9762\u677f\u6536\u8d70\u3002\n",
    "  host.addEventListener('mousedown', () => { interacting = true; }, true);\n",
    "  window.addEventListener('mouseup', () => {\n",
    "    window.setTimeout(() => { interacting = false; }, 0);\n",
    "  }, true);\n",
    "\n",
    "  document.addEventListener('focusin', onFocus, true);\n",
    "  document.addEventListener('input', onInput, true);\n",
    "  document.addEventListener('change', onInput, true);\n",
    "  document.addEventListener('focusout', onFocusOut, true);\n",
    "  elPick.addEventListener('scroll', syncActiveGroup, { passive: true });\n",
    "  window.addEventListener('scroll', position, true);\n",
    "  // 窗口一变，资料区的高度就变了——跳转条的上限跟着重算（它与资料区按比例分）。\n",
    "  const onResize = () => { position(); measureNavLimit(); };\n",
    "  window.addEventListener('resize', onResize, true);\n",
    "  // 折叠头：整条都是按钮。折起来之后胶囊区不再参与布局，sticky 的搜索块于是只剩一行，\n",
    "  // 资料区无论如何都有地方——这就是\"分组再多也盖不住下面的资料\"的那道闸。\n",
    "  elNavHead.addEventListener('click', (event) => {\n",
    "    event.preventDefault();\n",
    "    event.stopPropagation();\n",
    "    navFold = !elNav.classList.contains('fold');\n",
    "    applyNavFold();\n",
    "    // 刚摊开时把\"我在哪一族\"重新对一次：折着的时候胶囊区不参与布局，位置全变了。\n",
    "    if (!navFold) { syncActiveGroup(); }\n",
    "  });\n",
    "\n",
    "  function hide() {\n",
    "    panel.style.display = 'none';\n",
    "    focused = null;\n",
    "    window.__rfFocus = null;\n",
    "    currentDescription = null;\n",
    "    currentElement = null;\n",
    "    userInputValue = '';\n",
    "  }\n",
    "\n",
    "  function accept(label, value) {\n",
    "    // **\u53ea\u628a\"\u7528\u6237\u9009\u4e86\u54ea\u4e00\u6761\"\u8bb0\u4e0b\u6765**\uff1b\u771f\u6b63\u7684\u5199\u5165\u7531 Python \u4fa7\u7528\u540c\u4e00\u5957\u54d1\u6267\u884c\u5668\u505a\uff0c\n",
    "    // \u8fd9\u6837\u5199\u5165\u3001\u56de\u8bfb\u6821\u9a8c\u3001\u5931\u8d25\u4e0a\u62a5\u90fd\u53ea\u6709\u4e00\u4efd\u5b9e\u73b0\u3002\n",
    "    //\n",
    "    // \u63a7\u4ef6\u63cf\u8ff0**\u968f\u9009\u62e9\u4e00\u8d77\u5e26\u4e0a**\uff1a\u7126\u70b9\u53ef\u80fd\u5df2\u7ecf\u8f6c\u79fb\uff0cPython \u90a3\u8fb9\u4e0d\u80fd\u6307\u671b\u5168\u5c40\u53d8\u91cf\u8fd8\u6d3b\u7740\u3002\n",
    "    //\n",
    "    // \u5e76\u4e14\u7ed9\u5b83\u6253\u4e00\u4e2a `data-rf-target` \u6807\u8bb0\uff0c\u7528\u5b83\u5f53\u9009\u62e9\u5668\u4ea4\u7ed9 Python \u53bb\u5199\u3002**\u4e0d\u80fd\u7528\n",
    "    // `data-rf-focus`**\uff1a\u90a3\u4e2a\u4f1a\u88ab\u4e0b\u4e00\u6b21\u805a\u7126\u642c\u8d70\uff0c\u800c\u70b9\u9762\u677f\u672c\u8eab\u5c31\u4f1a\u5f15\u8d77\u7126\u70b9\u53d8\u5316\u2014\u2014\n",
    "    // \u5b9e\u6d4b\u5230\u7684\u540e\u679c\u662f\"\u6311\u4e86\u4e00\u6761\u8d44\u6599\uff0c\u5199\u5165\u65f6\u5374\u627e\u4e0d\u5230\u76ee\u6807\"\u3002\n",
    "    let selector = currentDescription ? currentDescription.selector : '';\n",
    "    if (currentElement && currentElement.isConnected) {\n",
    "      document.querySelectorAll('[data-rf-target]').forEach((other) => {\n",
    "        if (other !== currentElement) { other.removeAttribute('data-rf-target'); }\n",
    "      });\n",
    "      currentElement.setAttribute('data-rf-target', '1');\n",
    "      selector = '[data-rf-target=\"1\"]';\n",
    "    }\n",
    "    // **\u4e0d\u8981\u53bb\u56de\u7126\u9875\u9762\u90a3\u4e2a\u6846**\uff1a\u805a\u7126\u4f1a\u89e6\u53d1 onFocus\uff0c\u800c onFocus \u4f1a\u628a `__rfAccept` \u6e05\u6210\n",
    "    // null\uff08\u90a3\u662f\"\u7528\u6237\u6362\u4e86\u4e2a\u6846\"\u7684\u6b63\u5e38\u8bed\u4e49\uff09\uff0c\u7b49\u4e8e\u628a\u521a\u8bb0\u4e0b\u7684\u9009\u62e9\u62b9\u6389\u3002\u5b9e\u6d4b\u5230\u8fc7\uff1a\n",
    "    // \u63a8\u8350\u90a3\u6761\u80fd\u586b\uff08\u90a3\u4e2a\u6846\u672c\u6765\u5c31\u805a\u7126\u7740\u3001\u4e0d\u89e6\u53d1 focusin\uff09\uff0c\u4ece\u6e05\u5355\u91cc\u6311\u7684\u90a3\u6761\u5374\u77f3\u6c89\u5927\u6d77\u3002\n",
    "    //\n",
    "    // \u56e0\u6b64\u8fd9\u91cc\u4e5f\u4e0d\u628a `__rfAccept` \u4e4b\u5916\u7684\u987a\u5e8f\u7559\u51fa\u7a7a\u9699\u2014\u2014\u8bbe\u5b83\u5c31\u662f\u6700\u540e\u4e00\u6b65\u3002\n",
    "    window.__rfAccept = { label: label, value: value, control: currentDescription, selector: selector };\n",
    "  }\n",
    "\n",
    "  function remember(label, value) {\n",
    "    // 「记住这条」：把**这个框 + 用户看到的标签 + 值**交给 Python 记进「网申资料」。\n",
    "    //\n",
    "    // 与 `accept` 分开成两个全局变量，**不复用 `__rfAccept`**：那个的语义是\"把它填进\n",
    "    // 页面\"，Python 侧收到就会写入并回读校验；而\"记住\"不写页面。共用一个变量就得在\n",
    "    // Python 侧靠某个字段去猜用户点的是哪个按钮——那种猜测迟早会猜错。\n",
    "    //\n",
    "    // 控件描述同样随选择一起带上（理由见 `accept`）：点面板会让页面输入框失焦，\n",
    "    // Python 那边不能指望全局的\"当前焦点\"还活着。这里**不**打 `data-rf-target`——\n",
    "    // 那个标记是给\"往这个框里写值\"用的，而记住不写页面，打了反而会干扰下一次填入。\n",
    "    let selector = currentDescription ? currentDescription.selector : '';\n",
    "    // **同样不去回焦页面那个框**（理由见 `accept`：回焦会触发 onFocus，把刚记的抹掉）。\n",
    "    const remembered = userInputValue.trim() ? userInputValue : value;\n",
    "    window.__rfRemember = { label: label, value: remembered, control: currentDescription, selector: selector };\n",
    "  }\n",
    "\n",
    "  window.__rfHidePanel = hide;\n",
    "\n",
    "  // \u505c\u7528\u65f6\u628a\u76d1\u542c\u4e0e\u9762\u677f**\u6574\u4e2a\u64a4\u6389**\uff1a\u4e0d\u5728\u522b\u4eba\u7684\u9875\u9762\u4e0a\u7559\u4e1c\u897f\uff0c\u4e5f\u907f\u514d\u7528\u6237\u4ee5\u4e3a\u8fd8\u5728\u8fd0\u884c\u3002\n",
    "  window.__rfUninstall = () => {\n",
    "    try {\n",
    "      document.removeEventListener('focusin', onFocus, true);\n",
    "      document.removeEventListener('input', onInput, true);\n",
    "      document.removeEventListener('change', onInput, true);\n",
    "      document.removeEventListener('focusout', onFocusOut, true);\n",
    "      elPick.removeEventListener('scroll', syncActiveGroup);\n",
    "      window.removeEventListener('scroll', position, true);\n",
    "      window.removeEventListener('resize', onResize, true);\n",
    "      // \u91cd\u6392\u8ddf\u8e2a\u7684\u5b9a\u65f6\u5668**\u5fc5\u987b\u4e00\u8d77\u505c**\uff0c\u5426\u5219\u91cd\u590d\u542f\u505c\u4f1a\u6512\u4e0b\u4e00\u5806\u6c38\u8fdc\u5728\u8dd1\u7684\u5b9a\u65f6\u5668\u3002\n",
    "      window.clearInterval(reflowTimer);\n",
    "      document.querySelectorAll('[data-rf-focus]').forEach((el) => el.removeAttribute('data-rf-focus'));\n",
    "      document.querySelectorAll('[data-rf-target]').forEach((el) => el.removeAttribute('data-rf-target'));\n",
    "      host.remove();\n",
    "    } catch (error) { /* \u9875\u9762\u53ef\u80fd\u5df2\u7ecf\u8df3\u8d70 */ }\n",
    "    window.__rfInstalled = false;\n",
    "    window.__rfFocus = null;\n",
    "    window.__rfAccept = null;\n",
    "    window.__rfRemember = null;\n",
    "    window.__rfAutoFillRequest = null;\n",
    "    window.__rfAutoFillStatus = null;\n",
    "    window.__rfFocusSeq = 0;\n",
    "    window.__rfCatalog = null;\n",
    "    dragOffset = null;\n",
    "    lastLeft = -1;\n",
    "    lastTop = -1;\n",
    "    delete window.__rfShowPanel;\n",
    "    delete window.__rfHidePanel;\n",
    "    delete window.__rfUninstall;\n",
    "    delete window.__rfSetAutoFillStatus;\n",
    "    return '1';\n",
    "  };\n",
    "\n",
    "  window.__rfShowPanel = (payload) => {\n",
    "    payload = payload || {};\n",
    "    if (payload.status === 'hidden') { hide(); return; }\n",
    "    if (!focused) { return; }\n",
    "    let placeholder = '';\n",
    "    if (payload.status === 'ai_thinking') { placeholder = 'AI \u6b63\u5728\u8bc6\u522b\u8fd9\u4e2a\u6846\u2026'; }\n",
    "    else if (payload.status === 'thinking') { placeholder = '\u6b63\u5728\u770b\u8fd9\u4e2a\u6846\u2026'; }\n",
    "    elField.textContent = payload.field_label || '';\n",
    "    elValue.textContent = placeholder || payload.value || '';\n",
    "    elNote.textContent = payload.note || '';\n",
    "    // \u6765\u6e90\u6807\u8bb0\uff1aAI \u7ed9\u7684\u7b54\u6848**\u5fc5\u987b\u770b\u5f97\u51fa\u6765\u662f\u731c\u7684**\uff0c\u7528\u6237\u6838\u5bf9\u65f6\u7684\u6000\u7591\u7a0b\u5ea6\u5e94\u5f53\u4e0d\u540c\u3002\n",
    "    elSource.textContent = payload.source === 'ai' ? 'AI \u5efa\u8bae' : '';\n",
    "    elSource.style.display = payload.source === 'ai' ? 'inline-block' : 'none';\n",
    "    const canFill = payload.status === 'matched' && payload.value;\n",
    "    elFill.disabled = !canFill;\n",
    "    elFill.textContent = payload.status === 'filled' ? '\u5df2\u586b\u5165' : '\u586b\u5165';\n",
    "    renderAlternatives(payload.alternatives);\n",
    "    renderRelated(payload.related);\n",
    "    panel.style.display = 'flex';\n",
    "    // \u5c55\u5f00\u72b6\u6001\u8de8\u7126\u70b9\u4fdd\u7559\uff0c\u4f46\u5185\u5bb9\u8981\u6309\u5f53\u524d\u662f\u5426\u5c55\u5f00\u91cd\u753b\u4e00\u904d\u3002\n",
    "    elPick.classList.toggle('on', expanded);\n",
    "    elMore.textContent = expanded ? '\u6536\u8d77' : '\u6362\u4e2a\u8d44\u6599\u2026';\n",
    "    if (expanded) { renderList(elSearch.value); }\n",
    "    position();\n",
    "  };\n",
    "\n",
    "  elClose.addEventListener('click', (event) => {\n",
    "    event.preventDefault();\n",
    "    event.stopPropagation();\n",
    "    hide();\n",
    "  });\n",
    "\n",
    "  elFill.addEventListener('click', (event) => {\n",
    "    event.preventDefault();\n",
    "    event.stopPropagation();\n",
    "    elFill.disabled = true;\n",
    "    accept(elField.textContent, elValue.textContent);\n",
    "  });\n",
    "\n",
    "  elMore.addEventListener('click', (event) => {\n",
    "    event.preventDefault();\n",
    "    event.stopPropagation();\n",
    "    setExpanded(!expanded);\n",
    "  });\n",
    "\n",
    "  elRemember.addEventListener('click', (event) => {\n",
    "    event.preventDefault();\n",
    "    event.stopPropagation();\n",
    "    remember(elField.textContent, elValue.textContent);\n",
    "  });\n",
    "\n",
    "  elSearch.addEventListener('input', () => renderList(elSearch.value));\n",
    "  // \u5728\u9762\u677f\u91cc\u6309 Esc \u5c31\u6536\u8d77\u6e05\u5355\uff0c\u56de\u5230\u63a8\u8350\u90a3\u4e00\u5c42\u3002\n",
    "  elSearch.addEventListener('keydown', (event) => {\n",
    "    if (event.key === 'Escape') { setExpanded(false); if (focused) { focused.focus(); } }\n",
    "  });\n",
    "\n",
    "  return JSON.stringify({ ok: true });\n",
        "})()",
    ]
)


def _set_value_script(selector: str, value: str, *, prototype: str) -> str:
    """给输入框赋值并触发 input/change（用原生 setter，绕开前端框架对 value 的拦截）。

    ``prototype`` 由调用方按控件类型给出——**这正是原先那个 bug 的根源**：类型搞错会抛
    ``Illegal invocation``，而且只有真跑 JS 才会暴露。
    """
    return "".join(
        [
            "(() => { /* rf:set-value */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  const setter = Object.getOwnPropertyDescriptor({prototype}.prototype, 'value').set;\n",
            f"  setter.call(el, {json.dumps(value)});\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
            "  return JSON.stringify({ ok: true, value: String(el.value) });\n",
            "})()",
        ]
    )


def _select_option_script(selector: str, option_value: str) -> str:
    """把 ``<select>`` 选到指定选项上。

    候选值由 Python 从快照里的真实 ``option.value`` 算出来，这里**不做任何判断**。
    单选用 ``HTMLSelectElement`` 的 value setter（对 ``<option value="3">`` 这类必须按
    value 而不是文本设置）；多选逐个置 ``selected``，不清空用户已有的其他选择。
    """
    return "".join(
        [
            "(() => { /* rf:select-option */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  const wanted = {json.dumps(option_value)};\n",
            "  if (el.multiple) {\n",
            "    let hit = false;\n",
            "    for (const option of el.options) { if (option.value === wanted) { option.selected = true; hit = true; } }\n",
            "    if (!hit) { return JSON.stringify({ ok: false, reason: 'no_option' }); }\n",
            "  } else {\n",
            "    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set;\n",
            "    setter.call(el, wanted);\n",
            "    if (el.value !== wanted) { return JSON.stringify({ ok: false, reason: 'no_option' }); }\n",
            "  }\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  el.dispatchEvent(new Event('change', { bubbles: true }));\n",
            "  const picked = el.selectedOptions && el.selectedOptions[0];\n",
            "  return JSON.stringify({ ok: true, value: String(el.value), display: picked ? (picked.textContent || '').trim() : '' });\n",
            "})()",
        ]
    )


def _read_select_options_script(selector: str) -> str:
    """读取当前页面里的原生 ``<select>`` 选项。

    联动下拉在首次读取表单时经常只有「请选择」一个占位项；父级选择完成后，
    子级选项才会异步出现。这里重新读取**当前 DOM**，而不是复用旧快照里的空列表。
    这个脚本只读原生 select，不碰自定义弹层/级联组件。
    """
    return "".join(
        [
            "(() => { /* rf:select-options */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el || el.tagName.toLowerCase() !== 'select') { return JSON.stringify({ ok: false, reason: 'no_select' }); }\n",
            "  return JSON.stringify({ ok: true, options: [...el.options].map((o) => ({ v: String(o.value), t: (o.textContent || '').trim(), d: o.disabled === true })) });\n",
            "})()",
        ]
    )


def _set_richtext_script(selector: str, value: str) -> str:
    return "".join(
        [
            "(() => { /* rf:set-richtext */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            f"  el.textContent = {json.dumps(value)};\n",
            "  el.dispatchEvent(new Event('input', { bubbles: true }));\n",
            "  return JSON.stringify({ ok: true });\n",
            "})()",
        ]
    )


def _read_back_script(selector: str) -> str:
    """回读控件的当前值，用于填充后校验"看起来填了、其实没进去"。"""
    return "".join(
        [
            "(() => { /* rf:read-back */\n",
            f"  const el = document.querySelector({json.dumps(selector)});\n",
            "  if (!el) { return JSON.stringify({ ok: false, reason: 'no_control' }); }\n",
            "  const selected = el.tagName.toLowerCase() === 'select' && el.selectedIndex >= 0 ? el.options[el.selectedIndex] : null;\n",
            "  return JSON.stringify({\n",
            "    ok: true,\n",
            "    value: String(el.value == null ? '' : el.value),\n",
            "    display: selected ? (selected.textContent || '').trim() : '',\n",
            "    checked: el.checked === true,\n",
            "  });\n",
            "})()",
        ]
    )


# 控件类型 → 原生 setter 所在的接口。``select`` 与 ``textarea`` 各走自己的接口，
# 其余（含 date/month/email/tel/number）都是 ``HTMLInputElement``。
_PROTOTYPE_BY_TYPE = {
    "textarea": "HTMLTextAreaElement",
    "richtext": "HTMLElement",
}


@dataclass(frozen=True)
class Control:
    """页面上的一个可见控件。"""

    index: int
    type: str = "unknown"
    name: str = ""
    label: str = ""
    placeholder: str = ""
    aria_label: str = ""
    aria_labelledby: str = ""
    aria_describedby: str = ""
    legend: str = ""
    title: str = ""
    element_id: str = ""
    # HTML 标准的字段类型提示（`autocomplete` 属性）。**唯一不需要猜的信号**——
    # 规范写得好的表单会带，Chrome 的自动填充也把它当第一优先级。
    autocomplete: str = ""
    required: bool = False
    # 只读输入框：值不由用户敲进来，**脚本写得进去、组件的状态却不会变**。级联选择器
    # （省/市/区那类）的输入框几乎都是这个形状，所以不能当普通文本框填。
    readonly: bool = False
    # 点开会弹层的输入框（`aria-haspopup` / `role=combobox`）：自定义下拉、级联选择器。
    # 同样不该直接写值——值该由点选产生。
    has_popup: bool = False
    # 原生 `<select>` 的联动标记；只有它允许在填充阶段重新读取 options。
    linked_select: bool = False
    selector: str = ""
    options: tuple[SelectOption, ...] = ()
    nearby_text: str = ""
    # 重复区块信息。已知时参与严格匹配；为空时兼容旧快照和结构不规范的页面。
    block_label: str = ""
    block_family: str = ""
    block_index: int | None = None
    # 同一区块内两个日期框经常拥有完全相同的文案，采集 DOM 顺序作为额外证据。
    date_order: int | None = None
    # 单选/复选的同组标识（``n:<name>`` 或 ``g:<容器序号>``）。空 = 不属于任何组。
    group: str = ""
    # ===== 当前状态（2026-09-26 新增：判断"用户已经填过"必须靠它）=====
    value: str = ""
    display: str = ""
    checked: bool = False

    def own_text(self) -> str:
        """控件**自己说的**：标签 / 占位符 / aria-label / name。

        与 ``nearby_text``（周围文字）分开，是因为两者的可信度不同——见 ``_best_control``。
        """
        return " ".join(
            part
            for part in (
                self.label,
                self.placeholder,
                self.aria_label,
                self.aria_labelledby,
                self.legend,
                self.title,
                self.name,
                self.element_id,
            )
            if part
        ).casefold()

    def signature(self) -> str:
        """用于启发式匹配的文本指纹（小写，便于包含判断）。"""
        return " ".join(
            part
            for part in (self.own_text(), self.block_label, self.nearby_text, self.aria_describedby)
            if part
        )

    def is_filled(self) -> bool:
        """这个控件页面上已经有值了吗（用于"不覆盖用户已填的值"）。"""
        if self.type in ("radio", "checkbox"):
            return self.checked
        if self.type == "select":
            if not self.options:
                return bool(self.value)
            for option in self.options:
                if option.value == self.value or option.display() == self.display:
                    return not is_placeholder(option.display())
            return bool(self.value)
        return bool(self.value.strip())

    def current_display(self) -> str:
        """给用户看的"页面上现在是什么"。"""
        if self.type in ("radio", "checkbox"):
            return "已勾选" if self.checked else ""
        return self.display or self.value


@dataclass(frozen=True)
class FieldMapping:
    """一条"字段 → 控件"的映射，连同它是怎么被决定的。"""

    control: Control
    field: str
    value: str
    # 文本类无需决策；下拉/单选带上选中的那个选项；日期带上粒度信息。
    select: SelectResolution | None = None
    date: DateResolution | None = None
    # 冠军得分比亚军高出不足这个差值时标为需确认（见 ``_best_control``）。
    low_confidence: bool = False

    def write_value(self) -> str:
        """真正写进页面的那个值（下拉要用 option 的 value，不是展示文本）。"""
        if self.select is not None and self.select.option is not None:
            return self.select.option.value
        if self.date is not None:
            return self.date.value
        return self.value


@dataclass(frozen=True)
class SkipNote:
    """被刻意跳过的控件，附原因（预览里要如实展示）。"""

    control: Control
    reason: str


@dataclass(frozen=True)
class MatchResult:
    """一次匹配的全部产物。"""

    mappings: list[FieldMapping] = field(default_factory=list)
    unmatched: list[Control] = field(default_factory=list)
    skipped: list[SkipNote] = field(default_factory=list)


@dataclass(frozen=True)
class ApplyOutcome:
    """单个控件的填充结果。"""

    index: int
    field: str
    status: str  # filled | skipped | failed | conflict | unverified
    detail: str = ""


def evidence_key(
    control: Control, field_name: str, synonyms: tuple[str, ...]
) -> tuple[int, int] | None:
    """控件相对某个字段的**证据强度**，返回 ``(档位, 得分)``；毫无关联时返回 ``None``。

    档位（**先比档位，再比得分**）：

    - **3** = ``autocomplete``：站点按 HTML 规范**主动声明**的字段类型，不是从文本猜的；
    - **2** = **占位符**：输入框自己写着"请输入导师"——它一对一属于这个框，不会被邻居污染；
    - **1** = ``label`` / ``aria-label`` / ``name``；
    - **0** = 只在**旁文**（``nearby_text``）里命中。

    得分取同义词长度（"工作经验" 比 "经验" 更具体）。

    ## 为什么占位符要单独压过 label 和旁文

    2026-09-27 在腾讯校招简历页（``join.qq.com/resumeedit.html``）取了一份真机快照，
    「导师 / 实验室 / 研究方向 / 论文」四个框紧挨着，每个框的 ``nearby_text`` 都是这四个
    标签**搅在一起**的字符串：

        idx=32 请输入导师       nearby='导师 * 导师 * 实验室 研究方向 论文 0/1000'
        idx=33 请输入实验室     nearby='实验室 导师 * 实验室 研究方向 论文 0/1000'
        idx=34 请输入研究方向   nearby='研究方向 导师 * 实验室 研究方向 论文 0/1000'
        idx=35 请输入已发表论文 nearby='0/1000 0/1000 论文 0/1000 导师 * 实验室 研究方向 论文 0/1000'

    "研究方向" 出现在**每一个**框的签名里，于是按"最长同义词"比，「实验室」「论文」双双
    被它抢走。分档救不了——它们全在旁文档，平分。

    而 ``placeholder`` 一对一、且实测在这张页面上**每一个文本控件都写对了**。所以它单独
    成一档，压过 label 与旁文。``label`` 为什么更低：这张页面上它要么是空的，要么装的是
    **单选项文字**（"男"/"女"/"无实习经历"），比占位符粗得多。

    ## 共用

    引擎的 ``_rank_controls`` 与 ``service.recognize_field`` 共用这一个实现：先前两边各写
    一份，引擎那份修了、``recognize_field`` 那份没修，同一个框在批量预览与实时面板里
    认成了两个不同的字段。
    """
    if AUTOCOMPLETE_FIELDS.get(control.autocomplete) == field_name:
        return (3, 100)
    placeholder = control.placeholder.casefold().strip()
    # 占位符自己**指明了它要什么**（"请输入导师"/"请选择学历"）时，它就是权威：
    # 命中就按它算，**没命中也不许退回旁文**。
    #
    # 否则会出这样的事：腾讯校招页「请输入实验室」的旁文里混着"研究方向"，
    # 占位符查无此字段 → 退回旁文 → 被"研究方向"抢走，于是实验室栏被报成研究方向。
    # 正确行为是**如实说"认不出"**（实验室/论文不在字段目录里，本来就没得填），
    # 而不是从邻居的标签里借一个——借来的那个，用户一眼就看得出是错的。
    #
    # 旁文兜底（档位 0）留给**没有这类占位符**的表单（美团/字节把标签放在 input 旁边，
    # 占位符是空的或通用的"选择日期"），那种页面上旁文是唯一可用的信号。
    if _states_its_field(placeholder):
        best = _longest_synonym(placeholder, synonyms)
        return (2, best) if best > 0 else None
    # 某些真实表单用「如有内推串码可在此填写」描述这个输入框，虽然不以「请输入」
    # 开头，却仍然是一对一的字段声明。只接纳短、明确包含「如有…填写」的文案；
    # 不把长段说明或邻近文字当作这个框的权威标签。
    if placeholder.startswith("如有") and "填写" in placeholder and len(placeholder) <= 40:
        best = _longest_synonym(placeholder, synonyms)
        return (2, best) if best > 0 else None
    tier1 = " ".join(
        (
            control.label,
            control.aria_label,
            control.aria_labelledby,
            control.legend,
            control.title,
            control.name,
        )
    ).casefold()
    for tier, hay in ((1, tier1), (0, control.nearby_text.casefold())):
        best = _longest_synonym(hay, synonyms)
        if best > 0:
            return (tier, best)
    return None


def _longest_synonym(hay: str, synonyms: tuple[str, ...]) -> int:
    """``hay`` 里命中的最长同义词长度；一个都没命中返回 0。"""
    best = 0
    for synonym in synonyms:
        needle = synonym.casefold()
        if needle and needle in hay:
            best = max(best, len(needle))
    return best


def _states_its_field(placeholder: str) -> bool:
    """占位符是不是在**陈述这个框要什么**（"请输入导师" / "请选择学历" / "请填写证件号码"）。

    这类占位符一对一属于输入框本身、实测在该页面上每个文本控件都写对了，
    因此可以当权威用；``nearby_text`` 则可能混进邻居的标签（见 ``evidence_key``）。

    主要认这三种前缀；「如有…填写」是少数仍然一对一指向当前输入框的网申提示，
    由 evidence_key 单独按短文案和字段同义词处理，其他说明文字仍不当作字段名。
    """
    stripped = placeholder.strip()
    return stripped.startswith(("请输入", "请选择", "请填写"))


class FormEngine:
    """通用表单理解与填写。"""

    def snapshot_controls(self, controls: list[dict[str, Any]]) -> list[Control]:
        """把页面快照里的原始控件描述转成 ``Control``（纯函数，便于离线测试）。"""
        result: list[Control] = []
        for raw in controls:
            if not isinstance(raw, dict):
                continue
            control_type = str(raw.get("type", "unknown"))
            if control_type not in CONTROL_TYPES:
                control_type = "unknown"
            try:
                index = int(raw.get("index", len(result)))
            except (TypeError, ValueError):
                index = len(result)
            result.append(
                Control(
                    index=index,
                    type=control_type,
                    name=str(raw.get("name", "")),
                    label=str(raw.get("label", "")),
                    placeholder=str(raw.get("placeholder", "")),
                    aria_label=str(raw.get("aria_label", "")),
                    aria_labelledby=str(raw.get("aria_labelledby", "")),
                    aria_describedby=str(raw.get("aria_describedby", "")),
                    legend=str(raw.get("legend", "")),
                    title=str(raw.get("title", "")),
                    element_id=str(raw.get("id", "")),
                    autocomplete=str(raw.get("autocomplete", "")).strip().casefold(),
                    required=bool(raw.get("required", False)),
                    readonly=bool(raw.get("readonly", False)),
                    has_popup=bool(raw.get("has_popup", False)),
                    linked_select=bool(raw.get("linked_select", False)),
                    selector=str(raw.get("selector", "")),
                    options=self._parse_options(raw.get("options")),
                    nearby_text=str(raw.get("nearby_text", "")),
                    block_label=str(raw.get("block_label", "")),
                    block_family=str(raw.get("block_family", "")),
                    block_index=self._parse_block_index(raw.get("block_index")),
                    date_order=self._parse_optional_int(raw.get("date_order")),
                    group=str(raw.get("group", "")),
                    value=str(raw.get("value", "")),
                    display=str(raw.get("display", "")),
                    checked=bool(raw.get("checked", False)),
                )
            )
        return result

    @staticmethod
    def _parse_optional_int(raw: Any) -> int | None:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            return None
        return value if value > 0 else None

    @classmethod
    def _parse_block_index(cls, raw: Any) -> int | None:
        parsed = cls._parse_optional_int(raw)
        if parsed is not None:
            return parsed
        block = parse_block_label(str(raw or ""))
        return block.index if block is not None else None

    @staticmethod
    def _parse_options(raw: Any) -> tuple[SelectOption, ...]:
        """兼容两种形状：新快照给 ``[{v,t,d}]``，旧快照/旧测试给 ``["北京", "上海"]``。"""
        if not isinstance(raw, list):
            return ()
        options: list[SelectOption] = []
        for item in raw:
            if isinstance(item, dict):
                options.append(
                    SelectOption(
                        value=str(item.get("v", "")),
                        text=str(item.get("t", "")),
                        disabled=bool(item.get("d", False)),
                    )
                )
            elif isinstance(item, str):
                # 旧格式只有文本：value 也当文本用，这是当时唯一能做的假设。
                options.append(SelectOption(value=item, text=item))
        return tuple(options)

    def read_controls(self, client: CdpClient, *, timeout: float | None = None) -> list[Control]:
        """在真实页面上读取控件清单。"""
        payload = client.evaluate(CONTROLS_SCRIPT, timeout=timeout)
        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                logger.warning("表单控件快照无法解析")
                return []
        if not isinstance(payload, dict):
            return []
        controls = payload.get("controls")
        if not isinstance(controls, list):
            return []
        return self.snapshot_controls(controls)

    def match_fields(self, controls: list[Control], data: dict[str, Any]) -> MatchResult:
        """把资料字段启发式映射到控件上。

        三条硬规则：一个控件只被分配一次；命中负向词/黑名单的控件永不参与；``file``
        控件不产生映射（见模块 docstring 缺陷 5）。
        """
        mappings: list[FieldMapping] = []
        skipped: list[SkipNote] = []
        used: set[int] = set()

        for control in controls:
            reason = self.skip_reason(control)
            if reason is not None:
                skipped.append(SkipNote(control=control, reason=reason))
                used.add(control.index)

        # **按证据强度全局择优分配，而不是按字段顺序各抢各的。**
        #
        # 2026-09-26 在美团招聘简历页实测到这条的必要性：字段表里 ``school`` 排在
        # ``research_direction`` 前面，于是它靠**旁文**（弱证据）抢走了「请输入研究方向」
        # 那个控件——而后者在上面是**自述强匹配**，轮到自己时控件已被占用，只能退而求其次，
        # 结果学校名填进了研究方向框。先让每个字段把候选都报上来、按强度排序后再分配，
        # 强证据自然赢过弱证据，与字段在表里的位置无关。
        dynamic_slots = {
            (base, index)
            for raw_field in data
            for base, index in [split_repeated_key(raw_field)]
            if index is not None
        }
        field_order = {field_name: order for order, field_name in enumerate(FIELD_SYNONYMS)}
        candidates: list[tuple[tuple[int, int, int], int, int, str, str, int | None, Control]] = []
        for raw_field, raw_value in data.items():
            base_field, explicit_index = split_repeated_key(str(raw_field))
            if base_field not in FIELD_SYNONYMS:
                continue
            family = family_for_field(base_field)
            target_index = explicit_index if explicit_index is not None else (1 if family else None)
            synonyms = FIELD_SYNONYMS[base_field]
            for key, control in self._rank_controls(
                controls,
                synonyms,
                FIELD_PREFERRED_TYPES.get(base_field),
                base_field,
                target_index=target_index,
            ):
                # 旧版无序号控件沿用静态值；明确的重复区块优先取同一条动态记录。
                if (
                    explicit_index is None
                    and family
                    and control.block_family
                    and (base_field, target_index) in dynamic_slots
                ):
                    continue
                candidates.append(
                    (
                        key,
                        field_order.get(base_field, len(field_order)),
                        control.index,
                        str(raw_field),
                        base_field,
                        target_index,
                        control,
                    )
                )
        # 证据强度优先；同强度时按字段表顺序（``*_start`` 排在 ``*_end`` 前，靠它区分
        # 区块里签名完全相同的两个日期框）；再同则按控件顺序（DOM 里靠前的先拿）。
        candidates.sort(key=lambda item: (-item[0][0], -item[0][1], -item[0][2], item[1], item[2]))

        assigned: set[tuple[str, int | None]] = set()
        for _key, _order, control_index, raw_field, base_field, target_index, control in candidates:
            slot = (base_field, target_index) if family_for_field(base_field) else (raw_field, None)
            if control_index in used or slot in assigned:
                continue
            mapping = self._build_mapping(
                controls,
                control,
                field_key_for_block(base_field, control.block_family, control.block_index)
                if control.block_family and control.block_index
                else raw_field,
                str(data[raw_field]).strip(),
                False,
            )
            if mapping is None:
                continue
            # 单选/复选要把同组兄弟一起占掉，否则下一个字段会挑到同一组的另一个选项。
            used |= self._claimed_indexes(controls, mapping.control)
            assigned.add(slot)
            mappings.append(mapping)

        # 低置信在分配完成之后单独算：判据是该字段自己的冠亚军差距（见 ``_best_control``），
        # 而全局择优决定了它最终拿到的是不是那个冠军。
        final: list[FieldMapping] = []
        for mapping in mappings:
            final.append(
                replace(
                    mapping,
                    low_confidence=self._is_low_confidence(controls, mapping.field, mapping.control),
                )
            )

        unmatched = [control for control in controls if control.index not in used]
        return MatchResult(mappings=final, unmatched=unmatched, skipped=skipped)

    @staticmethod
    def _group_key(control: Control) -> str:
        """单选/复选的分组键；空串表示分不出组（那就只能当它自成一组）。"""
        return control.group or control.name

    @classmethod
    def _claimed_indexes(cls, controls: list[Control], control: Control) -> set[int]:
        """这条映射占掉了哪些控件。

        单选/复选要把**同组兄弟一起占掉**：只占被选中的那一个的话，同组的"女"会留在
        「没认出来」里当噪声，更糟的是可能被后面某个字段认领去。
        """
        if control.type not in ("radio", "checkbox"):
            return {control.index}
        key = cls._group_key(control)
        if not key:
            return {control.index}
        return {
            item.index
            for item in controls
            if item.type == control.type and cls._group_key(item) == key
        }

    def _build_mapping(
        self,
        controls: list[Control],
        control: Control,
        field_name: str,
        value: str,
        low_confidence: bool,
    ) -> FieldMapping | None:
        """按控件类型把值整理成"真正要写进去的东西"；整理不出来就放弃这一条。"""
        if control.type == "select":
            resolution = resolve_select_option(control.options, value)
            if (
                resolution.status == "no_option"
                and control.linked_select
                and not meaningful_options(control.options)
            ):
                # 联动原生下拉可能在首次快照时还只有占位项；先保留这条映射，
                # 真正填充时会在父级选中后重新读取当前 DOM 的 options。
                return FieldMapping(
                    control=control,
                    field=field_name,
                    value=value,
                    select=resolution,
                    low_confidence=low_confidence,
                )
            if resolution.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=value,
                select=resolution,
                low_confidence=low_confidence,
            )

        if control.type in ("radio", "checkbox"):
            # 单选/复选的"选项"是同一 name 下的兄弟控件集合，必须**整组**参与匹配，
            # 才能知道"性别=男"该点哪一个。文本优先用各自的 label，没有就退回它的 value。
            key = self._group_key(control)
            group = [
                item
                for item in controls
                if item.type == control.type and self._group_key(item) == key
            ]
            options = tuple(
                SelectOption(value=item.value, text=item.label or item.value) for item in group
            )
            resolution = resolve_choice(options, value)
            if resolution.status != "matched" or resolution.option is None:
                return None
            chosen = next(
                (item for item in group if item.value == resolution.option.value), None
            )
            if chosen is None:
                return None
            return FieldMapping(
                control=chosen,
                field=field_name,
                value=value,
                select=resolution,
                low_confidence=low_confidence,
            )

        if control.type in ("date", "month"):
            resolution = format_date(value, kind=control.type)
            if resolution.status != "matched":
                return None
            return FieldMapping(
                control=control,
                field=field_name,
                value=value,
                date=resolution,
                low_confidence=low_confidence or resolution.assumed_day,
            )

        if control.type == "text":
            date_hint = " ".join(
                (
                    field_name,
                    control.signature(),
                    control.value,
                    control.display,
                )
            )
            if is_date_hint(date_hint):
                resolution = format_date(value, kind="text", hint=date_hint)
                if resolution.status == "matched":
                    return FieldMapping(
                        control=control,
                        field=field_name,
                        value=value,
                        date=resolution,
                        low_confidence=low_confidence,
                    )

        return FieldMapping(
            control=control, field=field_name, value=value, low_confidence=low_confidence
        )

    @staticmethod
    def skip_reason(control: Control) -> str | None:
        """这个控件为什么永不自动填；``None`` 表示可以参与匹配。"""
        signature = control.signature()
        if control.type == "file":
            return "简历附件需要你自己选择文件上传"
        # 只读框 / 点开是弹层的框：**看起来像文本框，其实值只能由点选产生**。
        #
        # 直接往里写 `.value` 是最糟的一种"成功"：框里出现了一行字，看着像填上了，而组件
        # 内部状态一点没变——表单交上去还是空的。级联选择器（省/市/区）就是典型：它把
        # 内部状态**显示**在只读输入框里，用户点开三级菜单选完才真的产生值。
        #
        # 与"下拉里只有占位项"那条是同一类处置：**宁可如实说"要你自己点"，也不假装填上了**。
        if control.type != "select" and (control.readonly or control.has_popup):
            return "这是个只能点选的选择控件（值不能直接写进去），需要你在页面上自己点选"
        # 站点自己声明的"别自动填"：密码 / 验证码 / 银行卡。这比我们从标签猜更可信——
        # 是表单在明说这是一类不该由程序填的控件。
        if control.autocomplete in AUTOCOMPLETE_DENY:
            kind = AUTOCOMPLETE_DENY[control.autocomplete]
            return f"站点标注为{kind}（autocomplete={control.autocomplete}），永不自动填写"
        for word in FIELD_DENYLIST:
            if word in signature:
                return f"涉及“{word}”，永不自动填写"
        # 同意类勾选：代勾等于替你做出法律意义上的同意，只能你自己点。
        if control.type in ("checkbox", "radio"):
            for word in CONSENT_HINTS:
                if word in signature:
                    return f"涉及“{word}”的确认项，需要你本人勾选"
            # 声明类勾选：「无实习经历」勾上是在断言"我没有这段经历"、「至今」是在断言
            # "这段经历还在进行"。两者都是**替用户陈述事实**，而不只是填一个值——
            # 与"不替用户表达意愿"是同一条纪律。
            label = control.label.strip()
            if label.startswith("无") and ("经历" in label or "信息" in label):
                return f"“{label}”是声明类勾选，需要你自己判断"
            if label in CLAIM_LABELS:
                return f"“{label}”是声明类勾选，需要你自己判断"
        return None

    @staticmethod
    def _hinted_out(control: Control, field_name: str) -> bool:
        """命中该字段的负向词（如"紧急联系人姓名"之于"姓名"）。"""
        signature = control.signature()
        return any(word in signature for word in FIELD_EXCLUDE_HINTS.get(field_name, ()))

    @classmethod
    def _rank_controls(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
        *,
        target_index: int | None = None,
    ) -> list[tuple[tuple[int, int, int], Control]]:
        """把控件按"它有多像这个字段"排序（强到弱）。

        **控件自己说的比周围文字更可信**：``own_text``（label / placeholder / name）里
        命中的，一律排在"只在 ``nearby_text`` 里命中"的前面。2026-09-26 在腾讯校招简历页
        实测到这条的必要性——那三个框是紧挨着的「导师 / 实验室 / 研究方向」，累积出来的
        上下文把三个标签都装进了彼此的签名，于是"研究方向"被填进了「实验室」。
        分开之后，"请输入研究方向"（自己说的）稳稳赢过"请输入实验室"（只是旁边提到）。

        排序键 = ``(是否自述命中, 得分+类型偏好, -控件序号)``，返回时已从强到弱。
        """
        block_hint = FIELD_BLOCK_HINTS.get(field_name)
        scored: list[tuple[tuple[int, int, int], Control]] = []
        for control in controls:
            if cls._hinted_out(control, field_name):
                continue
            if not compatible_block(
                field_name,
                control.block_family,
                control.block_index,
                target_index=target_index,
            ):
                continue
            key = evidence_key(control, field_name, synonyms)
            if key is None:
                continue
            # 区块限定：多段经历里的短词（"职位"、"描述"、"起止时间"）必须靠它才不会
            # 在别的区块上误命中——见 FIELD_BLOCK_HINTS 的说明。
            # 没有区块标题的旧页面仍可用控件自己的 label / placeholder / name 识别明确字段；
            # 只有旁文这一档的弱证据才继续要求区块标题。这样“是否境外教育”等明确字段
            # 不会因为页面没有输出“教育经历-1”标题而被无故跳过。
            choice_field = any("是否" in synonym for synonym in synonyms)
            choice_without_block = choice_field and control.type in ("select", "radio", "checkbox")
            if (
                block_hint
                and block_hint not in control.signature()
                and not control.block_family
                and key[0] < 1
                and not choice_without_block
            ):
                continue
            if block_hint and control.block_family and not compatible_block(
                field_name, control.block_family, control.block_index, target_index=target_index
            ):
                continue
            expected_date_order = 1 if field_name.endswith("_start") else 2 if field_name.endswith("_end") else None
            if expected_date_order and control.date_order and control.date_order != expected_date_order:
                continue
            bonus = 5 if preferred_types and control.type in preferred_types else 0
            scored.append(((key[0], key[1] + bonus, -control.index), control))
        scored.sort(key=lambda item: item[0], reverse=True)
        return scored

    @classmethod
    def _top_two(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
    ) -> tuple[Control | None, Control | None]:
        ranked = cls._rank_controls(controls, synonyms, preferred_types, field_name)
        if not ranked:
            return None, None
        best = ranked[0][1]
        runner = next((item[1] for item in ranked[1:] if item[1].index != best.index), None)
        return best, runner

    @classmethod
    def _is_low_confidence(
        cls, controls: list[Control], field_name: str, chosen: Control
    ) -> bool:
        """这条映射要不要标"需确认"。

        判据是**该字段自己的冠亚军差距**：负向词能挡掉一部分（见 ``_hinted_out``），
        挡不住的那部分靠它暴露给用户。

        同组单选/复选除外：性别那两个选项本来就由 ``_build_mapping`` 在组内按值再挑一次，
        旗子插上去只是噪声。
        """
        base_field, explicit_index = split_repeated_key(field_name)
        family = family_for_field(base_field)
        target_index = explicit_index if explicit_index is not None else (1 if family else None)
        ranked = cls._rank_controls(
            controls,
            FIELD_SYNONYMS.get(base_field, ()),
            FIELD_PREFERRED_TYPES.get(base_field),
            base_field,
            target_index=target_index,
        )
        if len(ranked) < 2:
            return False
        best_key, best = ranked[0]
        runner_key, runner = ranked[1]
        if best.index != chosen.index:
            # 全局择优把冠军让给了别的字段（对方证据更强），这一条本来就是退而求其次的。
            return True
        if cls._group_key(best) and cls._group_key(best) == cls._group_key(runner):
            return False
        return best_key[0] == runner_key[0] and (best_key[1] - runner_key[1]) < 2

    @classmethod
    def _best_control(
        cls,
        controls: list[Control],
        synonyms: tuple[str, ...],
        used: set[int],
        preferred_types: tuple[str, ...] | None,
        field_name: str,
    ) -> tuple[Control | None, bool]:
        """单个字段的最佳控件与置信度（保留给测试与离线诊断用；实际分配走 ``match_fields``
        的全局择优）。"""
        ranked = cls._rank_controls(controls, synonyms, preferred_types, field_name)
        available = [item for item in ranked if item[1].index not in used]
        if not available:
            return None, False
        best = available[0][1]
        return best, cls._is_low_confidence(controls, field_name, best)

    @staticmethod
    def unmapped_required(controls: list[Control], mappings: list[FieldMapping]) -> list[Control]:
        """已映射之外、仍然必填的控件（调用方据此如实报"这些还需要你填"）。"""
        mapped = {mapping.control.index for mapping in mappings}
        return [
            control for control in controls if control.required and control.index not in mapped
        ]

    def apply(
        self, client: CdpClient, mappings: list[FieldMapping], *, timeout: float | None = None
    ) -> list[ApplyOutcome]:
        """逐字段写入页面，并**逐条返回结果**（原先返回 ``None`` 且吞掉异常）。

        写完后回读一次页面值：受控组件有时"看起来填了、其实没进去"（值出现在界面上，
        但框架的内部状态没更新，提交时又报"请填写"）。回读不一致的如实标成
        ``unverified``，而不是当作成功。
        """
        outcomes: list[ApplyOutcome] = []
        for mapping in mappings:
            control = mapping.control
            if not control.selector:
                outcomes.append(ApplyOutcome(control.index, mapping.field, "skipped", "控件没有定位符"))
                continue
            applied_mapping = mapping
            try:
                if control.type == "select":
                    applied_mapping = self._apply_select(client, mapping, timeout=timeout)
                elif control.type in ("radio", "checkbox"):
                    self._apply_choice(client, mapping, timeout=timeout)
                elif control.type == "richtext":
                    client.evaluate(
                        _set_richtext_script(control.selector, mapping.value), timeout=timeout
                    )
                else:
                    client.evaluate(
                        _set_value_script(
                            control.selector,
                            mapping.write_value(),
                            prototype=_PROTOTYPE_BY_TYPE.get(control.type, "HTMLInputElement"),
                        ),
                        timeout=timeout,
                    )
            except Exception as error:  # noqa: BLE001 - 单个控件失败不该中断整轮
                logger.warning("填充控件 %s 失败：%s", control.index, error)
                outcomes.append(
                    ApplyOutcome(control.index, mapping.field, "failed", f"{type(error).__name__}")
                )
                continue

            outcomes.append(self._verify(client, applied_mapping, timeout=timeout))
        return outcomes

    @staticmethod
    def _apply_select(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> FieldMapping:
        selected_value = mapping.write_value()
        if mapping.select is None or mapping.select.status != "matched":
            # 父级 select 触发的异步加载可能在快照之后才完成；每次轮询都只读当前
            # 原生 select 的真实 option，最终仍由 resolve_select_option 做严格匹配。
            deadline = time.monotonic() + (
                _DEPENDENT_SELECT_WAIT_SECONDS
                if timeout is None
                else min(_DEPENDENT_SELECT_WAIT_SECONDS, max(float(timeout), 0.0))
            )
            resolution = SelectResolution("no_option", reason="联动下拉的选项尚未加载")
            while True:
                payload = client.evaluate(
                    _read_select_options_script(mapping.control.selector), timeout=timeout
                )
                if isinstance(payload, str):
                    try:
                        payload = json.loads(payload)
                    except ValueError:
                        payload = None
                options = (
                    FormEngine._parse_options(payload.get("options"))
                    if isinstance(payload, dict) and payload.get("ok")
                    else ()
                )
                resolution = resolve_select_option(options, mapping.value)
                if resolution.status == "matched" and resolution.option is not None:
                    selected_value = resolution.option.value
                    break
                if time.monotonic() >= deadline or resolution.status not in {"no_option", "empty"}:
                    raise RuntimeError(
                        f"联动下拉未出现与“{mapping.value}”匹配的选项：{resolution.reason}"
                    )
                time.sleep(_DEPENDENT_SELECT_POLL_SECONDS)
        client.evaluate(
            _select_option_script(mapping.control.selector, selected_value),
            timeout=timeout,
        )
        if mapping.select is None or mapping.select.status != "matched":
            return replace(mapping, select=resolution)
        return mapping

    @staticmethod
    def _apply_choice(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> None:
        """单选/复选：**只在需要改变状态时才点**。

        对已勾选的复选框再点一下会把它取消——而"取消用户的勾选"比不填更糟。
        """
        if mapping.control.checked:
            return
        click_selector(client, mapping.control.selector, timeout=timeout)

    @staticmethod
    def _verify(
        client: CdpClient, mapping: FieldMapping, *, timeout: float | None
    ) -> ApplyOutcome:
        """回读页面值，与期望比对。"""
        try:
            payload = client.evaluate(
                _read_back_script(mapping.control.selector), timeout=timeout
            )
        except Exception:  # noqa: BLE001 - 回读失败不影响"已经填过"这个事实
            return ApplyOutcome(mapping.control.index, mapping.field, "filled", "未能回读校验")

        if isinstance(payload, str):
            try:
                payload = json.loads(payload)
            except ValueError:
                payload = None
        if not isinstance(payload, dict) or not payload.get("ok"):
            return ApplyOutcome(mapping.control.index, mapping.field, "unverified", "回读不到控件")

        expected = mapping.write_value()
        if mapping.control.type == "select":
            actual = str(payload.get("value", ""))
        elif mapping.control.type in ("radio", "checkbox"):
            if not payload.get("checked"):
                return ApplyOutcome(
                    mapping.control.index, mapping.field, "unverified", "点击后仍未勾选"
                )
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")
        else:
            actual = str(payload.get("value", ""))

        if actual == expected:
            return ApplyOutcome(mapping.control.index, mapping.field, "filled")
        return ApplyOutcome(
            mapping.control.index,
            mapping.field,
            "unverified",
            f"页面上的值是 {actual!r}，与期望不符，可能未生效",
        )


__all__ = [
    "CONTROL_TYPES",
    "CONTROLS_SCRIPT",
    "ApplyOutcome",
    "Control",
    "FieldMapping",
    "FormEngine",
    "MatchResult",
    "SkipNote",
]
