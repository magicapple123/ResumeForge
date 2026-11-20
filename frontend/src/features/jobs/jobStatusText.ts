// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位状态 → 界面显示名（列表 Tag 与「复制整行」共用这一份）。
 *
 * 两个调用点必须同口径：列表里显示「开放中」，复制整行却给出 `active`，粘进表格后
 * 同一批数据就有两种写法。归一表因此从 `JobTable.tsx` 搬到这里，谁都不许再抄一份。
 *
 * 值仍然只是**落库协议值**的别名（历史数据里出现过 `active` / `open`），不是产品文案：
 * 归一目标是 `types/job.ts` 的 `JOB_STATUS_OPEN`（`JOB_STATUS_META` 的键），
 * 因此本文件不需要任何中文字面量。
 */
import { t } from "../../i18n";
import { jobStatusLabelKey } from "../../i18n/enum/jobs";
import { JOB_STATUS_OPEN } from "../../types";

/** 历史落库值 → 现行落库值。 */
const LEGACY_STATUS_ALIASES: Record<string, string> = {
  active: JOB_STATUS_OPEN,
  open: JOB_STATUS_OPEN,
};

/** 历史落库值 → 现行落库值（颜色查表也要用它，所以单独导出）。 */
export function normalizeJobStatus(value: string): string {
  return LEGACY_STATUS_ALIASES[value] ?? value;
}

/**
 * 显示名：先归一再查语言包，两者都落空时原样返回（不丢信息）。
 *
 * 模块作用域不求值 `t()`：调用方负责订阅语言变化（列表本来就调了 `useLocale`）。
 */
export function jobStatusText(value: string): string {
  const normalized = normalizeJobStatus(value);
  const labelKey = jobStatusLabelKey(normalized);
  return labelKey ? t(labelKey) : normalized;
}
