// SPDX-License-Identifier: Apache-2.0
/**
 * 「添加字段」菜单：当前板块目录里**还没加过的**内置字段 + 「自定义字段」。
 *
 * 仅素材字段在菜单里就标注「仅素材」，加入后 chip 上也有徽标；来源资料的字段带 `source`，
 * 自定义字段 `source = null`（计划 §9.2）。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, Tag } from "antd";
import { useI18n } from "../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeItem,
} from "../../types/resumeDocument";
import { defaultFieldItem, missingFieldSpecs, itemPath } from "../../features/resume-document";
import { addItem } from "../../features/resume-document/mutations";
import { useMemo } from "react";
import { newObjectId } from "../../features/resume-document/identity";

interface Props {
  document: ResumeDocument;
  sectionKey: string;
  entryId: string;
  placement: Placement;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  label: string;
  onChange: (next: ResumeDocument) => void;
  onSelectPath: (path: string) => void;
  onNotice: (text: string, tone?: "info" | "warning") => void;
}

export default function AddFieldMenu({
  document,
  sectionKey,
  entryId,
  placement,
  catalog = null,
  readOnly = false,
  label,
  onChange,
  onSelectPath,
  onNotice,
}: Props) {
  const { t } = useI18n();
  const section = document.sections.find((candidate) => candidate.key === sectionKey);
  const fields = useMemo(
    () => (section ? missingFieldSpecs(catalog, section) : []),
    [catalog, section],
  );
  const catalogSection = useMemo(
    () => catalog?.sections.find((candidate) => candidate.key === sectionKey) ?? null,
    [catalog, sectionKey],
  );

  if (readOnly) return null;

  const addField = (key: string) => {
    const spec = fields.find((candidate) => candidate.key === key);
    const item: ResumeItem = spec
      ? defaultFieldItem({
          key: spec.key,
          placement: spec.material_only ? "hidden" : placement,
          format: spec.format,
          source:
            catalogSection?.profile_section_key && spec.source_field_id
              ? { section_key: catalogSection.profile_section_key, field_id: spec.source_field_id }
              : null,
        })
      : defaultFieldItem({
          key: `custom:${newObjectId()}`,
          placement,
          label: "",
        });
    onChange(addItem(document, sectionKey, entryId, item));
    onSelectPath(itemPath(sectionKey, entryId, item.id));
    onNotice(t("document.toast.fieldAdded"), "info");
  };

  const menuItems = [
    ...(fields.length === 0
      ? [{ key: "__empty", label: t("document.addField.empty"), disabled: true }]
      : fields.map((spec) => ({
          key: spec.key,
          label: (
            <span className="document-add-field-option">
              {spec.label}
              {spec.material_only ? (
                <Tag className="document-add-field-tag">{t("document.addField.materialOnly")}</Tag>
              ) : null}
            </span>
          ),
        }))),
    { type: "divider" as const, key: "__divider" },
    { key: "__custom", label: t("document.addField.custom") },
  ];

  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        items: menuItems,
        onClick: ({ key }) => {
          if (key === "__empty" || key === "__divider") return;
          if (key === "__custom") {
            const item = defaultFieldItem({ key: `custom:${newObjectId()}`, placement });
            onChange(addItem(document, sectionKey, entryId, item));
            onSelectPath(itemPath(sectionKey, entryId, item.id));
            onNotice(t("document.toast.fieldAdded"), "info");
            return;
          }
          addField(key);
        },
      }}
    >
      <Button size="small" type="dashed" icon={<PlusOutlined />} aria-label={label}>
        {label}
      </Button>
    </Dropdown>
  );
}
