// SPDX-License-Identifier: Apache-2.0
/**
 * 批量选择模式的「删除所选」按钮。
 *
 * **不再二次确认**：删除是软删，`useDeleteUndo` 会在 Toast 里给 5 秒「撤销」。
 * 前置确认的成本（每次多一次点击 + 一次判断）在可撤销时是纯成本（见方案 §3.4）。
 *
 * 这一层仍然保留：它的价值从"确认"变成"文案与数量单位"，`noun` 由调用方给
 * （「条知识」「份资料」），避免每个页面各拼一次。
 */
import { Button } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  count: number;
  /** 数量单位（如「条知识」「份资料」）。保留给调用方的语义，本组件不再拼确认文案。 */
  noun: string;
  disabled?: boolean;
  /** 删除动作（调用方负责请求、撤销提示与列表刷新）。 */
  onDelete: () => void;
}

export default function BatchDeleteButton({ count, disabled = false, onDelete }: Props) {
  useLocale();
  return (
    <Button danger disabled={disabled || count === 0 || undefined} onClick={onDelete}>
      {t("common.batchBar.deleteSelected")}
    </Button>
  );
}
