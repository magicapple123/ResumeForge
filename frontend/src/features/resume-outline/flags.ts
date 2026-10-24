// SPDX-License-Identifier: Apache-2.0
/**
 * 条目上的三个可选布尔字段（W06-BE 契约）：`hidden` / `lock_content` / `lock_layout`。
 *
 * ## 为什么"取消"是删键，而不是写 `false`
 *
 * `content` 在库里是 JSON，且内容指纹（`canonical_content_sha256`，同时是精确预览缓存键
 * 与交付快照的 `source_content_sha256`）按序列化结果算。旧记录没有这三个键；如果显隐/解锁
 * 时写 `hidden: false`，这份旧记录从此永远多一个键，指纹与历史值不同——缓存全失效、快照
 * 对不上，而用户什么也没改。所以：
 *
 * | 目标状态 | 写入 |
 * |---|---|
 * | `true` | `{ [flag]: true }` |
 * | `false` | **删除该键**（没有字段 = 不隐藏 / 不锁定） |
 *
 * 与 `schemas/resume_identity.py::OptionalIdentityMixin`（值为 `None` 的字段序列化时不输出）
 * 是同一套"没有信息就不占字节"的口径。
 *
 * ## 为什么读的时候要过一遍 `=== true`
 *
 * 后端/旧数据可能给出 `null`（Pydantic Optional 的默认值）或干脆没有键。两者语义都是
 * "没有设置"；用严格相等把它们收敛成一个布尔，避免 `undefined` 漏进 `aria-checked`
 * 之类的 DOM 属性（`aria-checked="undefined"` 是无效值）。
 */
import type { EntryFlag, EntryFlags } from "./types";

/** 三个字段的可选视图（六类条目接口上都已声明；这里用结构类型收敛读写）。 */
interface FlagCarrier {
  hidden?: boolean | null;
  lock_content?: boolean | null;
  lock_layout?: boolean | null;
}

/** 读出一个条目的三个布尔（字段缺失/null 都算 false）。入参允许 `unknown`：旧数据读得宽容。 */
export function readEntryFlags(entry: unknown): EntryFlags {
  const source = (entry ?? {}) as FlagCarrier;
  return {
    hidden: source.hidden === true,
    lockContent: source.lock_content === true,
    lockLayout: source.lock_layout === true,
  };
}

/**
 * 不可变地设置一个标志位，返回**新对象**（不改入参）。
 *
 * 显式传 `false` = 删除键（见文件头）；写入值恒为 `true`，不写 `false`。
 */
export function writeEntryFlag<T extends object>(entry: T, flag: EntryFlag, value: boolean): T {
  const source = entry as Record<string, unknown>;
  const next: Record<string, unknown> = { ...source };
  if (value) next[flag] = true;
  else delete next[flag];
  return next as T;
}

/** 当前值与目标值相同（命令幂等判据）。 */
export function flagMatches(entry: unknown, flag: EntryFlag, value: boolean): boolean {
  const source = (entry ?? {}) as FlagCarrier;
  return (source[flag] === true) === value;
}
