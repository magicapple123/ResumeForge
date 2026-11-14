// SPDX-License-Identifier: Apache-2.0
/**
 * 朗读发音词表（F17）：只改**送进 TTS 的文本**，界面上显示的消息一个字不动。
 *
 * 为什么需要：远程合成用的是 `language_type: Auto`，中文上下文里遇到 `MySQL` 会按字母
 * 逐个念成 "my S Q L"。把这类"逐字母读明显是错的"词换成音节拼写，中文语音引擎就会把
 * 它当一个词读出来。浏览器内置音色走同一份文本（`speechTextFromMarkdown`），所以两条
 * 播报路径同时生效。
 *
 * 三条匹配规则：
 * - **大小写敏感**：`mysql`（代码片段里的全小写写法）不替换，避免动到正文；
 * - **词边界**：前后不能是 ASCII 字母或数字，所以 `MySQL2`、`MySQLX` 不替换——它们通常是
 *   版本号或别的标识符，替换成 "my sequel 2" 反而更难懂；
 * - **最长匹配**：`PostgreSQL` / `SQLite` 先于 `SQL` 命中，否则会读成 "postgres sequel lite"。
 *
 * 词表是启发式，没登记的术语仍可能被逐字母读。登记标准只有一条：**这个词逐字母读是错的**。
 * 像 `API` / `HTTP` / `URL` 这类缩写，中文里本来就该按字母读，加进来只会把对的读法改坏。
 */
const PRONUNCIATIONS: ReadonlyArray<readonly [word: string, spoken: string]> = [
  ["PostgreSQL", "postgres sequel"],
  ["MySQL", "my sequel"],
  ["SQLite", "sequel lite"],
  ["SQL", "sequel"],
];

const SPOKEN = new Map(PRONUNCIATIONS);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 一次扫描全部词条；排序在模块加载时算好，`replace` 每个词都复用同一条正则。 */
const PATTERN = new RegExp(
  `(?<![A-Za-z0-9])(?:${[...PRONUNCIATIONS]
    .sort((left, right) => right[0].length - left[0].length)
    .map(([word]) => escapeRegExp(word))
    .join("|")})(?![A-Za-z0-9])`,
  "g",
);

/**
 * 把术语换成长词表里的读音。幂等：替换后的结果不会再命中（`my sequel` 里没有 `MySQL`），
 * 所以调用两次也不会累积出怪句子。
 */
export function applyPronunciation(text: string): string {
  if (!text) return text;
  return text.replace(PATTERN, (word) => SPOKEN.get(word) ?? word);
}
