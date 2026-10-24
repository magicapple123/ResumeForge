// SPDX-License-Identifier: Apache-2.0
/** 版面优化文案出口（`zh-CN.optimizer.ts` 待 lead 在 `zh-CN.namespaces.ts` 聚合）。 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";
import optimizer from "../../i18n/messages/zh-CN.optimizer";

export type OptimizerMessageKey = keyof typeof optimizer;

export function ot(key: OptimizerMessageKey, params?: MessageParams): string {
  const translated = t(key as MessageKey, params);
  if (translated !== key) return translated;
  const template: string = optimizer[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

export { optimizer as optimizerMessages };
