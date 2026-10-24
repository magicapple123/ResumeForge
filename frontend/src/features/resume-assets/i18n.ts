// SPDX-License-Identifier: Apache-2.0
/**
 * 表达资产库的文案出口（W17）。
 *
 * 文案本体在 `i18n/messages/zh-CN.assets.ts`（本批新增命名空间）。lead 在 `zh-CN.namespaces.ts`
 * 聚合后 `t("assets.…")` 直接命中；登记之前用本文件兜底，避免组件渲染出 key 本身。
 * 与 `features/resume-research/i18n.ts` 同一写法（两处都是"命名空间尚未聚合"的过渡层）。
 */
import { t } from "../../i18n";
import type { MessageKey, MessageParams } from "../../i18n";
import assets from "../../i18n/messages/zh-CN.assets";

export type AssetsMessageKey = keyof typeof assets;

/** 取资产库文案。参数插值与 `t()` 一致（`{name}`）。 */
export function at(key: AssetsMessageKey, params?: MessageParams): string {
  const translated = t(key as MessageKey, params);
  if (translated !== key) return translated;
  const template: string = assets[key];
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}

export { assets as assetsMessages };
