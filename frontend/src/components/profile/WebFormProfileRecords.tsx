import { Typography } from "antd";
import type { WebFormRepeatedGroup, WebFormRepeatedRecord } from "../../types";
import WebFormProfileRecordGroup from "./WebFormProfileRecordGroup";

interface Props {
  groups: WebFormRepeatedGroup[];
  editing: boolean;
  saving: boolean;
  onChange: (groups: WebFormRepeatedGroup[]) => void;
}

function blankRecord(group: WebFormRepeatedGroup): WebFormRepeatedRecord {
  return {
    values: Object.fromEntries(group.fields.map((field) => [field.key, ""])),
  };
}

export default function WebFormProfileRecords({ groups, editing, saving, onChange }: Props) {
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
        下面这些资料可以按教育、经历或成果分别新增多条；学校、单位、项目名称等基础内容会按
        条序自动用于填表，不需要重复录入。
      </Typography.Text>
      {groups.map((group) => (
        <WebFormProfileRecordGroup
          key={group.key}
          group={group}
          editing={editing}
          saving={saving}
          onAdd={() => addRecord(group)}
          onDelete={(index) => deleteRecord(group, index)}
          onChange={(index, fieldKey, value) => changeRecord(group, index, fieldKey, value)}
        />
      ))}
    </div>
  );
}
