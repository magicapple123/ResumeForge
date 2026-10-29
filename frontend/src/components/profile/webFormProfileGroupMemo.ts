// SPDX-License-Identifier: Apache-2.0
import type { ReactNode } from "react";
import type { WebFormExtraEntry, WebFormField } from "../../types";

export interface WebFormProfileGroupProps {
  group: string;
  fields: WebFormField[];
  groupAllFields: WebFormField[];
  filledCount: number;
  editing: boolean;
  saving: boolean;
  values: Record<string, string>;
  entries: Record<string, WebFormExtraEntry>;
  displayLabel: (field: WebFormField) => string;
  onChange: (key: string, value: string) => void;
  onRename: (key: string, label: string) => string | undefined;
  onDelete: (key: string) => void;
  /**
   * 卡片底部的插槽（「自定义」分组用它承载"添加自定义字段"的输入框）。
   *
   * 传 `ReactNode` 就必须**按引用**参与判等——这是本节最容易踩的坑：调用方若每 render
   * 新建一个元素，判等永远失败，组内字段会跟着每次击键重渲（memo 形同虚设）。所以
   * `WebFormProfileSection` 用 `useMemo` 固定了那一个元素。
   */
  footer?: ReactNode;
}

function sameFieldKeys(previous: WebFormField[], next: WebFormField[]): boolean {
  if (previous === next) return true;
  if (previous.length !== next.length) return false;
  for (let index = 0; index < next.length; index += 1) {
    if (previous[index].key !== next[index].key) return false;
  }
  return true;
}

/** Only compare values in this group, after confirming the key sequence matches. */
function sameFieldValues(
  fields: WebFormField[],
  previousValues: Record<string, string>,
  nextValues: Record<string, string>,
): boolean {
  for (const field of fields) {
    if (previousValues[field.key] !== nextValues[field.key]) return false;
  }
  return true;
}

/** Preserve the existing memo boundary: field membership, local values and stable callbacks. */
export function areGroupPropsEqual(
  previous: WebFormProfileGroupProps,
  next: WebFormProfileGroupProps,
): boolean {
  return (
    previous.group === next.group &&
    previous.editing === next.editing &&
    previous.saving === next.saving &&
    previous.filledCount === next.filledCount &&
    previous.groupAllFields === next.groupAllFields &&
    previous.entries === next.entries &&
    previous.displayLabel === next.displayLabel &&
    previous.onChange === next.onChange &&
    previous.onRename === next.onRename &&
    previous.onDelete === next.onDelete &&
    // 插槽按引用比较：稳定引用时（`useMemo` 出来的那一个元素）才是真的没变。
    previous.footer === next.footer &&
    sameFieldKeys(previous.fields, next.fields) &&
    sameFieldValues(next.fields, previous.values, next.values)
  );
}
