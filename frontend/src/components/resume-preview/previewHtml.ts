// SPDX-License-Identifier: Apache-2.0
/**
 * 预览 iframe 专用的 HTML 清洗：去掉后端模板里的「排页探针脚本」。
 *
 * 草稿画布用 `<iframe sandbox="allow-same-origin">`（**没有** allow-scripts）：脚本本来
 * 就不会执行，只会在控制台刷一条 `Blocked script execution in 'about:srcdoc' …`（Q22）。
 * 去掉它不改变任何行为——预览的溢出 / 页数由前端自己量（`layout.ts` +
 * `resumeLayoutMeasure.ts`），不读这个脚本写出的 `body.dataset`；而**导出单文件 HTML**
 * 不经过这个函数，探针照常保留（那是"离线文件超没超页"的唯一回答者）。
 *
 * 只删脚本块，不动其它标签：模板里的样式表、`data-resume-path`、字体 @font-face 都要原样进
 * iframe，否则预览与导出会在这里分叉。所以这里**不做 DOMParser 往返**——序列化会重排属性、
 * 改写自闭合标签，样式表与 `data-*` 就不再是后端吐出的那些字节。
 *
 * 为什么不用正则：`/<script\b[^>]*>[\s\S]*?<\/script>/gi` 挡不住标签的合法变体
 * （`</script >` 带空格、`<script/>` 自闭合、未闭合到文件尾，以及 `<scr<script>ipt>`
 * 这种替换一次又拼出新标签的写法），也不认大小写混写——这正是 CodeQL
 * `js/bad-tag-filter` 与 `js/incomplete-multi-character-sanitization` 报的那两类问题。
 * 下面换成手写线性扫描：按 HTML 词法找「开标签 → 它自己的 `>` → 闭标签 → 它自己的 `>`」，
 * 逐个确定性地切，切断后重新扫描结果，直到再也找不到 `<script`。
 */

/** 小写形态的开标签前缀（比较时对方逐字符折成小写）。 */
const OPEN_PREFIX = "<script";
/** 小写形态的闭标签前缀。 */
const CLOSE_PREFIX = "</script";

const CHAR_GREATER_THAN = 62; // >
const CHAR_SLASH = 47; // /
const CHAR_UPPER_A = 65;
const CHAR_UPPER_Z = 90;
const ASCII_CASE_OFFSET = 32; // 'A' -> 'a'

/**
 * 判断 `code` 是不是 HTML 意义的空白（标签名后的合法分界）。
 *
 * @param code 字符码点。
 * @returns 是空白则 true。
 */
