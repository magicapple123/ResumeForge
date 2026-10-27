// SPDX-License-Identifier: Apache-2.0
import { Tag, Tooltip } from "antd";
import { t } from "../../i18n";
import type { EvidenceStatus } from "../../types";
import { EVIDENCE_COLORS } from "../../types";
import { EVIDENCE_HINT_KEYS, EVIDENCE_LABEL_KEYS } from "./drillLabels";

/**
 * 证据状态标签。
 *
 * 显示名走语言包（`drillLabels.ts` 的两张 key 表），颜色仍来自 `types`——颜色与语言无关。
 * 调用方负责订阅语言变化（`useLocale()`）：这里是普通函数不是组件，挂不了 hook。
 */
export function evidenceTag(status: EvidenceStatus) {
  return (
    <Tooltip key={status} title={t(EVIDENCE_HINT_KEYS[status])}>
      <Tag color={EVIDENCE_COLORS[status]}>{t(EVIDENCE_LABEL_KEYS[status])}</Tag>
    </Tooltip>
  );
}
