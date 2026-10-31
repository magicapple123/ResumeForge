// SPDX-License-Identifier: Apache-2.0
/**
 * 基本信息（页眉）编辑器：姓名 / 姓名旁小字 / 求职意向 / 联系方式 / 照片 五类页眉位置。
 *
 * 页眉 item 是 v2 的一等公民（plan §3.3），所以制作台必须能改它——否则用户在 v2 里
 * 反而改不了姓名与联系方式。位置用 Select 改（与条目的拖拽等价，键盘可达）。
 */
import { DeleteOutlined } from "@ant-design/icons";
import { Button, Input, Select, Tooltip } from "antd";
import type { MessageKey } from "../../i18n";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  HeaderItem,
  HeaderPlacement,
  ResumeDocument,
} from "../../types/resumeDocument";
import {
  defaultHeaderItem,
  headerPath as buildHeaderPath,
  removeHeaderItem,
  updateHeaderItem,
} from "../../features/resume-document";

const HEADER_PLACEMENT_KEYS: Record<HeaderPlacement, MessageKey> = {
  name: "document.headerPlacement.name",
  name_meta: "document.headerPlacement.name_meta",
  subtitle: "document.headerPlacement.subtitle",
  contact: "document.headerPlacement.contact",
  photo: "document.headerPlacement.photo",
  hidden: "document.placement.hidden",
};

/** 后端目录可能带新 key；旧/缺省时用本地 key 兜底。 */
const HEADER_FIELD_KEYS: Record<string, MessageKey> = {
  name: "document.headerField.name",
  gender: "document.headerField.gender",
  birth_year: "document.headerField.birth_year",
  phone: "document.headerField.phone",
  email: "document.headerField.email",
  city: "document.headerField.city",
  job_intent: "document.headerField.job_intent",
  github: "document.headerField.github",
  personal_website: "document.headerField.personal_website",
  photo: "document.headerField.photo",
};

interface Props {
  document: ResumeDocument;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  selectedPath?: string | null;
  onSelectPath: (path: string | null) => void;
  onChange: (next: ResumeDocument) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function DocumentHeaderPanel({
  document,
  catalog = null,
  readOnly = false,
  selectedPath,
  onSelectPath,
  onChange,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const labelOf = (item: HeaderItem): string => {
    const fromCatalog = catalog?.header_fields.find((field) => field.key === item.key)?.label;
    const fallback = HEADER_FIELD_KEYS[item.key];
    return item.label || fromCatalog || (fallback ? t(fallback) : item.key);
  };
  const usedKeys = new Set(document.header.items.map((item) => item.key));
  const addable = (catalog?.header_fields ?? []).filter((field) => !usedKeys.has(field.key));

  return (
    <div className="document-header-panel" data-document-section="header">
      <span className="document-section-hint">{t("document.basic.hint")}</span>
      {document.header.items.length === 0 ? (
        <span className="document-group-empty">{t("document.basic.empty")}</span>
      ) : null}
      {document.header.items.map((item) => {
        const path = buildHeaderPath(item.id);
        const selected = selectedPath === path;
        return (
          <div
            key={item.id}
            className="document-header-row"
            data-document-path={path}
            onFocus={() => onSelectPath(path)}
            onClick={() => onSelectPath(path)}
            style={
              selected ? { outline: "1px solid var(--rf-accent)", borderRadius: 6 } : undefined
            }
          >
            <span className="document-zone-label">{labelOf(item)}</span>
            <Input
              aria-label={labelOf(item)}
              value={item.value}
              disabled={readOnly}
              placeholder={t("document.field.valuePlaceholder")}
              onChange={(event) =>
                onChange(updateHeaderItem(document, path, { value: event.target.value }))
              }
            />
            <Select
              size="small"
              aria-label={t("document.placement.aria")}
              value={item.placement}
              disabled={readOnly}
              options={(
                ["name", "name_meta", "subtitle", "contact", "photo", "hidden"] as HeaderPlacement[]
              ).map((placement) => ({
                value: placement,
                label: t(HEADER_PLACEMENT_KEYS[placement]),
              }))}
              onChange={(placement: HeaderPlacement) =>
                onChange(updateHeaderItem(document, path, { placement }))
              }
            />
            {!readOnly ? (
              <Tooltip title={t("document.item.remove")}>
                <Button
                  size="small"
                  type="text"
                  danger
                  aria-label={t("document.item.remove")}
                  icon={<DeleteOutlined />}
                  onClick={(event) => {
                    event.stopPropagation();
                    onChange(removeHeaderItem(document, path));
                    onSelectPath(null);
                    onNotice(t("document.toast.fieldRemoved"), "info");
                  }}
                />
              </Tooltip>
            ) : (
              <span />
            )}
          </div>
        );
      })}
      {!readOnly ? (
        <div className="document-add-row">
          <Select
            size="small"
            style={{ minWidth: 180 }}
            aria-label={t("document.basic.add")}
            placeholder={t("document.basic.add")}
            value={null}
            options={addable.map((field) => ({ value: field.key, label: field.label }))}
            notFoundContent={t("document.addField.empty")}
            onChange={(key: string) => {
              const field = addable.find((candidate) => candidate.key === key);
              if (!field) return;
              const item = defaultHeaderItem({
                key: field.key,
                placement: field.placement,
                format: field.format,
              });
              onChange({
                ...document,
                header: { ...document.header, items: [...document.header.items, item] },
              });
              onSelectPath(buildHeaderPath(item.id));
              onNotice(t("document.toast.fieldAdded"), "info");
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
