// SPDX-License-Identifier: Apache-2.0
/**
 * 「恢复到打开这份简历时的值」的唯一实现（2026-10-24 用户口径）。
 *
 * ## 与「双击标题 / 随模板」的区别
 *
 * 那两处做的是**删键**：把 `format_config` 里的覆盖删掉，回到模板（或版式预设）的默认值。
 * 用户这次要的是另一件事——"我刚把行距拖坏了，退回我进来时看到的 1.40"。
 * 两者的差别在**基线从哪来**：
 *
 * | 动作 | 目标值 | 基线 |
 * |---|---|---|
 * | 双击标题 / 「随模板」 | 模板或版式预设的默认值 | 目录（`catalog`） |
 * | 参数右侧那颗 ↺ | 打开这一屏时的实际取值（可能本身就是一次覆盖） | `ResumeZoomModal` 捕获的快照 |
 *
 * 所以恢复**不能**用 `delete` 一刀切：基线里那个键如果是用户上次存下的覆盖，
 * 删掉反而会跳到模板默认值——那是第三个值，不是"我打开时看到的那个"。
 *
 * ## 为什么按"键组"而不是按控件
 *
 * 一个滑杆可能同时管多个键（页边距的总值 + 四条支路），它们必须一起进出，
 * 否则"恢复页边距"会留下一条支路继续生效。键组是数据，不是控件属性，
 * 因此放在这里而不是散在各控件里。
 */
import type { ResumeFormatConfig } from "../types/resumeFormat";

/** 页边距：总值 + 四条支路，任何一条不同都算"这一项被改过"。 */
export const PAGE_MARGIN_KEYS = [
  "page_padding",
  "page_padding_top",
  "page_padding_right",
  "page_padding_bottom",
  "page_padding_left",
] as const;

/** 字号：档位是 layout 顶层字段，系数在 `format_config` 里——两个都要一起恢复。 */
export const FONT_ADJUST_KEY = "font_scale_adjust";

/** 单个键取值是否相同：数组 / 对象走序列化比较（`section_order` 是数组）。 */
function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined) return false;
  if (typeof a === "object" || typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** 这一组键里有没有任何一项与基线不同（含"基线没有、现在有"与"基线有、现在删了"）。 */
export function formatKeysDiffer(
  current: ResumeFormatConfig | undefined,
  baseline: ResumeFormatConfig | undefined,
  keys: readonly string[],
): boolean {
  return keys.some((key) => !sameValue((current ?? {})[key], (baseline ?? {})[key]));
}

/**
 * 把这一组键的取值（**包括"不存在"**）从基线搬到当前，其它键原样保留。
 *
 * 返回新对象（调用方据此 setState / 提交重排），不修改入参。
 */
export function restoreFormatKeys(
  current: ResumeFormatConfig | undefined,
  baseline: ResumeFormatConfig | undefined,
  keys: readonly string[],
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(current ?? {}) };
  for (const key of keys) {
    const value = (baseline ?? {})[key];
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}
