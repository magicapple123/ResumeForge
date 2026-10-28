// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位广场多选态的「批量操作」下拉：把原来平铺的删除 / 导出 / 入队，以及逐条才能做的
 * AI 生成简历、岗位需求解读、匹配度分析，收进同一个入口。
 *
 * 语义是**逐个执行原来的单项动作**，不是"合成一份结果"：生成简历会给每个岗位各生成一份，
 * 解读会各存一份解读，匹配度分析仍是逐岗位结论（横向对比是另一个入口）。
 */
import { Button, Dropdown } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { buildBulkActionItems, type BulkMenuAction } from "./bulkActionItems";

export default function BulkActionsMenu({
  disabled,
  onAction,
}: {
  disabled: boolean;
  onAction: (action: BulkMenuAction) => void;
}) {
  useLocale();
  return (
    <Dropdown
      trigger={["click"]}
      menu={{ items: buildBulkActionItems(onAction, disabled) }}
      disabled={disabled}
    >
      <Button disabled={disabled}>{t("jobsPage.toolbar.bulkActions")}</Button>
    </Dropdown>
  );
}
