// SPDX-License-Identifier: Apache-2.0
/** 来源核对 / 事实锁 / 候选 / 用量文案出口（`zh-CN.provenance.ts` 已由 lead 聚合登记）。 */
import { t } from "../../i18n";
import type { MessageParams } from "../../i18n";
import provenance from "../../i18n/messages/zh-CN.provenance";

export type ProvenanceMessageKey = keyof typeof provenance;

/** 取文案；key 类型来自本命名空间，写错编译期报错。 */
export function pt(key: ProvenanceMessageKey, params?: MessageParams): string {
  return t(key, params);
}

export { provenance as provenanceMessages };
