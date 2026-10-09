import { Button, Card, Col, Empty, Input, Row, Select, Space, Tag, Typography } from "antd";
import { memo, useCallback, useEffect, useRef, type ComponentProps } from "react";
import type { WebFormRepeatedGroup, WebFormRepeatedRecord } from "../../types";
import PartialDateSelect from "./PartialDateSelect";

const { TextArea } = Input;

interface Props {
  group: WebFormRepeatedGroup;
  editing: boolean;
  saving: boolean;
  /** 「只看已填写」：编辑态下隐藏一条都没填过的记录（查看态本来就只显示有值的）。 */
  showOnlyFilled: boolean;
  /** 搜索词（已防抖）：记录的组名 / 字段标签 / 任一值命中才显示。 */
  searchTerm: string;
  onAdd: () => void;
  onDelete: (index: number) => void;
  onChange: (index: number, fieldKey: string, value: string) => void;
}

function hasValues(values: Record<string, string>): boolean {
  return Object.values(values).some((value) => value.trim());
}

function RecordInput({
  field,
  value,
  disabled,
  label,
  onChange,
}: {
  field: WebFormRepeatedGroup["fields"][number];
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) {
  if (field.kind === "longtext") {
    return (
      <TextArea
        value={value}
        disabled={disabled}
        autoSize={{ minRows: 2, maxRows: 5 }}
        aria-label={label}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.kind === "date") {
    return (
      <PartialDateSelect
        value={value}
        disabled={disabled}
        label={label}
        allowOngoing={field.key.endsWith("_end")}
        onChange={onChange}
      />
    );
  }
  if (field.kind === "select" && field.options?.length) {
    return (
      <Select
        value={value || undefined}
        disabled={disabled}
        allowClear
        options={field.options.map((option) => ({ label: option, value: option }))}
        aria-label={label}
        style={{ width: "100%" }}
        onChange={(nextValue) => onChange(nextValue ?? "")}
      />
    );
  }
  return (
    <Input
      value={value}
      disabled={disabled}
      type={field.kind === "tel" ? "tel" : "text"}
      aria-label={label}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function RecordCard({
  record,
  index,
  groupLabel,
  fields,
  editing,
  saving,
  onDelete,
  onChange,
}: {
  record: WebFormRepeatedRecord;
  index: number;
  groupLabel: string;
  fields: WebFormRepeatedGroup["fields"];
  editing: boolean;
  saving: boolean;
  onDelete: () => void;
  onChange: (fieldKey: string, value: string) => void;
}) {
  const recordLabel = `${groupLabel}第${index + 1}条`;
  return (
    <Card
      size="small"
      title={
        <Space size={8}>
          <Typography.Text strong>{`第${index + 1}条`}</Typography.Text>
          {index === 0 ? <Tag color="blue">第一条</Tag> : null}
        </Space>
      }
      extra={
        editing ? (
          <Button
            type="text"
            danger
            disabled={saving}
            aria-label={`删除${recordLabel}`}
            onClick={onDelete}
          >
            删除
          </Button>
        ) : null
      }
      style={{ height: "100%" }}
    >
      {editing ? (
        <Row gutter={[12, 4]}>
          {fields.map((field) => (
            <Col key={field.key} xs={24} md={field.kind === "longtext" ? 24 : 12}>
              <div style={{ marginBottom: 10 }}>
                <Typography.Text type="secondary" style={{ display: "block", marginBottom: 5 }}>
                  {field.label}
                </Typography.Text>
                <RecordInput
                  field={field}
                  value={record?.values[field.key] ?? ""}
                  disabled={saving}
                  label={`${recordLabel}${field.label}`}
                  onChange={(value) => onChange(field.key, value)}
                />
              </div>
            </Col>
          ))}
        </Row>
      ) : (
        <Row gutter={[12, 8]}>
          {fields.map((field) => {
            const value = record?.values[field.key]?.trim() ?? "";
            if (!value) return null;
            return (
              <Col key={field.key} xs={24} md={field.kind === "longtext" ? 24 : 12}>
                <Typography.Text type="secondary" style={{ display: "block", fontSize: 12 }}>
                  {field.label}
                </Typography.Text>
                <Typography.Text style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
                  {value}
                </Typography.Text>
              </Col>
            );
          })}
        </Row>
      )}
    </Card>
  );
}

/**
 * memo 比较器：记录是重复区块编辑的最小单元——changeRecord 只替换被编辑那条的
 * record 对象，其余记录引用不变，这里按引用比较就能让同组其余记录整卡跳过。
 * onDelete/onChange 是每次渲染新建的箭头（按 index/fieldKey 收口，行为恒定），故意不比。
 */
function areRecordCardPropsEqual(
  previous: ComponentProps<typeof RecordCard>,
  next: ComponentProps<typeof RecordCard>,
): boolean {
  return (
    previous.record === next.record &&
    previous.index === next.index &&
    previous.groupLabel === next.groupLabel &&
    previous.fields === next.fields &&
    previous.editing === next.editing &&
    previous.saving === next.saving
  );
}

const MemoizedRecordCard = memo(RecordCard, areRecordCardPropsEqual);

export default memo(function WebFormProfileRecordGroup({
  group,
  editing,
  saving,
  showOnlyFilled,
  searchTerm,
  onAdd,
  onDelete,
  onChange,
}: Props) {
  // memo 的比较器忽略 onAdd/onDelete/onChange（内联箭头、引用每渲染必变）。忽略的前提
  // 是**行为恒定**：这些回调的闭包各自捕获了自己那次渲染的 group / 外层回调——bail 的
  // 渲染间隙里它们是旧的，直接绑会把「后来新增 / 修改的数据」用旧快照整个覆盖回去。
  // 因此回调经 ref 读最新值：引用稳定（memo 能 bail）与行为最新（数据不丢）同时成立。
  const groupRef = useRef(group);
  const handlersRef = useRef({ onAdd, onDelete, onChange });
  useEffect(() => {
    groupRef.current = group;
    handlersRef.current = { onAdd, onDelete, onChange };
  });

  const stableOnAdd = useCallback(() => handlersRef.current.onAdd(), []);
  const stableOnDelete = useCallback((index: number) => handlersRef.current.onDelete(index), []);
  const stableOnChange = useCallback(
    (index: number, fieldKey: string, value: string) =>
      handlersRef.current.onChange(index, fieldKey, value),
    [],
  );

  const normalizedSearch = searchTerm.trim().toLocaleLowerCase();
  // 「只看已填写」滤空记录；搜索在**已填的内容**里找（组名 / 字段标签 / 值 命中）——
  // 字段标签是组级共享的，空字段不参与匹配，否则搜一个标签会把所有记录都带出来。
  const visibleRecords = group.records.filter((record) => {
    if (editing && !showOnlyFilled && !normalizedSearch) return true;
    if (!normalizedSearch) return hasValues(record.values);
    if (group.label.toLocaleLowerCase().includes(normalizedSearch)) return true;
    return group.fields.some((field) => {
      const value = (record.values[field.key] ?? "").toLocaleLowerCase();
      if (!value) return false;
      return (
        field.label.toLocaleLowerCase().includes(normalizedSearch) ||
        value.includes(normalizedSearch)
      );
    });
  });

  if (visibleRecords.length === 0) {
    // 搜索无匹配 → 整组隐藏（与主表搜索空态同一口径）；编辑态 + 只看已填写 + 这一组
    // 全空 → 也不渲染整组（「新增」按钮随组一起隐藏，关掉开关就回来）。
    if (normalizedSearch || !editing || showOnlyFilled) return null;
    return (
      <Card
        size="small"
        title={group.label}
        extra={
          <Button type="link" disabled={!editing || saving} onClick={stableOnAdd}>
            {`新增${group.label}`}
          </Button>
        }
        style={{ marginBottom: 14 }}
      >
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={`还没有${group.label}`} />
      </Card>
    );
  }

  return (
    <Card
      size="small"
      title={group.label}
      extra={
        <Button type="link" disabled={!editing || saving} onClick={stableOnAdd}>
          {`新增${group.label}`}
        </Button>
      }
      style={{ marginBottom: 14 }}
    >
      <Row gutter={[12, 12]}>
        {visibleRecords.map((record) => {
          const index = group.records.indexOf(record);
          return (
            <Col key={`${group.key}-${record.id ?? `draft-${index}`}`} xs={24}>
              <MemoizedRecordCard
                record={record}
                index={index}
                groupLabel={group.label}
                fields={group.fields}
                editing={editing}
                saving={saving}
                onDelete={() => stableOnDelete(index)}
                onChange={(fieldKey, value) => stableOnChange(index, fieldKey, value)}
              />
            </Col>
          );
        })}
      </Row>
    </Card>
  );
}, areRecordGroupPropsEqual);

/**
 * memo 比较器（仿照 WebFormProfileGroup 的 areGroupPropsEqual）：重复区块是编辑卡顿的
 * 重灾区——此前任何一条记录打字都会让**所有组**重渲。Records.updateGroup 对未编辑的组
 * **原样返回同一引用**，所以 group 引用相等即内容相等；onAdd/onDelete/onChange 是每次
 * 渲染新建的箭头，行为按 (index, fieldKey) 收口、恒定不变，故意不比。
 */
function areRecordGroupPropsEqual(previous: Props, next: Props): boolean {
  return (
    previous.group === next.group &&
    previous.editing === next.editing &&
    previous.saving === next.saving &&
    previous.showOnlyFilled === next.showOnlyFilled &&
    previous.searchTerm === next.searchTerm
  );
}
