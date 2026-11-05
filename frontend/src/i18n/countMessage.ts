// SPDX-License-Identifier: Apache-2.0
/**
 * 带计数的文案：英文在 `count === 1` 时要换单数名词（`1 page` 而不是 `1 pages`）。
 *
 * ## 为什么是"一对 key + 一处判断"
 *
 * 仓库的 `translate()` 只做 `{name}` 替换，**没有** `Intl.PluralRules`、也没有
 * `_one` / `_other` 之类的复数机制。中文语言包的规矩又明确写了「一条 key 就是一句完整
 * 的话」，禁止把句子拆成词块再拼——所以英文的单数句是一条**独立的整句 key**
 * （`...One`），而不是在译文上做字符串替换。
 *
 * 中文没有单复数，`...One` 与复数键在 zh 包里指向同一句话（见各 zh 包里的注释），
 * 因此 `MessageKey` 两侧同名、`t()` 依然类型安全，**中文渲染逐字不变**。
 *
 * ## 为什么判断只在这里
 *
 * 页数标签那一句在三个地方渲染（篇幅段控的选项、页缩略图的页数摘要、交付面板的核对
 * 行）。若各写一个 `count === 1 ? ... : ...`，三处迟早不同步——这正是中文语言包规矩里
 * 「一词一义」要挡的那类缺陷。组件只声明"用哪一对 key"，条件只在这一处。
 */
import { t } from "./index";
import type { MessageKey } from "./localeTypes";

/**
 * 按计数在一对 key 里选一条并套参数。
 *
 * @param one 单数整句（`count === 1` 时使用）
 * @param other 复数整句（其余所有计数）
 * @param name 句子里计数的占位符名（`count` / `limit` / `pages` …）
 * @param count 计数本身；**只有 `=== 1` 走单数**
 */
export function countMessage(
  one: MessageKey,
  other: MessageKey,
  name: string,
  count: number,
): string {
  return t(count === 1 ? one : other, { [name]: count });
}

/** 「篇幅上限」段控的选项文案：`1 page` / `3 pages`（上限为 0 的「不限」另有一条 key）。 */
export function pageLimitOptionLabel(count: number): string {
  return countMessage(
    "sections.templateControls.pageLimitPagesOne",
    "sections.templateControls.pageLimitPages",
    "count",
    count,
  );
}

/** 页缩略图的页数摘要：「已达上限」那句。 */
export function paginationLimitReachedLabel(limit: number): string {
  return countMessage(
    "pagination.thumbnails.limitReachedOne",
    "pagination.thumbnails.limitReached",
    "limit",
    limit,
  );
}

/** 交付面板核对行的同一句话（与页缩略图是两个命名空间、两套文案）。 */
export function deliveryLimitReachedLabel(limit: number): string {
  return countMessage(
    "delivery.preview.limitReachedOne",
    "delivery.preview.limitReached",
    "limit",
    limit,
  );
}
