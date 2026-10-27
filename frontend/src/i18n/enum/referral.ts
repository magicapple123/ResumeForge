// SPDX-License-Identifier: Apache-2.0
/**
 * 内推状态的「协议值 → 语言包 key」映射（页面层）。
 *
 * **键是协议值**：`active` / `submitted` / `closed` / `invalid` 会原样提交给后端并参与
 * 校验（`types/referral.ts` 的 `REFERRAL_STATUSES`），永远不翻；这里只把"协议值 →
 * 语言包 key"这一层集中起来，`types/referral.ts` 一个字都没动。
 *
 * 模块作用域不能求值 `t()`（语言会被钉死在模块加载那一刻），因此本文件只放 key 表与
 * 纯查表函数；组件在渲染期再 `t(...)`，切语言会跟着重渲染。
 */
import type { MessageKey } from "../index";
import type { ReferralStatus } from "../../types";

/** 内推状态：下拉 `value` 仍是协议值，只有展示名走语言包。 */
export const REFERRAL_STATUS_LABEL_KEYS: Record<ReferralStatus, MessageKey> = {
  active: "enumsReferral.referralStatus.active",
  submitted: "enumsReferral.referralStatus.submitted",
  closed: "enumsReferral.referralStatus.closed",
  invalid: "enumsReferral.referralStatus.invalid",
};

/**
 * 只认自己的键：原型链上的 `constructor` / `__proto__` 不能变成显示名
 * （与 `i18n/enum/claims.ts` 同一条防御）。
 */
function lookup(labels: Record<ReferralStatus, MessageKey>, value: string): MessageKey | undefined {
  return Object.prototype.hasOwnProperty.call(labels, value)
    ? labels[value as ReferralStatus]
    : undefined;
}

/** 未知取值返回 `undefined`，调用方回退成后端下发的原值（不丢信息）。 */
export function referralStatusLabelKey(value: string): MessageKey | undefined {
  return lookup(REFERRAL_STATUS_LABEL_KEYS, value);
}
