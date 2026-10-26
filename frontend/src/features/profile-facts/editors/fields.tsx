// SPDX-License-Identifier: Apache-2.0
/**
 * 九类事实编辑器共用的字段渲染器（薄封装，L2）：标签、占位符、必填提示全部走 `t()`，
 * 内部只输出 antd 的 `Form.Item` + 标准控件，不引入新样式。
 *
 * 日期沿用「我的资料」既有的 `PartialDateSelect`（支持只有年/年月/年月日与「至今」），
 * 链接只校验 http(s)、不抓取内容（抓取与可用性由用户自己核对）。
 */
import { Form, Input, Select } from "antd";
import type { ReactNode } from "react";
import PartialDateSelect from "../../../components/profile/PartialDateSelect";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { MessageKey } from "../../../i18n";
import { httpUrlRule } from "./fieldHelpers";

interface TextFieldProps {
  name: string;
  labelKey: MessageKey;
  placeholderKey?: MessageKey;
  requiredMessageKey?: MessageKey;
  maxLength?: number;
  extra?: ReactNode;
}

export function FactTextField({
  name,
  labelKey,
  placeholderKey,
  requiredMessageKey,
  maxLength,
  extra,
}: TextFieldProps) {
  useLocale();
  return (
    <Form.Item
      name={name}
      label={t(labelKey)}
      extra={extra}
      rules={
        requiredMessageKey
          ? [{ required: true, whitespace: true, message: t(requiredMessageKey) }]
          : undefined
      }
    >
      <Input maxLength={maxLength} placeholder={placeholderKey ? t(placeholderKey) : undefined} />
    </Form.Item>
  );
}

/** 多行字段：列表类（每行一条）与长文本共用同一个渲染器，分解/合并只发生在保存边界。 */
export function FactTextAreaField({
  name,
  labelKey,
  placeholderKey,
  maxLength,
  rows = 3,
  extra,
}: TextFieldProps & { rows?: number }) {
  useLocale();
  return (
    <Form.Item name={name} label={t(labelKey)} extra={extra}>
      <Input.TextArea
        rows={rows}
        maxLength={maxLength}
        placeholder={placeholderKey ? t(placeholderKey) : undefined}
      />
    </Form.Item>
  );
}

export function FactDateField({
  name,
  labelKey,
  allowOngoing,
}: {
  name: string;
  labelKey: MessageKey;
  allowOngoing?: boolean;
}) {
  useLocale();
  return (
    <Form.Item name={name} label={t(labelKey)}>
      <PartialDateSelect label={t(labelKey)} allowOngoing={allowOngoing} />
    </Form.Item>
  );
}

export function FactUrlField({ name, labelKey, placeholderKey }: Omit<TextFieldProps, "extra">) {
  useLocale();
  return (
    <Form.Item name={name} label={t(labelKey)} rules={[httpUrlRule()]}>
      <Input placeholder={placeholderKey ? t(placeholderKey) : undefined} />
    </Form.Item>
  );
}

export function FactSelectField<T extends string>({
  name,
  labelKey,
  options,
  extra,
}: {
  name: string;
  labelKey: MessageKey;
  options: { value: T; label: string }[];
  extra?: ReactNode;
}) {
  useLocale();
  return (
    <Form.Item name={name} label={t(labelKey)} extra={extra}>
      <Select options={options} />
    </Form.Item>
  );
}
