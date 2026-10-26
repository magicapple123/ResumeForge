// SPDX-License-Identifier: Apache-2.0
import zhCN from "./messages/zh-CN";
import enUS from "./messages/en-US";
import { advanceRevision } from "./localeStore";
import type { Locale, MessageKey, MessageParams } from "./localeTypes";

type Pack = Readonly<Partial<Record<MessageKey, string>>>;
type Namespace = Readonly<Record<string, string>>;
const messages = new Map<Locale, Map<string, Namespace>>();

export function registerLanguagePack(locale: Locale, pack: Pack): void {
  const namespaces = new Map(messages.get(locale) ?? []);
  for (const [key, value] of Object.entries(pack)) {
    const namespace = key.split(".", 1)[0];
    const entries = { ...(namespaces.get(namespace) ?? {}) };
    entries[key] = value;
    namespaces.set(namespace, entries);
  }
  messages.set(locale, namespaces);
  advanceRevision();
}

registerLanguagePack("zh-CN", zhCN);
registerLanguagePack("en-US", enUS);

export function translate(locale: Locale, key: MessageKey, params?: MessageParams): string {
  const namespace = key.split(".", 1)[0];
  const pack = messages.get(locale);
  const suffix = key.slice(key.indexOf(".") + 1);
  const leaf = key.slice(key.lastIndexOf(".") + 1);
  const template =
    pack?.get(namespace)?.[key] ??
    pack?.get("common")?.[`common.${suffix}`] ??
    pack?.get("common")?.[`common.action.${leaf}`] ??
    pack?.get("common")?.[`common.${leaf}`];
  if (template === undefined) {
    if (import.meta.env.DEV) console.warn(`[i18n] Missing message key: ${key} (${locale})`);
    return key;
  }
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (placeholder: string, name: string) =>
    params[name] === undefined ? placeholder : String(params[name]),
  );
}
