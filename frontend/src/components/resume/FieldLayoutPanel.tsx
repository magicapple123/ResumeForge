// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目字段排版」面板（W4）：按分区调整**承载区补充字段**的每行字段数、顺序与独占行。
 *
 * ## 为什么是"分区 + 字段顺序"而不是拖拽画布
 *
 * 教育 / 实习 / 项目等条目的补充字段在纸面上此前一律逐字段左对齐一行；字段一多，左边挤成
 * 一列、右半边空着。用户要的是"这几个字段两两一行、研究方向自己一行"。因此这里只有三个
 * 自由度（列数 / 顺序 / 独占行）——与后端 `format_config.field_layout` 一一对应，HTML /
 * PDF / Word / Markdown 四格式共用同一份装箱结果（后端 `profile_field_rows`）。
 *
 * 数据读写与归一化在 `features/resume-layout/fieldLayout.ts`（纯函数，可单测）；本文件只管
 * 交互。一次修改 = 一次 `onChange`（宿主记一步历史并重排预览），面板不自己存草稿。
 */
import { ArrowDownOutlined, ArrowUpOutlined } from "@ant-design/icons";
import { Button, Segmented, Select, Switch, Typography } from "antd";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { ResumeLayout } from "../../types";
import {
  COLUMN_LABEL_KEYS,
  FIELD_LAYOUT_SECTIONS,
  SECTION_LABEL_KEYS,
  defaultSectionLayout,
  fieldLabelKey,
  isSectionDefault,
  moveField,
  readFieldLayout,
  withSectionFieldLayout,
} from "../../features/resume-layout/fieldLayout";
import type {
  FieldLayoutColumns,
  FieldLayoutSection,
  SectionFieldLayout,
} from "../../features/resume-layout/fieldLayout";

interface Props {
  /** 这份简历草稿态的版式（format_config 里带 field_layout）。 */
  layout: ResumeLayout;
  disabled?: boolean;
  /** 一次修改 = 一次提交（宿主记历史并重排预览）。 */
  onChange: (next: ResumeLayout) => void;
}

export default function FieldLayoutPanel({ layout, disabled = false, onChange }: Props) {
  useLocale();
  const [section, setSection] = useState<FieldLayoutSection>("education");
  const configured = useMemo(() => readFieldLayout(layout), [layout]);
  const current = configured[section] ?? defaultSectionLayout(section);
  const commit = (next: SectionFieldLayout | null) =>
    onChange(withSectionFieldLayout(layout, section, next));
  const disabledProp = disabled || undefined;

  return (
    <div className="resume-field-layout">
      <Typography.Text type="secondary">{t("typography.fieldLayout.hint")}</Typography.Text>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.sectionLabel")}</span>
        <Select<FieldLayoutSection>
          aria-label={t("typography.fieldLayout.sectionLabel")}
          value={section}
          disabled={disabledProp}
          options={FIELD_LAYOUT_SECTIONS.map((key) => ({
            value: key,
            label: t(SECTION_LABEL_KEYS[key]),
          }))}
          onChange={(value) => setSection(value)}
          style={{ minWidth: 160, flex: "1 1 auto" }}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <span>{t("typography.fieldLayout.columnsLabel")}</span>
        <Segmented<FieldLayoutColumns>
          aria-label={t("typography.fieldLayout.columnsLabel")}
          value={current.columns}
          disabled={disabledProp}
          options={([1, 2, 3] as FieldLayoutColumns[]).map((value) => ({
            value,
            label: t(COLUMN_LABEL_KEYS[value]),
          }))}
          onChange={(value) => commit({ ...current, columns: value })}
        />
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginTop: 10,
        }}
      >
        <Typography.Text strong>{t("typography.fieldLayout.fieldsTitle")}</Typography.Text>
        <Typography.Text type="secondary">{t("typography.fieldLayout.solo")}</Typography.Text>
      </div>
      <ul style={{ listStyle: "none", margin: "4px 0 0", padding: 0 }}>
        {current.order.map((field, index) => {
          const label = t(fieldLabelKey(section, field));
          const solo = current.solo.includes(field);
          return (
            <li
              key={field}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 0" }}
            >
              <span
                style={{
                  flex: "1 1 auto",
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
              <Button
                size="small"
                type="text"
                icon={<ArrowUpOutlined />}
                aria-label={t("typography.fieldLayout.moveUp", { label })}
                disabled={disabled || index === 0 || undefined}
                onClick={() => commit({ ...current, order: moveField(current.order, index, -1) })}
              />
              <Button
                size="small"
                type="text"
                icon={<ArrowDownOutlined />}
                aria-label={t("typography.fieldLayout.moveDown", { label })}
                disabled={disabled || index === current.order.length - 1 || undefined}
                onClick={() => commit({ ...current, order: moveField(current.order, index, 1) })}
              />
              <Switch
                size="small"
                checked={solo}
                aria-label={t("typography.fieldLayout.soloAria", { label })}
                disabled={disabledProp}
                onChange={(checked) =>
                  commit({
                    ...current,
                    solo: checked
                      ? [...current.solo, field]
                      : current.solo.filter((item) => item !== field),
                  })
                }
              />
            </li>
          );
        })}
      </ul>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginTop: 8,
        }}
      >
        <Typography.Text type="secondary">
          {t("typography.fieldLayout.summary", {
            columns: current.columns,
            solo: current.solo.length,
          })}
        </Typography.Text>
        <Button
          size="small"
          disabled={disabled || isSectionDefault(section, current) || undefined}
          onClick={() => commit(null)}
        >
          {t("typography.fieldLayout.reset")}
        </Button>
      </div>
    </div>
  );
}