function isAsciiWhitespace(code: number): boolean {
  // tab / LF / FF / CR / space（script 标签名后接这些字符都算合法分界）。
  return code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

/**
 * 在 `html` 的 `index` 处是否出现 `prefix`（ASCII 大小写不敏感）。
 *
 * 不用 `toLowerCase()` / `localeCompare`：逐字符折大小写既可预测，也不会为整串分配副本。
 *
 * @param html 待扫描字符串。
 * @param index 起始下标。
 * @param prefix 全小写的目标串。
 * @returns 命中则 true。
 */
function matchesAsciiIgnoreCase(html: string, index: number, prefix: string): boolean {
  if (index < 0 || index + prefix.length > html.length) {
    return false;
  }
  for (let offset = 0; offset < prefix.length; offset += 1) {
    let code = html.charCodeAt(index + offset);
    if (code >= CHAR_UPPER_A && code <= CHAR_UPPER_Z) {
      code += ASCII_CASE_OFFSET;
    }
    if (code !== prefix.charCodeAt(offset)) {
      return false;
    }
  }
  return true;
}

/**
 * 标签名之后是否已经是分界（空白 / `>` / `/` / 字符串结尾）。
 *
 * 没有这一步，`<scriptx>` 这种别的标签会被误当成本函数的删除目标。
 *
 * @param html 待扫描字符串。
 * @param index 标签名之后的下标。
 * @returns 是分界则 true。
 */
function isTagNameBoundary(html: string, index: number): boolean {
  if (index >= html.length) {
    return true;
  }
  const code = html.charCodeAt(index);
  return code === CHAR_GREATER_THAN || code === CHAR_SLASH || isAsciiWhitespace(code);
}

/**
 * 找下一个 `<script` 开标签（大小写不敏感，标签名后必须是分界）。
 *
 * @param html 待扫描字符串。
 * @param from 起始下标。
 * @returns 命中时返回 `<` 的下标，否则 -1。
 */
function findScriptOpen(html: string, from: number): number {
  let index = html.indexOf("<", from);
  while (index !== -1) {
    if (
      matchesAsciiIgnoreCase(html, index, OPEN_PREFIX) &&
      isTagNameBoundary(html, index + OPEN_PREFIX.length)
    ) {
      return index;
    }
    index = html.indexOf("<", index + 1);
  }
  return -1;
}

/**
 * 找下一个 `</script` 闭标签，并返回它自己的 `>` 的下标。
 *
 * @param html 待扫描字符串。
 * @param from 起始下标。
 * @returns 命中时返回闭标签 `>` 的下标，否则 -1。
 */
function findScriptCloseEnd(html: string, from: number): number {
  let index = html.indexOf("</", from);
  while (index !== -1) {
    if (
      matchesAsciiIgnoreCase(html, index, CLOSE_PREFIX) &&
      isTagNameBoundary(html, index + CLOSE_PREFIX.length)
    ) {
      const end = html.indexOf(">", index + CLOSE_PREFIX.length);
      if (end === -1) {
        return -1;
      }
      return end;
    }
    index = html.indexOf("</", index + 2);
  }
  return -1;
}

/**
 * 从左到右扫一遍，删掉本次扫描看到的所有 `<script …> … </script …>` 段。
 *
 * 未闭合的脚本块按「删到字符串末尾」处理（浏览器遇到未闭合的 `<script>` 也是把余下内容
 * 全当脚本体，这里的处理与之同向且更安全）。命中数清零时原样返回入参（不做无谓拷贝）。
 *
 * @param html 待清洗字符串。
 * @returns 删掉本轮命中段后的字符串。
 */
function removeScriptBlocksOnce(html: string): string {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const open = findScriptOpen(html, cursor);
    if (open === -1) {
      break;
    }
    // 开标签自己的 `>`：脚本属性里若出现 `>`，这里和浏览器一样先到最近的 `>`。
    const openEnd = html.indexOf(">", open + OPEN_PREFIX.length);
    if (openEnd === -1) {
      // 连开标签都没闭合：余下全是脚本，删到结尾。
      chunks.push(html.slice(cursor, open));
      cursor = html.length;
      break;
    }
    const closeEnd = findScriptCloseEnd(html, openEnd + 1);
    chunks.push(html.slice(cursor, open));
    if (closeEnd === -1) {
      // 未闭合脚本块：删到字符串末尾。
      cursor = html.length;
      break;
    }
    cursor = closeEnd + 1;
  }
  // cursor 停在 0 说明第一轮就没找到 `<script`：没有删除发生，原样返回入参。
  if (cursor === 0) {
    return html;
  }
  chunks.push(html.slice(cursor));
  return chunks.join("");
}

/**
 * 去掉预览 iframe 不应收到的脚本块（Q22）。
 *
 * 反复扫描到"结果里再也找不到 `<script`"为止：删除会把断开的残片重新拼起来
 * （`<scr<script>ipt>alert(1)</script>` 第一次删完可能拼出新的 `<script>`），
 * 单趟扫描不足以保证幂等安全，所以循环收敛。每轮至少删掉 7 个字符，必然终止。
 *
 * @param html 后端渲染的整份 HTML（含探针脚本）。
 * @returns 去掉脚本块后的 HTML；没有脚本时**原样返回入参**（同一个字符串值）。
 */
export function stripPreviewScripts(html: string): string {
  let current = html;
  for (;;) {
    const next = removeScriptBlocksOnce(current);
    if (next === current) {
      return current;
    }
    current = next;
  }
}
