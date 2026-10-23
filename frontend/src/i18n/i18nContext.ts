// SPDX-License-Identifier: Apache-2.0
/**
 * 语言 Context 与它的两个读取钩子。
 *
 * 从 `I18nProvider.tsx` 拆出来（2026-10-23）：那个文件是组件文件，再导出 `useI18n` /
 * `useLocale` 会让 `react-refresh/only-export-components` 失效（改 provider 会整块
 * 刷新所有消费者）。Context 本来就该和它的钩子住在一起，`I18nProvider` 只负责往下发值。
 *
 * ## 没有 Provider 时也必须能用
 *
 * `useLocale()` / `useI18n()` 在读不到 Provider 时**返回默认语言**（`zh-CN`），不是一个
 * 会抛错的空 context。理由很实在：290+ 个既有测试文件都是单独渲染一个组件的，
 * 如果这里的默认值是"必须包 wrapper"，那每个测试都得改一行——这等于把一次文案改造
 * 摊派给整条测试链，而且以后每加一个测试都会再踩一次。
 */
import { createContext, useContext } from "react";
import { DEFAULT_LOCALE, translate } from "./index";
import type { Locale, MessageKey, MessageParams } from "./index";

/** Context 的值：当前语言 + 绑定到该语言的取文案函数。 */
export interface I18nContextValue {
  locale: Locale;
  t: (key: MessageKey, params?: MessageParams) => string;
}

/**
 * 没有 Provider 时的默认值。
 *
 * `t` 直接取默认语言包——与模块级 `t()` 完全同一个行为，所以"包了 Provider"与
 * "没包"在只有一个语言时输出逐字相同。
 */
const DEFAULT_I18N: I18nContextValue = {
  locale: DEFAULT_LOCALE,
  t: (key, params) => translate(DEFAULT_LOCALE, key, params),
};

/** Context 本体；由 `I18nProvider` 供值，两个钩子读它。 */
export const I18nContext = createContext<I18nContextValue>(DEFAULT_I18N);

/** 取当前语言与它的 `t`。没有 Provider 也不报错（回落默认语言）。 */
export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/**
 * 只取当前语言。
 *
 * `ThemeProvider` 之类只关心"用哪套 antd 文案"的地方用它，避免为一个字符串
 * 拉进整个 `t`。
 */
export function useLocale(): Locale {
  return useContext(I18nContext).locale;
}
