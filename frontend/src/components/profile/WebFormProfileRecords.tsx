// SPDX-License-Identifier: Apache-2.0
import { Typography } from "antd";
import { memo } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { webformRepeatedGroupLabel } from "../../features/webform/groupIdentity";
import { webformFieldLabel } from "../../features/webform/webformFieldLabels";
import type { WebFormRepeatedGroup, WebFormRepeatedRecord } from "../../types";
import WebFormProfileRecordGroup from "./WebFormProfileRecordGroup";

interface Props {
  groups: WebFormRepeatedGroup[];
  editing: boolean;
  saving: boolean;
  /** 「只看已填写」：编辑态下整组没填过的记录不再渲染（查看态本来就只显示有值的）。 */
  showOnlyFilled: boolean;
  /** 搜索词（已防抖）：记录的组名 / 字段标签 / 任一值命中才显示。 */
  searchTerm: string;
  onChange: (groups: WebFormRepeatedGroup[]) => void;
}

function blankRecord(group: WebFormRepeatedGroup): WebFormRepeatedRecord {
  return {
    values: Object.fromEntries(group.fields.map((field) => [field.key, ""])),
  };
}

/**
 * **memo**：groups（extraRepeatedGroups）/editing/saving/onChange 在普通字段打字时
 * 引用全部不变（onChange 已在页面侧 useCallback 稳定化），重复经历整棵子树随之跳过
 * 网申资料打字引起的重渲；只有真的增删/编辑记录时才重渲。
 */
export default memo(function WebFormProfileRecords({
  groups,
  editing,
  saving,
  showOnlyFilled,
  searchTerm,
  onChange,
}: Props) {
  useLocale();
  useLocale();
  const updateGroup = (
    groupKey: string,
    update: (group: WebFormRepeatedGroup) => WebFormRepeatedGroup,
  ) => {
    onChange(groups.map((group) => (group.key === groupKey ? update(group) : group)));
  };

  const addRecord = (group: WebFormRepeatedGroup) => {
    updateGroup(group.key, (current) => ({
      ...current,
      records: [...current.records, blankRecord(current)],
    }));
  };

  const deleteRecord = (group: WebFormRepeatedGroup, index: number) => {
    updateGroup(group.key, (current) => ({
      ...current,
      records: current.records.filter((_record, recordIndex) => recordIndex !== index),
    }));
  };

  const changeRecord = (
    group: WebFormRepeatedGroup,
    index: number,
    fieldKey: string,
    value: string,
  ) => {
    updateGroup(group.key, (current) => ({
      ...current,
      records: current.records.map((record, recordIndex) =>
        recordIndex === index
          ? { ...record, values: { ...record.values, [fieldKey]: value } }
          : record,
      ),
    }));
  };

  if (!groups.length) return null;

  return (
    <div>
      <Typography.Text type="secondary" style={{ display: "block", margin: "0 0 10px" }}>
        {t("profileLibrary.webform.repeatedIntro")}
      </Typography.Text>
      {groups.map((sourceGroup) => {
        const group = {
          ...sourceGroup,
          label: webformRepeatedGroupLabel(sourceGroup.family, sourceGroup.label),
          fields: sourceGroup.fields.map((field) => ({
            ...field,
            label: webformFieldLabel(field.key, field.label),
          })),
        };
        return (
          <WebFormProfileRecordGroup
            key={group.key}
            group={group}
            editing={editing}
            saving={saving}
            showOnlyFilled={showOnlyFilled}
            searchTerm={searchTerm}
            onAdd={() => addRecord(group)}
            onDelete={(index) => deleteRecord(group, index)}
            onChange={(index, fieldKey, value) => changeRecord(group, index, fieldKey, value)}
          />
        );
      })}
    </div>
  );
});
