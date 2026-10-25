// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位标签的**纯规则**（W17 / D16）：解析输入、去重、限长限量。
 *
 * 与后端 resume_phrase.job_tags 的约束一致（≤20 个、每个 ≤32 字）；本地先把
 * 能判定的错误拒掉并给可读原因，不把超限内容发给服务端等 422。
 */

export const MAX_PHRASE_TAGS = 20;
export const MAX_PHRASE_TAG_LENGTH = 32;

/** 单个标签的规范写法：去首尾空白、连续空白压成一个空格。 */
export function normalizePhraseTag(raw: string): string {
  return String(raw ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ParsedPhraseTags {
  tags: string[];
  /** 被忽略的标签数量（超长/空）；界面给出一次性说明。 */
  ignored: number;
  /** 是否因数量上限被截断。 */
  truncated: boolean;
}

/** 标签数组归一化：去空、去重、限长、限量（保持用户输入顺序）。 */
export function normalizePhraseTags(raw: readonly string[]): ParsedPhraseTags {
  const tags: string[] = [];
  const seen = new Set<string>();
  let ignored = 0;
  let truncated = false;
  for (const value of raw) {
    const tag = normalizePhraseTag(value);
    if (!tag) continue;
    if (tag.length > MAX_PHRASE_TAG_LENGTH) {
      ignored += 1;
      continue;
    }
    const key = tag.toLocaleLowerCase();
    if (seen.has(key)) continue;
    if (tags.length >= MAX_PHRASE_TAGS) {
      truncated = true;
      continue;
    }
    seen.add(key);
    tags.push(tag);
  }
  return { tags, ignored, truncated };
}

/** 把用户输入的一段文字拆成标签（逗号/顿号/换行都算分隔符）。 */
export function parsePhraseTagsInput(text: string): ParsedPhraseTags {
  // i18n-ok: 全角逗号/顿号是用户输入的标签分隔符，不是界面文案
  return normalizePhraseTags(String(text ?? "").split(/[,，、\n]/));
}

/** 标签数组 → 编辑框文本（只用于回显，不参与提交）。 */
export function phraseTagsText(tags: readonly string[]): string {
  return tags.join(", ");
}
