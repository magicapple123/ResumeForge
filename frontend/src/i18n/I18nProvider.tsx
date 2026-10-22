// SPDX-License-Identifier: Apache-2.0
/**
 * 语言 Context：把 `locale` 与它的 `t` 一起下发，并把 `<html lang>` 同步到同一次值的改变。
 *
 * ## 没有 Provider 时也必须能用
 *
 * `useLocale()` / `useI18n()` 在读不到 Provider 时**返回默认语言**（`zh-CN`），不是一个
 * 会抛错的空 context。理由很实在：290+ 个既有测试文件都是单独渲染一个组件的，
 * 如果这里的默认值是"必须包 wrapper"，那每个测试都得改一行——这等于把一次文案改造
 * 摊派给整条测试链，而且以后每加一个测试都会再踩一次。
 *
 * ## 为什么 `<html lang>` 在这里同步
 *
 * 屏幕阅读器与浏览器的断行/拼写检查都看这个属性。它必须和界面语言同源，否则会出现
 * "界面中文、朗读按英文念"这种只在无障碍场景才暴露的错。`index.html` 里已有的
 * `<html lang="zh-CN">` 与本处的首帧值一致，因此不会闪。
 */
import { createContext, useContext, useEffect, useMemo } from "react";
import type { ReactNode } from "react";
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

const I18nContext = createContext<I18nContextValue>(DEFAULT_I18N);

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

interface Props {
  /** 当前语言；缺省默认语言。将来做语言切换时由上层状态喂进来。 */
  locale?: Locale;
  children: ReactNode;
}

export default function I18nProvider({ locale = DEFAULT_LOCALE, children }: Props) {
  useEffect(() => {
    // 无障碍与断行都看它：界面语言变了，文档语言必须跟着变。
    document.documentElement.lang = locale;
  }, [locale]);

  // 值随 locale 变：包一层 useMemo，免得每次渲染都让所有消费者重渲染一遍。
  const value = useMemo<I18nContextValue>(
    () => ({ locale, t: (key, params) => translate(locale, key, params) }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}
