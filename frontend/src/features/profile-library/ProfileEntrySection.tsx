// SPDX-License-Identifier: Apache-2.0
/**
 * 一个大字段的条目渲染（F6）：单例分区只有一块值，多条分区有稳定条目列表。
 *
 * - 单例（basic_info / summary）：绝不渲染「添加一条」，服务端也只会有一条；
 * - 多条：条目以 entry_key（entry_id 或新建临时键）做 React key，顺序来自表单数组，
 *   拖拽/上移下移都走 Form.List 的 move；删除是软删（可撤销），由页面发请求；
 * - 空态：查看态且本分区没有有效值时显示，主按钮直接进入编辑（禁方位词指路）；
 * - 字段输入与折叠/隐藏逻辑在 ProfileFieldInputs。
 */
import { Button, ConfigProvider, Form, Input, Tooltip } from "antd";
import { DeleteOutlined, HolderOutlined, PlusOutlined, SettingOutlined } from "@ant-design/icons";
import { useMemo } from "react";
import EmptyState from "../../components/common/EmptyState";
import { useProfileItemListDrag } from "../../components/profile/useProfileItemListDrag";
import { t } from "../../i18n";
import ProfileFieldInputs from "./ProfileFieldInputs";
import type { FieldOut, ProfileEntryDraft, SectionOut } from "./types";

interface Props {
  section: SectionOut;
  editing: boolean;
  saving: boolean;
  entryLimit: number;
  singleLineMax: number;
  multiLineMax: number;
  onRequestEdit: () => void;
  onAddEntry: (sectionKey: string) => void;
  onRemoveEntry: (sectionKey: string, entryKey: string, title: string) => void;
  onSetPreference: (
    field: FieldOut,
    patch: { hidden?: boolean; collapsed_override?: boolean | null },
  ) => void;
  onOpenFieldSettings: (sectionKey: string) => void;
  onOpenGuide: () => void;
}

/** 条目标题：默认字段里第一个有值的单行文本（与界面给用户的识别锚点一致）。 */
function entryTitle(
  section: SectionOut,
  entry: ProfileEntryDraft | undefined,
  index: number,
): string {
  if (!entry) return t("profileLibrary.entry.untitled", { index: index + 1 });
  const text = (fieldId: string) => String(entry.values?.[fieldId] ?? "").trim();
  const first = section.fields.find((field) => field.field_type === "single_line");
  const value = first ? text(first.field_id) : "";
  if (value) return value;
  const any = section.fields.find(
    (field) => field.field_type === "single_line" && text(field.field_id) !== "",
  );
  if (any) return text(any.field_id);
  return t("profileLibrary.entry.untitled", { index: index + 1 });
}

function hasAnyValue(section: SectionOut, entries: ProfileEntryDraft[] | undefined): boolean {
  if (!entries || entries.length === 0) return false;
  return entries.some((entry) =>
    section.fields.some(
      (field) =>
        field.field_type !== "photo" && String(entry.values?.[field.field_id] ?? "").trim() !== "",
    ),
  );
}

