// SPDX-License-Identifier: Apache-2.0
/**
 * 双语版本的文案出口（W16）。与 `features/resume-assets/i18n.ts` 同一写法：
 * 命名空间在 lead 聚合前用本地兜底，聚合后 `t()` 直接命中。
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";
import bilingual from "../../i18n/messages/zh-CN.bilingual";

export type BilingualMessageKey = keyof typeof bilingual;

export function bt(key: BilingualMessageKey, params?: MessageParams): string {
  const translated = t(key as MessageKey, params);
  if (translated !== key) return translated;
  const template: string = bilingual[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

export { bilingual as bilingualMessages };
