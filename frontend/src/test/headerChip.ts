// SPDX-License-Identifier: Apache-2.0
/**
 * #10 之后页眉字段是 chip：值输入框只在**展开态**存在。
 *
 * 此前页眉是一排表单行，测试直接 `getByRole("textbox", {name: 字段标签})` 就能拿到输入框；
 * chip 化后要先双击（或 F2）展开。把这段"展开再取"收敛成一个 helper，四个使用点
 * （制作台保存 / 冲突 / 总保存 / 预览）不必各写一份，也不会因为重复双击把编辑器点回去。
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { t } from "../i18n";

type LabelKey = Parameters<typeof t>[0];

/** 页眉字段 chip 的外壳（role=group，无障碍名 = `标签` 或 `标签：值`）。 */
export function headerChip(labelKey: LabelKey): HTMLElement {
  const label = t(labelKey);
  return screen.getByRole("group", {
    name: (accessibleName: string) =>
      accessibleName === label || accessibleName.startsWith(`${label}\uFF1A`),
  }) as HTMLElement;
}

/** 展开页眉字段（已展开则不动），返回 chip 外壳。 */
export function expandHeaderChip(labelKey: LabelKey): HTMLElement {
  const chip = headerChip(labelKey);
  const main = within(chip).getAllByRole("button")[0];
  if (main.getAttribute("aria-expanded") !== "true") fireEvent.doubleClick(main);
  return headerChip(labelKey);
}

/** 展开态的值输入框（aria-label = 字段标签）。 */
export function headerFieldInput(labelKey: LabelKey): HTMLInputElement {
  expandHeaderChip(labelKey);
  return screen.getByRole("textbox", { name: t(labelKey) }) as HTMLInputElement;
}