export default function ProfileEntrySection(props: Props) {
  const {
    section,
    editing,
    saving,
    entryLimit,
    singleLineMax,
    multiLineMax,
    onRequestEdit,
    onAddEntry,
    onRemoveEntry,
    onSetPreference,
    onOpenFieldSettings,
    onOpenGuide,
  } = props;
  const disabled = !editing || saving;
  const form = Form.useFormInstance();
  const watched = Form.useWatch(["sections", section.key], form) as ProfileEntryDraft[] | undefined;
  const entries = watched ?? [];

  // 资料页输入控件整体在 <Form disabled> 里（查看态禁编辑），但「字段设置」只是打开
  // 偏好视图（组管理弹层），不属于表单编辑：就地恢复可点击，其余按钮自带 disabled 语义。
  const headerActions = (
    <ConfigProvider componentDisabled={false}>
      <div className="profile-entry-section-actions">
        <Tooltip title={t("profileLibrary.section.fieldSettings")}>
          <Button
            size="small"
            type="text"
            icon={<SettingOutlined />}
            aria-label={t("profileLibrary.section.fieldSettings")}
            onClick={() => onOpenFieldSettings(section.key)}
          />
        </Tooltip>
        {section.form === "multi" ? (
          <Button
            size="small"
            icon={<PlusOutlined />}
            disabled={disabled || entries.length >= entryLimit}
            onClick={() => onAddEntry(section.key)}
          >
            {t("profileLibrary.section.addEntry")}
          </Button>
        ) : null}
      </div>
    </ConfigProvider>
  );

  const emptyState = (multi: boolean) => (
    <EmptyState
      inline
      description={
        <span>
          <strong>{t("profileLibrary.section.emptyTitle")}</strong>
          <br />
          <span>{t("profileLibrary.section.emptyHint")}</span>
        </span>
      }
      actionLabel={
        multi ? t("profileLibrary.section.addEntry") : t("profileLibrary.section.startFill")
      }
      onAction={() => {
        if (!editing) {
          onRequestEdit();
          return;
        }
        if (multi) onAddEntry(section.key);
      }}
    >
      <div className="profile-section-empty-actions">
        <Button
          type="primary"
          onClick={() => (multi && editing ? onAddEntry(section.key) : onRequestEdit())}
        >
          {multi ? t("profileLibrary.section.addEntry") : t("profileLibrary.section.startFill")}
        </Button>
        <Button type="link" size="small" onClick={onOpenGuide}>
          {t("profileLibrary.section.guideLink")}
        </Button>
      </div>
    </EmptyState>
  );

  if (section.form === "singleton") {
    const showEmpty = !editing && !hasAnyValue(section, entries);
    return (
      <div className="profile-entry-section">
        <div className="profile-entry-section-header">
          <span className="profile-entry-section-name">{section.name}</span>
          {headerActions}
        </div>
        <Form.Item name={["sections", section.key, 0, "entry_key"]} hidden>
          <Input />
        </Form.Item>
        {showEmpty ? (
          emptyState(false)
        ) : (
          <ProfileFieldInputs
            section={section}
            namePrefix={["sections", section.key, 0, "values"]}
            disabled={disabled}
            singleLineMax={singleLineMax}
            multiLineMax={multiLineMax}
            onSetPreference={onSetPreference}
          />
        )}
      </div>
    );
  }

  return (
    <Form.List name={["sections", section.key]}>
      {(listFields, operations) => {
        const listDrag = {
          enabled: editing && !saving,
          itemCount: listFields.length,
          onMove: operations.move,
        };
        return (
          <MultiEntryList
            section={section}
            editing={editing}
            saving={saving}
            entryLimit={entryLimit}
            singleLineMax={singleLineMax}
            multiLineMax={multiLineMax}
            listFields={listFields}
            operations={operations}
            listDrag={listDrag}
            entries={entries}
            headerActions={headerActions}
            emptyState={emptyState(true)}
            onRemoveEntry={onRemoveEntry}
            onSetPreference={onSetPreference}
          />
        );
      }}
    </Form.List>
  );
}

import type { FormListFieldData, FormListOperation } from "antd";

interface MultiEntryListProps {
  section: SectionOut;
  editing: boolean;
  saving: boolean;
  entryLimit: number;
  singleLineMax: number;
  multiLineMax: number;
  listFields: FormListFieldData[];
  operations: FormListOperation;
  listDrag: { enabled: boolean; itemCount: number; onMove: (from: number, to: number) => void };
  entries: ProfileEntryDraft[];
  headerActions: React.ReactNode;
  emptyState: React.ReactNode;
  onRemoveEntry: (sectionKey: string, entryKey: string, title: string) => void;
  onSetPreference: (
    field: FieldOut,
    patch: { hidden?: boolean; collapsed_override?: boolean | null },
  ) => void;
}

