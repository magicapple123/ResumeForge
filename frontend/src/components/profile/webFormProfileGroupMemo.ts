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
    sameFieldKeys(previous.fields, next.fields) &&
    sameFieldValues(next.fields, previous.values, next.values)
  );
}
