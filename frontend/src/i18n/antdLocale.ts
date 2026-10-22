// SPDX-License-Identifier: Apache-2.0
/**
 * 语言标识 → antd 的 `locale` 对象。**全项目唯一一处**做这个映射的地方。
 *
 * antd 的组件文案（分页「上一页」、日期选择器的月份名、`Modal` 的按钮…）来自它自己
 * 的语言包，与我们的语言包是两套数据。允许在多处各自 `import zhCN from "antd/locale/zh_CN"`
 * ，迟早会出现"界面切到英文、分页还是中文"的偏差——所以映射只留在这里，
 * `ThemeProvider` 通过 `useLocale()` + 本函数取值，不再直接 import antd 的语言包。
 *
 * 本文件在批 3 只提供映射，**不改 `ThemeProvider`**（接线在批 5）。
 */
import zhCN from "antd/locale/zh_CN";
import type { Locale as AntdLocale } from "antd/es/locale";
import { DEFAULT_LOCALE } from "./index";
import type { Locale } from "./index";

/**
 * `Record<Locale, AntdLocale>`：每加一个语言都必须在这里补一行，
 * 漏了编译期就报错（比运行期回落到中文好）。
 */
const ANTD_LOCALES: Record<Locale, AntdLocale> = {
  "zh-CN": zhCN,
};

/**
 * 取 antd 的语言包。
 *
 * 认不出的值回落到默认语言：这个函数只吃 `Locale`，但运行时数据（将来从 localStorage
 * 或 URL 读）可能比类型宽，兜一层归位比让 antd 拿到 `undefined` 安全
 * （`undefined` 会让它回落到**英文**默认包，反而不是我们要的"未知就中文"）。
 */
export function antdLocale(locale: Locale): AntdLocale {
  return ANTD_LOCALES[locale] ?? ANTD_LOCALES[DEFAULT_LOCALE];
}
