// SPDX-License-Identifier: Apache-2.0
/**
 * 行内标记的**类型与常量**（I-12 · P-1 拆出来的第一块）。
 *
 * 为什么拆：原 `inlineMarkRuns.ts` 是 **496 行**，项目红线是单文件 500 行（含 `.css` 与
 * 测试，不许写豁免）。I-12 的 P2（编辑器改结构化）要在那个文件里加代码，第一行就会破线。
 * 这里只搬**纯声明**（常量 + 类型），零运行时依赖，所以是风险最低的一刀。
 *
 * 门面仍是 `inlineMarkRuns.ts`：它对外 `export` 的东西一个没少，既有 import 路径零改动。
 */

/** 样式区间的收口标记（与后端 `resume_inline_style.STYLE_CLOSE` 同一串）。 */
export const STYLE_CLOSE = "{@}";

/** 字号系数的合法区间（与后端 `MIN_SIZE` / `MAX_SIZE` 同值）。 */
export const MIN_INLINE_SIZE = 0.5;
export const MAX_INLINE_SIZE = 1.6;

/** 链接 URL 长度上限（与后端 `MAX_LINK_URL_LENGTH` 逐字一致）。 */
export const MAX_LINK_URL_LENGTH = 512;

/** 一段可见文字及其样式。`bold`/`size`/`color`/`href` 缺省表示"无这一项覆盖"。 */
export interface InlineMarkRun {
  text: string;
  bold?: boolean;
  /** 相对当前字号的系数（0.5–1.6）；渲染成 `font-size: N%`。 */
  size?: number;
  /** `#rgb` / `#rrggbb`（已小写）。 */
  color?: string;
  /** 链接地址；`text` 是它的显示文字。 */
  href?: string;
}

/** 覆盖整串的分段：`hidden` 为真的段是标记语法，遮罩层把它渲染成"占位但不可见"。 */
export interface InlineMarkSegment extends InlineMarkRun {
  hidden?: boolean;
}

export interface InlineStyleAttributes {
  size?: number;
  color?: string;
}

/**
 * 标记串里的一个"排版原子"。
 *
 * 普通字符与样式标记（`{@…}` / `{@}`）都是原子：把标记收成**一个**原子，是为了让
 * 加粗/斜体/链接这三层解析在"去掉标记后的字符序列"上跑（标记不该参与配对），
 * 同时又保留它在源串里的区间——遮罩层要靠这个区间把标记渲染成不可见占位。
 */
export interface Atom {
  /** 源串区间 `[rawStart, rawEnd)`。 */
  rawStart: number;
  rawEnd: number;
  /** 普通字符的本体；样式标记（`{@…}` / `{@}`）为 `null`。 */
  char: string | null;
  /** 起始标记的属性；收口标记只有 `close`。 */
  style?: InlineStyleAttributes;
  close?: boolean;
}

/** 参与解析的中间结果：一段连续原子 + 它在这一层的样式。 */
export interface Piece {
  /** 原子下标区间 `[start, end)`。 */
  start: number;
  end: number;
  bold: boolean;
  href?: string;
}

export const LINK_SCHEMES = ["http://", "https://", "mailto:"] as const;
export const HREF_UNSAFE = /[<>"]/;
export const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
export const ATTRIBUTE = /^\s*(size|color)\s*=\s*([^,]+?)\s*$/i;
/** 样式标记在解析序列里占的"字符"：不含 `*` / `[` / `]`，不会干扰后三层解析。 */
export const PLACEHOLDER = "\ue000";
