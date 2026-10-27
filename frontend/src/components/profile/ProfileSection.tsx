// SPDX-License-Identifier: Apache-2.0
/** 资料分区容器：卡片 + 动态列表 + 增删行，各分区共用。 */
import { DeleteOutlined, HolderOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Card, Form, Tooltip } from "antd";
import type { FormListFieldData, FormListOperation } from "antd";
import { useCallback } from "react";
import type { ReactNode } from "react";
import { useProfileItemListDrag } from "./useProfileItemListDrag";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

type ProfileListItem = Record<string, unknown>;

type ItemLabelFormatter = (item: ProfileListItem, index: number) => string;

interface Props {
  /** 表单字段名（对应 profile 的 educations/experiences/...） */
  fieldName: string;
  /** 只读查看时保留内容，但锁定动态列表操作。 */
  editable?: boolean;
  /** 新增一行的默认值 */
  emptyValue: Record<string, string>;
  /** 行渲染函数 */
  renderRow: (field: FormListFieldData, remove: FormListOperation["remove"]) => ReactNode;
  /** 删除按钮/拖动把手的提示里显示的条目标题。 */
  itemLabel?: ItemLabelFormatter;
}

interface ProfileListBodyProps extends Omit<Props, "title"> {
  fields: FormListFieldData[];
  operations: FormListOperation;
}

function ProfileListBody({
  fields,
  operations,
  fieldName,
  editable = true,
  emptyValue,
  renderRow,
  itemLabel,
}: ProfileListBodyProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const form = Form.useFormInstance();
  /**
   * 拖拽排序（useProfileItemListDrag）：pointerdown 只记起点不改布局，越过阈值才
   * 激活——条目全程保持展开，没有旧实现"按下即全部折叠成摘要条"的布局塌缩，
   * 也就没有塌缩后命中错条目/空白导致排序失效的问题。键盘 ArrowUp/Down 不经过它。
   */
  const { dragging: draggingIndex, handleItemPointerDown } = useProfileItemListDrag({
    enabled: editable,
    itemCount: fields.length,
    onMove: operations.move,
  });
  const handleAdd = useCallback(() => operations.add({ ...emptyValue }), [emptyValue, operations]);

  return (
    <>
      <div className="profile-list-items">
        {fields.map((field, index) => {
          // 提示标签随当前值实时取（旧实现把它缓存在排序模式里，只有拖拽才需要）。
          const values = (form.getFieldValue(fieldName) as ProfileListItem[] | undefined) ?? [];
          const label =
            itemLabel?.(values[index] ?? {}, index) ||
            t("profileLibrary.entry.untitled", { index: index + 1 });
          // 视觉身份用稳定的 field.key：Form.List move 会改 field.name，用下标比对
          // 会让被拖条目在第一次实时重排后就丢掉抬起样式。
          const isDragging = draggingIndex?.key === field.key;
          return (
            <div
              key={field.key}
              data-profile-list-item-index={field.name}
              className={`profile-list-item${isDragging ? " is-dragging" : ""}`}
            >
              {editable && (
                <Tooltip title={t("profileUi.entry.drag", { label })}>
                  <button
                    type="button"
                    className="profile-list-item-drag-handle"
                    aria-label={t("profileUi.entry.drag", { label })}
                    onPointerDown={(event) => handleItemPointerDown(event, field.name, field.key)}
                    onKeyDown={(event) => {
                      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                      event.preventDefault();
                      const targetIndex = index + (event.key === "ArrowUp" ? -1 : 1);
                      if (targetIndex >= 0 && targetIndex < fields.length) {
                        operations.move(index, targetIndex);
                      }
                    }}
                  >
                    <HolderOutlined />
                  </button>
                </Tooltip>
              )}
              <Tooltip title={t("profileUi.entry.delete", { label })}>
                <Button
                  type="text"
                  danger
                  size="small"
                  aria-label={t("profileUi.entry.delete", { label })}
                  icon={<DeleteOutlined />}
                  disabled={!editable}
                  className="profile-list-item-delete"
                  onClick={() => operations.remove(field.name)}
                />
              </Tooltip>
              <div className="profile-list-item-content">{renderRow(field, operations.remove)}</div>
            </div>
          );
        })}
      </div>
      <Button type="dashed" block icon={<PlusOutlined />} disabled={!editable} onClick={handleAdd}>
        {t("profileLibrary.section.addEntry")}
      </Button>
    </>
  );
}

/** 各分区共用：卡片壳 + Form.List 动态列表。 */
export default function ProfileSection({
  fieldName,
  editable = true,
  emptyValue,
  renderRow,
  itemLabel,
}: Props) {
  return (
    <Card size="small" style={{ marginBottom: 16 }}>
      <Form.List name={fieldName}>
        {(fields, operations) => (
          <ProfileListBody
            fields={fields}
            operations={operations}
            fieldName={fieldName}
            editable={editable}
            emptyValue={emptyValue}
            renderRow={renderRow}
            itemLabel={itemLabel}
          />
        )}
      </Form.List>
    </Card>
  );
}
