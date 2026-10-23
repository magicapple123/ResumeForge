// SPDX-License-Identifier: Apache-2.0
/**
 * 语言 Provider：把 `locale` 与它的 `t` 一起下发，并把 `<html lang>` 同步到同一次值的改变。
 *
 * 本文件**只导出组件**；Context 与 `useI18n()` / `useLocale()` 在 `i18nContext.ts`
 * （2026-10-23 拆出，见那里的说明，也解释了"没有 Provider 时回落默认语言"这条约定）。
 *
 * ## 为什么 `<html lang>` 在这里同步
 *
 * 屏幕阅读器与浏览器的断行/拼写检查都看这个属性。它必须和界面语言同源，否则会出现
 * "界面中文、朗读按英文念"这种只在无障碍场景才暴露的错。`index.html` 里已有的
 * `<html lang="zh-CN">` 与本处的首帧值一致，因此不会闪。
 */
import { useEffect, useMemo } from "react";
import type { ReactNode } from "react";
import { DEFAULT_LOCALE, translate } from "./index";
import type { Locale } from "./index";
import { I18nContext } from "./i18nContext";
import type { I18nContextValue } from "./i18nContext";

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
