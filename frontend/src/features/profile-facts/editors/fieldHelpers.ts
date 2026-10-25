// SPDX-License-Identifier: Apache-2.0
/**
 * 九类事实编辑器共用的**纯函数**（与组件分开存放）：链接校验规则与枚举 options 翻译。
 *
 * 单独成文件的原因很具体：`fields.tsx` 只导出组件，React Fast Refresh 才能在该文件
 * 被编辑时只热更新组件；混着导出常量/函数会让整页刷新。
 */
import { t } from "../../../i18n";
import type { FormRule } from "antd";
import type { FactStatusOption } from "../constants";
import { isHttpUrl } from "../factModel";

/** 字段设置里被隐藏的默认字段 key（契约 §3：界面不渲染、服务端保留旧值）。 */
export type HiddenFields = readonly string[];

/** 该默认字段是否被隐藏：编辑器/展示层共用同一个判断，避免各写一份 includes。 */
export function isFieldHidden(hidden: HiddenFields, key: string): boolean {
  return hidden.includes(key);
}

/** 链接校验：空串视为未填；只接受 http(s)，与后端 422 口径一致。 */
export function httpUrlRule(): FormRule {
  return {
    validator: (_rule, value: unknown) => {
      const text = typeof value === "string" ? value.trim() : "";
      if (!text || isHttpUrl(text)) return Promise.resolve();
      return Promise.reject(new Error(t("research.link.invalid")));
    },
  };
}

/** 契约枚举 → antd Select options（label 在这里翻译一次，调用方不重复拼）。 */
export function translateOptions<T extends string>(
  options: readonly FactStatusOption<T>[],
): { value: T; label: string }[] {
  return options.map((option) => ({ value: option.value, label: t(option.labelKey) }));
}
