// SPDX-License-Identifier: Apache-2.0
/**
 * 科研栏目的文案出口（W14）。
 *
 * ## 为什么需要这一个薄封装
 *
 * 文案本体在 `i18n/messages/zh-CN.research.ts`（本批新增的独立命名空间）。lead 会在
 * `zh-CN.ts` 里 `...research` 登记，登记之后 `t("research.…")` 就能直接通过 `MessageKey` 类型检查。
 *
 * 在登记落地之前，`MessageKey` 还不包含这些 key，所以这里做两件事：
 * 1. 用 `keyof typeof research` 给调用点**完整类型安全**（写错 key 编译期报错）；
 * 2. 对"全局语言包还没有这个 key"的情况回退到本命名空间的值，避免组件在登记前渲染 key 本身。
 *
 * 登记完成后：`t(key)` 直接命中，回退分支永不执行；届时可删掉 fallback（保留也不影响行为）。
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";
import research from "../../i18n/messages/zh-CN.research";

export type ResearchMessageKey = keyof typeof research;

/** 取科研栏目文案。参数插值与 `t()` 同一写法（`{name}`）。 */
export function rt(key: ResearchMessageKey, params?: MessageParams): string {
  const translated = t(key as MessageKey, params);
  if (translated !== key) return translated;
  // 全局语言包尚未登记该 key（登记前）：用本命名空间的值兜底，插值口径与 i18n 一致。
  const template: string = research[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

export { research as researchMessages };
