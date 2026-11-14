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

/**
 * 准入结论的展示。
 *
 * `variant="inline"` 给队列表格用（2026-11-13 与参考分合并成一列「匹配」）：同一格里
 * 分数在上、结论在下，再套一层实底色块会让这一列重新变重，所以只渲染 12px 的文字，
 * 颜色仍取 `ADMISSION_META`（与详情抽屉、筛选下拉同源）。
 * `variant="tag"`（默认）保持原来的标签形态，详情抽屉还在用。
 */
export function AdmissionTag({
  item,
  variant = "tag",
}: {
  item: ApplyQueueItem;
  variant?: "tag" | "inline";
}) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后徽标停在旧文案。
  useLocale();

  if (variant === "inline") {
    // 未分析时不再重复写「未分析」：分数格已经是一个破折号，这一行只留结论，
    // 两个都是"没有结论"的会读成一串空话。
    const label =
      item.admission === null
        ? item.requires_confirm
          ? t("applyQueue.admission.needsConfirm")
          : t("applyQueue.admission.unanalyzed")
        : t(ADMISSION_LABEL_KEYS[item.admission]);
    const tone =
      item.admission === null ? (item.requires_confirm ? "warn" : "none") : item.admission;
    return (
      <span className="apply-queue-admission" data-tone={tone}>
        {label}
        {item.admission !== null && item.requires_confirm
          ? ` · ${t("applyQueue.admission.needsConfirm")}`
          : ""}
      </span>
    );
  }

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
