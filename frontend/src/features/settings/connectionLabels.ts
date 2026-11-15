// SPDX-License-Identifier: Apache-2.0
/**
 * 「外部连接」页的显示名解析：**优先前端译文，认不出的 id 回落后端 label**。
 *
 * 为什么不是"直接用后端的 label"：后端只给中文（`services/credentials/registry.py` 的
 * `label` 字段注释写的就是"前端仍应经 i18n 包一层再做多语言"）。反过来"只用前端译文"
 * 也不行——后端新增一种凭据时注册表立刻有、语言包没有，那一行会变成空白。
 *
 * `translate` 对缺失的 key 原样返回 key 本身，所以"译文存在与否"可以用一次比较判断，
 * 不需要额外维护一份"有哪些 id"的清单（那会与 registry 漂移）。
 */

import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import type { ConnectionGroup, ConnectionItem } from "../../types";

/** 取译文；缺失时（返回的就是 key）回落后端给的原文。 */
function withFallback(key: MessageKey, fallback: string): string {
  const text = t(key);
  return text === key ? fallback : text;
}

/** 一条外部连接的显示名。 */
export function connectionItemLabel(item: ConnectionItem): string {
  return withFallback(`connections.item.${item.id}.label` as MessageKey, item.label);
}

/** 就地编辑说明（后端说"先去哪儿配"，前端说"在这里怎么改"）。 */
export function connectionItemHint(item: ConnectionItem): string {
  const key = `connections.item.${item.id}.hint` as MessageKey;
  return withFallback(key, item.write_hint || item.detail);
}

/** 状态的显示名：`saved` / `not_configured` / `session_only` / `modified` / `default`。 */
export function connectionStatusLabel(item: ConnectionItem): string {
  return withFallback(`connections.status.${item.status}` as MessageKey, item.status_label);
}

/** 存储方式的显示名（DPAPI / 无系统加密 / 仅内存 / 明文配置）。 */
export function connectionProtectionLabel(item: ConnectionItem): string {
  return withFallback(
    `connections.protection.${item.protection}` as MessageKey,
    item.protection_label,
  );
}

/** 整页那句存储说明里的方式名（同一条口径，只是没有 item 可传）。 */
export function connectionStorageLabel(kind: string, fallback: string): string {
  return withFallback(`connections.protection.${kind}` as MessageKey, fallback);
}

/** 分组标题与说明（A/B/C）。 */
export function connectionGroupLabel(group: ConnectionGroup): string {
  return withFallback(`connections.group.${group.id}` as MessageKey, group.label);
}

export function connectionGroupHint(group: ConnectionGroup): string {
  return withFallback(`connections.group.${group.id}Hint` as MessageKey, group.hint);
}

/** 掩码为空时的替身文案：已配但不回显（语义检索）与"没配"要分开说。 */
export function connectionMaskedText(item: ConnectionItem): string {
  if (item.masked) return item.masked;
  return item.key_configured ? t("connections.status.saved") : t("connections.emptyMask");
}

/** 状态标签的颜色（只用 antd 语义色名，不写死 hex）。 */
export function connectionStatusColor(item: ConnectionItem): "green" | "gold" | "blue" | "default" {
  switch (item.status) {
    case "saved":
      return "green";
    case "session_only":
      return "gold";
    case "modified":
      return "blue";
    default:
      return "default";
  }
}
