// SPDX-License-Identifier: Apache-2.0
/**
 * 手势文案的取用入口（`i18n/messages/zh-CN.shellGestures.ts` 的双语登记）。
 *
 * 为什么要在这里 `registerLanguagePack` 而不是把键加进 `messages/zh-CN.ts` 的聚合：
 * 本批次 `messages/zh-CN.ts` / `messages/en-US.ts` 由别的泳道独占写入（两边同时改同一张
 * 聚合表=互相覆盖），而语言包本身又必须成对出现（`messageNamespaces` 守卫按文件名配对）。
 * 自带登记把"归属"收进本文件：谁 import 它，谁就顺带拿到这 3 条文案。
 *
 * 编译期的 `MessageKey` 是 `keyof ZhCNMessages`，即只认聚合表里的键；本命名空间没进聚合
 * 表，所以下面有一处**唯一**的类型断言（`asMessageKey`）。运行时的查找是真正的语言包
 * 查找（`translate`），切语言、占位符、缺失告警全部照旧。
 */
import { registerLanguagePack, translate } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";
import { getSnapshot } from "../../i18n/localeStore";
import enUSShellGestures from "../../i18n/messages/en-US.shellGestures";
import zhCNShellGestures from "../../i18n/messages/zh-CN.shellGestures";

// 模块加载即登记：`features/shortcuts/registry.ts` 引用了下面的 label key，
// 而设置页的快捷键表是用模块级 `t()` 渲染的——晚一步登记就会显示成裸 key。
registerLanguagePack("zh-CN", asLanguagePack(zhCNShellGestures));
registerLanguagePack("en-US", asLanguagePack(enUSShellGestures));

export type ShellGestureMessageKey = keyof typeof zhCNShellGestures;

/**
 * 本命名空间的键 → 聚合 `MessageKey`（运行时真的登记过，编译期只能断言）。
 *
 * 这处断言是"命名空间自带登记"的**已知代价**：`registerLanguagePack` 的入参类型是
 * `Partial<Record<MessageKey, string>>`，而 `MessageKey` 只认聚合表。等本批次的聚合表
 * 归属放开（把这些键并进 `messages/zh-CN.ts`）时，把这两个断言连同 `asMessageKey`
 * 一起删掉即可——除此之外没有别的耦合。
 */
type LanguagePack = Parameters<typeof registerLanguagePack>[1];

function asMessageKey(key: ShellGestureMessageKey): MessageKey {
  return key as unknown as MessageKey;
}

function asLanguagePack(pack: typeof zhCNShellGestures | typeof enUSShellGestures): LanguagePack {
  return pack as unknown as LanguagePack;
}

/** 取手势文案（跟随当前界面语言）。 */
export function tShellGesture(key: ShellGestureMessageKey, params?: MessageParams): string {
  return translate(getSnapshot().locale, asMessageKey(key), params);
}

/** 键盘动作在快捷键表里的显示名（`registry.ts` 的 `labelKey`）。 */
export const SHELL_GESTURE_LABEL_KEYS = {
  refreshView: asMessageKey("shellGestures.action.refresh"),
  goHome: asMessageKey("shellGestures.action.goHome"),
} as const;
