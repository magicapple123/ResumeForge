// SPDX-License-Identifier: Apache-2.0
/**
 * 自研轻量 i18n 运行时：`t()` / `translate()` + 语言包 + `{name}` 插值。
 *
 * ## 为什么自研而不是 react-i18next
 *
 * 本次真实的交付物是**key 形态约定**与"一处逻辑一份实现"，不是一个功能齐全的 i18n 引擎。
 * 当前只有十来个 key、一个语言、没有复数与命名空间，引 3 个包换来的能力一条都用不上。
 *
 * ## 什么时候该换成 react-i18next
 *
 * 出现下面任一情况，就把 `react-i18next` 装进来，**只替换本文件**（`t()` 的调用点一行都不用改，
 * 因为 key 形态完全一致：扁平点分 key + `{name}` 插值）：
 *
 * 1. 需要**复数**、性别、序数（`{count} items` 之类）——本项目现在靠"多写一条 key"绕开；
 * 2. 需要按**命名空间懒加载**语言包（界面变大到首屏不该带上全部文案时）；
 * 3. 语言包超过约 **500 条**——那时手写的 `keyof typeof zhCN` 类型安全会成为负担，
 *    而 i18next 的类型生成与缺失 key 检查已经成熟。
 *
 * ## 三条硬约束（详见 `messages/zh-CN.ts` 头部）
 *
 * 1. 新增界面文案一律 `t("...")`，不许在 `.tsx` 里写中文字面量；
 * 2. 不许把中文当 key；
 * 3. 纸面固定文案不进前端语言包——它在后端 `resume_labels.py`。
 *
 * ## 没有 Provider 也能用
 *
 * `t()` 是**模块级函数**，直接读默认语言包；`useLocale()` 在没有 Provider 时返回默认
 * locale。这样 290+ 个既有测试文件、以及所有单独渲染组件的测试**一行都不用加 wrapper**。
 */
import zhCN from "./messages/zh-CN";

/** 默认语言：与 `index.html` 的 `<html lang="zh-CN">` 一致。 */
export const DEFAULT_LOCALE = "zh-CN";

/**
 * 支持的语言列表。
 *
 * **只有一个值**，所以界面上没有任何语言切换入口（本需求不做设置项）。将来真要加
 * `en-US`，改这里 + 补一份语言包即可，`t()` 的调用点不受影响。
 */
export const SUPPORTED_LOCALES = ["zh-CN"] as const;

/** 语言标识。由 `SUPPORTED_LOCALES` 推导，避免两处各写一份。 */
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** 合法的文案 key：`keyof` 语言包，写错一个字编译期就报错。 */
export type MessageKey = keyof typeof zhCN;

/** 插值参数：`{name}` 里的 `name`。 */
export type MessageParams = Record<string, string | number>;

/** 语言标识 → 语言包。`Record<Locale, …>` 保证每加一个 locale 都必须补一份包。 */
const MESSAGES: Record<Locale, Record<string, string>> = {
  "zh-CN": zhCN,
};

/**
 * 把 `{name}` 替换成参数值。
 *
 * 认不出的占位符**原样保留**（而不是替换成空串）：那样界面上会看到一个 `{typo}`，
 * 一眼就能看出是缺参，比静默消失的句子好定位。
 */
function interpolate(template: string, params?: MessageParams): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

/**
 * 按指定语言取文案。
 *
 * 缺 key 时（只可能是动态拼出来的 key，静态 key 过不了 `tsc`）：开发态 `console.warn`
 * 并**返回 key 本身**——界面上出现 `resume.language.label` 这种文字，比出现空白更容易
 * 被发现；生产环境不刷告警，行为一致。
 */
export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const pack = MESSAGES[locale] ?? MESSAGES[DEFAULT_LOCALE];
  const template = pack[key];
  if (template === undefined) {
    if (import.meta.env.DEV) {
      console.warn(`[i18n] 缺少文案 key：「${key}」（语言 ${locale}）`);
    }
    return key;
  }
  return interpolate(template, params);
}

/**
 * 取默认语言的文案。
 *
 * 模块级函数，**不依赖 React context**：放在 `useI18n().t` 拿不到的地方（工具函数、
 * 模块级常量表）也能用。组件里要用"当前 locale 的 t"请用 `useI18n()`。
 */
export function t(key: MessageKey, params?: MessageParams): string {
  return translate(DEFAULT_LOCALE, key, params);
}