function MultiEntryList({
  section,
  editing,
  saving,
  entryLimit,
  singleLineMax,
  multiLineMax,
  listFields,
  operations,
  listDrag,
  entries,
  headerActions,
  emptyState,
  onRemoveEntry,
  onSetPreference,
}: MultiEntryListProps) {
  const drag = useProfileItemListDrag({
    enabled: listDrag.enabled,
    itemCount: listDrag.itemCount,
    onMove: listDrag.onMove,
  });
  const keys = useMemo(() => listFields.map((item) => item.key), [listFields]);

  return (
    <div className="profile-entry-section">
      <div className="profile-entry-section-header">
        <span className="profile-entry-section-name">{section.name}</span>
        {headerActions}
      </div>
      {listFields.length === 0 ? emptyState : null}
      <div className="profile-list-items">
        {listFields.map((item, index) => {
          const entry = entries[index];
          const dragging = drag.dragging?.key === item.key;
          const itemClass = ["profile-list-item", dragging ? "is-dragging" : ""]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={item.key} data-profile-list-item-index={item.name} className={itemClass}>
              <div className="profile-list-item-header">
                {editing ? (
                  <Tooltip title={t("profileLibrary.entry.drag")}>
                    <button
                      type="button"
                      className="profile-list-item-drag-handle"
                      aria-label={t("profileLibrary.entry.drag")}
                      onPointerDown={(event) =>
                        drag.handleItemPointerDown(event, item.name, item.key)
                      }
                    >
                      <HolderOutlined />
                    </button>
                  </Tooltip>
                ) : null}
                <span className="profile-list-item-title">{entryTitle(section, entry, index)}</span>
                <div className="profile-list-item-actions">
                  <Tooltip title={t("profileLibrary.entry.moveUp")}>
                    <Button
                      size="small"
                      type="text"
                      disabled={!editing || saving || index === 0}
                      aria-label={t("profileLibrary.entry.moveUp")}
                      onClick={() => operations.move(index, index - 1)}
                    >
                      ↑
                    </Button>
                  </Tooltip>
                  <Tooltip title={t("profileLibrary.entry.moveDown")}>
                    <Button
                      size="small"
                      type="text"
                      disabled={!editing || saving || index === listFields.length - 1}
                      aria-label={t("profileLibrary.entry.moveDown")}
                      onClick={() => operations.move(index, index + 1)}
                    >
                      ↓
                    </Button>
                  </Tooltip>
                  {editing ? (
                    <Tooltip title={t("profileLibrary.entry.remove")}>
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<DeleteOutlined />}
                        aria-label={t("profileLibrary.entry.remove")}
                        onClick={() => {
                          const entryKey = entry?.entry_key ?? "";
                          const title = entryTitle(section, entry, index);
                          operations.remove(item.name);
                          onRemoveEntry(section.key, entryKey, title);
                        }}
                      />
                    </Tooltip>
                  ) : null}
                </div>
              </div>
              <Form.Item name={[item.name, "entry_key"]} hidden>
                <Input />
              </Form.Item>
              <ProfileFieldInputs
                section={section}
                namePrefix={[item.name, "values"]}
                disabled={!editing || saving}
                singleLineMax={singleLineMax}
                multiLineMax={multiLineMax}
                onSetPreference={onSetPreference}
              />
            </div>
          );
        })}
      </div>
      {listFields.length > 0 && editing ? (
        <Button
          icon={<PlusOutlined />}
          disabled={saving || listFields.length >= entryLimit}
          onClick={() => operations.add({ entry_key: makeTempEntryKey(), values: {} })}
        >
          {t("profileLibrary.section.addEntry")}
        </Button>
      ) : null}
      <span hidden>{keys.length}</span>
    </div>
  );
}

let tempCounter = 0;
/** 新建条目的临时键：保存成功后由服务端 entry_id 替换。 */
export function makeTempEntryKey(): string {
  tempCounter += 1;
  return "new:" + Date.now().toString(36) + ":" + tempCounter;
}
