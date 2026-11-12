// SPDX-License-Identifier: Apache-2.0
/**
 * 科研栏目的链接安全（W14）：DOI 与 URL 只在**确实是 http(s)** 时才变成可点链接。
 *
 * ## 为什么必须在这里拦
 *
 * 期刊/会议链接、DOI 解析地址都是用户手填的纯文本。直接塞进 href 会让 `javascript:` 变成
 * 可执行链接（XSS），而 `data:` / `file:` 会变成"点了下载一个本地文件"这种更糟的东西。
 * 所以规则只有一条：**能解析成 http: / https: 才给 href，否则原样当文字**。
 *
 * 这与后端导出侧的口径一致（HTML 的链接同样只允许 http(s)，见契约 §2.7）；
 * 前端这一层是"编辑时就能看见它不可点"的即时反馈，不是安全边界本身。
 */

/** 单条链接的最大长度（后端 url 字段上限 512，这里同值避免两处漂移）。 */
export const MAX_LINK_LENGTH = 512;

/** 控制字符与空白一律拒绝：它们能把 URL 拆成两截，或藏一个不可见前缀。 */
function hasForbiddenChar(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f) return true;
    if (/\s/.test(char)) return true;
  }
  return false;
}

/**
 * 把用户输入变成**可安全放进 href** 的绝对 http(s) 地址；不合法返回 null。
 *
 * null 的语义是"按纯文字展示"，不是"报错"——用户可能正在输入，页面不该因此红一片。
 */
export function safeExternalHref(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > MAX_LINK_LENGTH) return null;
  if (hasForbiddenChar(trimmed)) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // 有主机名才算"真的能打开"（http:///x 能解析但没有 host）。
  if (!parsed.hostname) return null;
  return parsed.href;
}

/** DOI 的合法形态：10.xxxx/<后缀>。不合法的 DOI 不当链接（但字段值本身照原样保存）。 */
const DOI_PATTERN = /^10\.\d{4,9}\/[^\s<>"']+$/;

/** 把 DOI 变成出版方页面地址；形态不合法返回 null。 */
export function doiHref(doi: string | null | undefined): string | null {
  if (typeof doi !== "string") return null;
  const trimmed = doi.trim();
  if (!trimmed || trimmed.length > 256) return null;
  if (!DOI_PATTERN.test(trimmed)) return null;
  return safeExternalHref("https://doi.org/" + trimmed);
}

/** 展示用短文本：超长截断（不改变 href，只影响可见文字）。 */
export function linkText(raw: string | null | undefined, max = 48): string {
  const trimmed = typeof raw === "string" ? raw.trim() : "";
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1) + "…";
}
