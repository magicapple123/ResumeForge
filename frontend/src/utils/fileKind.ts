// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历的「文件类型」判定：给列表行做类型徽标（PDF / DOCX / DOC / MD / TXT）。
 *
 * 为什么要一个纯函数：列表接口一直返回 `mime`，但界面从来没读过它——用户上传的
 * 十份简历在列表里长得完全一样，只能靠文件名后缀自己猜。徽标需要的判定很短，但
 * 判定顺序有讲究（见下），放在组件里会被 `render` 的闭包藏住、也没法单测。
 *
 * 判定顺序是**先扩展名、后 MIME**：用户给的文件 MIME 并不总是可信
 * （Windows 上 `.md` 常常报 `text/plain`，`application/octet-stream` 更是万能答案），
 * 而扩展名是用户自己命名的、与"他在 Word 里存的是 docx"这件事一致。只有在没有
 * 扩展名（或扩展名不认识）时才回落到 MIME。
 */

/**
 * 徽标要区分的类型。
 *
 * - `pdf`：原件可在浏览器内预览，也是「扫描件」问题的高发区；
 * - `docx` / `doc`：Word 两代格式，处理链路不同（docx 是 zip+xml）；
 * - `markdown` / `text`：纯文本，天然保格式；
 * - `other`：都不认识——徽标照样出现，只是写「其他」，不假装知道是什么。
 */
export type ExternalFileKind = "pdf" | "docx" | "doc" | "markdown" | "text" | "other";

/** 扩展名 → 类型。键都是小写，比较前统一转小写。 */
const SUFFIX_KINDS: Record<string, ExternalFileKind> = {
  pdf: "pdf",
  docx: "docx",
  doc: "doc",
  md: "markdown",
  markdown: "markdown",
  txt: "text",
  text: "text",
};

/** MIME → 类型（只列本项目上传链路会真正遇到的几个）。 */
const MIME_KINDS: Record<string, ExternalFileKind> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/plain": "text",
};

/** 取扩展名（不含点、已小写）；没有扩展名时返回空串。 */
function suffixOf(name: string): string {
  const index = name.lastIndexOf(".");
  // `index <= 0` 同时排除"没有点"和".gitignore"这种隐藏文件（点在最前不算扩展名）。
  if (index <= 0 || index === name.length - 1) return "";
  return name.slice(index + 1).toLowerCase();
}

/** 去掉 MIME 参数（`text/plain; charset=utf-8` → `text/plain`）并小写。 */
function bareMime(mime: string): string {
  return (mime.split(";", 1)[0] ?? "").trim().toLowerCase();
}

/**
 * 判定文件类型。空 MIME 或空文件名都不会抛错——列表数据里两者都可能为空字符串。
 *
 * @param mime 列表接口返回的 `mime`（可能带 `; charset=` 参数，也可能为 `""`）。
 * @param name 文件名（可能没有扩展名）。
 */
export function fileKindOf(mime: string, name: string): ExternalFileKind {
  const bySuffix = SUFFIX_KINDS[suffixOf(name ?? "")];
  if (bySuffix) return bySuffix;
  const byMime = MIME_KINDS[bareMime(mime ?? "")];
  if (byMime) return byMime;
  // 兜底再看一层前缀：`text/csv`、`text/html` 这类虽然不在白名单里，但确实是文本，
  // 显示「TXT」比显示「其他」更接近事实。
  if (bareMime(mime ?? "").startsWith("text/")) return "text";
  return "other";
}

/**
 * 徽标文字。`other` 返回 `null`，由调用方决定写什么文案（要过 i18n，不能在这里写死）。
 *
 * 其余几档是**格式名**（PDF / DOCX…），中英文界面完全一致，不需要翻译。
 */
export function fileKindBadge(kind: ExternalFileKind): string | null {
  switch (kind) {
    case "pdf":
      return "PDF";
    case "docx":
      return "DOCX";
    case "doc":
      return "DOC";
    case "markdown":
      return "MD";
    case "text":
      return "TXT";
    default:
      return null;
  }
}
