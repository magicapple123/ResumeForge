// SPDX-License-Identifier: Apache-2.0
/**
 * 「从模板选择」（#14D）：编辑单条队列条目时，把一条话术模板渲染进招呼语输入框。
 *
 * 变量用**当前条目**渲染（`{company}` / `{job_title}` / `{name}`），选中后立刻把渲染结果
 * 显示成一行预览——用户看到的与真投出去的一致。没有模板时不渲染这一块，编辑器保持原样。
 */
import { Select, Space, Typography } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ApplyQueueItem } from "../../../types";
import { greetingValuesOf, renderGreetingTemplate } from "./greetingTemplate";
import { useGreetingTemplates } from "./useGreetingTemplates";

export function GreetingTemplatePicker({
  item,
  onApply,
}: {
  /** 当前编辑的条目：变量从它取。 */
  item: ApplyQueueItem;
  /** 选中模板后把渲染结果交给调用方（写进招呼语输入框）。 */
  onApply: (text: string) => void;
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后占位符停在旧文案。
  useLocale();
  const { templates, loading, error } = useGreetingTemplates();
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  if (error) {
    // 模板读不到不该挡住手写招呼语：只提示一次，不给任何禁用。
    return (
      <Typography.Text type="secondary">{t("applyQueue.template.loadFailed")}</Typography.Text>
    );
  }
  if (templates.length === 0) return null;

  const selected = templates.find((template) => String(template.id) === chosen);
  const preview = selected ? renderGreetingTemplate(selected.body, greetingValuesOf(item)) : "";

  return (
    <Space orientation="vertical" size={2} style={{ width: "100%" }}>
      <Select
        style={{ width: 260 }}
        allowClear
        showSearch
        optionFilterProp="label"
        loading={loading}
        placeholder={t("applyQueue.template.pickPlaceholder")}
        aria-label={t("applyQueue.template.pick")}
        value={chosen}
        options={templates.map((template) => ({
          value: String(template.id),
          label: template.name,
        }))}
        onChange={(value: string | undefined) => {
          setChosen(value);
          const picked = templates.find((template) => String(template.id) === value);
          if (picked) onApply(renderGreetingTemplate(picked.body, greetingValuesOf(item)));
        }}
      />
      {selected && (
        <Typography.Text type="secondary">
          {t("applyQueue.template.preview", { text: preview })}
        </Typography.Text>
      )}
    </Space>
  );
}
