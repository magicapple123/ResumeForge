// SPDX-License-Identifier: Apache-2.0
/**
 * 准入徽标：展示后端下发的准入结论与"需逐条确认"标记。
 * （自 ApplyQueuePanel 拆出，逐字搬运，行为等价。）
 *
 * 三枚标签的文案都在语言包里：两枚固定标签在 applyQueue 包，准入结论的展示名在
 * enumsApply 包（`ADMISSION_LABEL_KEYS`，与筛选下拉同源）。
 */
import { Space, Tag } from "antd";
import { t } from "../../../i18n";
import { ADMISSION_LABEL_KEYS } from "../../../i18n/enum/apply";
import { useLocale } from "../../../i18n/i18nContext";
import { ADMISSION_META } from "../../../types";
import type { ApplyQueueItem } from "../../../types";

export function AdmissionTag({ item }: { item: ApplyQueueItem }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后徽标停在旧文案。
  useLocale();
  if (item.admission === null) {
    // 还没有明确准入结论（admission 为空）时，后端仍可能判定"需逐条确认"
    // （如匹配分析结论为空 → requires_confirm）。此时必须把这个准入要求展示出来，
    // 不能一律显示「未分析」而把"需逐条确认"吞掉。只有既无结论又无需确认时才显示「未分析」。
    return item.requires_confirm ? (
      <Tag color="gold">{t("applyQueue.admission.needsConfirm")}</Tag>
    ) : (
      <Tag>{t("applyQueue.admission.unanalyzed")}</Tag>
    );
  }
  const meta = ADMISSION_META[item.admission];
  return (
    <Space size={4} wrap>
      <Tag color={meta.color}>{t(ADMISSION_LABEL_KEYS[item.admission])}</Tag>
      {item.requires_confirm && <Tag color="gold">{t("applyQueue.admission.needsConfirm")}</Tag>}
    </Space>
  );
}
