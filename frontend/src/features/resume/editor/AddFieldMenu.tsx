// SPDX-License-Identifier: Apache-2.0
/**
 * 「添加字段」菜单：当前板块目录里**还没加过的**内置字段 + 「自定义字段」。
 *
 * 仅素材字段在菜单里就标注「仅素材」，加入后 chip 上也有徽标；来源资料的字段带 `source`，
 * 自定义字段 `source = null`（计划 §9.2）。
 */
import { PlusOutlined } from "@ant-design/icons";
import { Button, Dropdown, Input, Tag } from "antd";
import { useI18n } from "../../../i18n/i18nContext";
import type {
  DocumentFieldCatalog,
  Placement,
  ResumeDocument,
  ResumeItem,
} from "../../../types/resumeDocument";
import {
  defaultFieldItem,
  defaultTextItem,
  effectiveFieldFormat,
  missingFieldSpecs,
  itemPath,
} from "../document";
import { addItem } from "../document/mutations";
import { useMemo, useState } from "react";
import { newObjectId } from "../document/identity";
import FormModal from "../../../components/common/FormModal";
import { useFormDraft } from "../../../hooks/useFormDraft";

/** 字段名长度上限：名字只上 chip，太长会把 chip 撑开（与目录标签的观感对齐）。 */
const FIELD_NAME_MAX_CHARS = 24;

interface Props {
  document: ResumeDocument;
  sectionKey: string;
  entryId: string;
  placement: Placement;
  catalog?: DocumentFieldCatalog | null;
  readOnly?: boolean;
  label: string;
  /**
   * 空组的说明（R-05）：`variant="cell"` 且组内没有 chip 时，这枚「+」只有图标，
   * 说明改由 `title` 承载，悬停能看到"这里还没有字段"。
   */
  hint?: string;
  /**
   * `button`（默认）= 带文案的虚线按钮（正文区的「添加字段块」仍用它）；
   * `cell` = chips 网格末尾的一枚虚线 `+` 格（R-05 ③）。
   */
  variant?: "button" | "cell";
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
  hint = "",
  variant = "button",
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
  /**
   * DF-10：自定义字段先弹框起名（可留空）。空名显示「未命名字段」，**key 的生成规则不变**
   * （`custom:` 前缀是 fieldPairs / coverageGroups / fieldCatalog 的判据）。
   */
  const [naming, setNaming] = useState(false);
  const [fieldName, setFieldName] = useState("");
  const draftValues = useMemo(() => ({ label: fieldName }), [fieldName]);
  const draft = useFormDraft({
    scope: `document.customField#${sectionKey}.${entryId}.${placement}`,
    values: draftValues,
    open: naming,
    isEmpty: (values) => !String(values.label ?? "").trim(),
  });

  if (readOnly) return null;

  /**
   * 正文区不加"字段"：纸面 `_body_blocks` 只处理 TextItem，字段进了 body 就是中栏有、纸面没有。
   * 所以这个位置在这里只提供「添加正文块」，普通字段请回标题行 / 灰字段区。
   */
  const bodyOnly = placement === "body";

  const addBodyBlock = () => {
    const item = defaultTextItem("", "bullet");
    onChange(addItem(document, sectionKey, entryId, item));
    onSelectPath(itemPath(sectionKey, entryId, item.id));
    onNotice(t("document.toast.fieldAdded"), "info");
  };

  /** 命名弹框提交：名字只写进 `label`（显示用），`key` 的生成规则一个字都不改。 */
  const addCustomField = () => {
    const item = defaultFieldItem({
      key: `custom:${newObjectId()}`,
      placement,
      label: fieldName.trim(),
    });
    onChange(addItem(document, sectionKey, entryId, item));
    onSelectPath(itemPath(sectionKey, entryId, item.id));
    onNotice(t("document.toast.fieldAdded"), "info");
    draft.clear();
    setNaming(false);
    setFieldName("");
  };

  const closeNaming = () => {
    // 有内容时草稿留着（关闭无损，下次打开由恢复条询问）；空名不写草稿，所以也不会有残渣。
    setNaming(false);
    setFieldName("");
  };

  const addField = (key: string) => {
    const spec = fields.find((candidate) => candidate.key === key);
    const item: ResumeItem = spec
      ? defaultFieldItem({
          key: spec.key,
          placement: spec.material_only ? "hidden" : placement,
          format: effectiveFieldFormat(spec),
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

  const menuItems = bodyOnly
    ? [{ key: "__bodyBlock", label: t("document.body.addBlock") }]
    : [
        ...(fields.length === 0
          ? [{ key: "__empty", label: t("document.addField.empty"), disabled: true }]
          : fields.map((spec) => ({
              key: spec.key,
              label: (
                <span className="document-add-field-option">
                  {spec.label}
                  {spec.material_only ? (
                    <Tag className="document-add-field-tag">
                      {t("document.addField.materialOnly")}
                    </Tag>
                  ) : null}
                </span>
              ),
            }))),
        { type: "divider" as const, key: "__divider" },
        { key: "__custom", label: t("document.addField.custom") },
      ];

  return (
    <>
      <Dropdown
        trigger={["click"]}
        menu={{
          items: menuItems,
          onClick: ({ key }) => {
            if (key === "__bodyBlock") {
              addBodyBlock();
              return;
            }
            if (key === "__empty" || key === "__divider") return;
            if (key === "__custom") {
              setFieldName("");
              setNaming(true);
              return;
            }
            addField(key);
          },
        }}
      >
        {variant === "cell" ? (
          <button
            type="button"
            className="document-add-cell"
            aria-label={label}
            title={hint || label}
            onClick={(event) => event.stopPropagation()}
          >
            <PlusOutlined aria-hidden="true" />
          </button>
        ) : (
          <Button size="small" type="dashed" icon={<PlusOutlined />} aria-label={label}>
            {label}
          </Button>
        )}
      </Dropdown>
      <FormModal
        open={naming}
        title={t("document.addField.customTitle")}
        okText={t("document.addField.customSubmit")}
        width={400}
        onSubmit={addCustomField}
        onCancel={closeNaming}
        hasDraft={Boolean(draft.pending)}
        draftBar={
          draft.pending
            ? {
                savedAt: draft.pending.savedAt,
                fieldCount: 1,
                onRestore: () => setFieldName(String(draft.adopt()?.label ?? "")),
                onDiscard: () => draft.discard(),
              }
            : null
        }
      >
        <Input
          autoFocus
          value={fieldName}
          maxLength={FIELD_NAME_MAX_CHARS}
          placeholder={t("document.field.labelPlaceholder")}
          aria-label={t("document.addField.customLabel")}
          onChange={(event) => setFieldName(event.target.value)}
          onPressEnter={addCustomField}
        />
      </FormModal>
    </>
  );
}
