// SPDX-License-Identifier: Apache-2.0
/**
 * 上下文窗口的预设值、夹取与显示格式：设置弹窗与助手面板共用的**唯一一份**。
 *
 * 为什么抽出来：同一个模型名下的「上下文窗口」是同一个数（助手面板的百分比分母 =
 * 设置里这一项），两处各写一套预设必然漂移——助手侧选 200K、设置侧显示 204800，
 * 用户会以为是两个不同的设置。标签仍走语言包（`contextUsage.window.preset*`），
 * 本模块只持有数字与 key，不在导入期取文案。
 */

import type { MessageKey } from "../../../i18n";

export interface ContextWindowPreset {
  /** 窗口大小（token）。 */
  value: number;
  /** 显示名的语言包 key（渲染处 `t(labelKey)`）。 */
  labelKey: MessageKey;
}

/**
 * 后端 `LLMConfig.context_window_tokens` 的上限（`Field(le=2_000_000)`）。
 *
 * 填更大值会被 422 拒掉，界面在夹取时先收在这里——表单里留一个能提交但必失败的值，
 * 用户只会看到"保存失败"，看不到是哪一项让它失败。
 */
export const CONTEXT_WINDOW_MAX = 2_000_000;

/** 常见窗口档位：跟着参考表里出现频率最高的几档走（32K/64K/128K/200K/1M）。 */
export const CONTEXT_WINDOW_PRESETS: readonly ContextWindowPreset[] = [
  { value: 32_000, labelKey: "contextUsage.window.preset32k" },
  { value: 64_000, labelKey: "contextUsage.window.preset64k" },
  { value: 128_000, labelKey: "contextUsage.window.preset128k" },
  { value: 200_000, labelKey: "contextUsage.window.preset200k" },
  { value: 1_000_000, labelKey: "contextUsage.window.preset1m" },
];

const THOUSAND = 1_000;
const MILLION = 1_000_000;

/**
 * 表单值 → 可落库的整数窗口。
 *
 * `null` / 留空 / 非法值一律折成 0（后端语义：0 = 未知，跟随型号参考值），正数向上
 * 夹到 {@link CONTEXT_WINDOW_MAX}。这里不做"猜一个合理值"——填错比不填更糟。
 */
export function clampContextWindow(value: number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const rounded = Math.round(numeric);
  if (rounded <= 0) return 0;
  return Math.min(rounded, CONTEXT_WINDOW_MAX);
}

/** 去掉多余的小数尾零：`1.00` → `1`、`1.05` → `1.05`。 */
function trimDecimals(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/u, "");
}

/**
 * 窗口的显示串：`1M` / `200K` / `1.05M` / `128K`。
 *
 * 只用于**展示**（记录卡、参考值按钮），不参与任何计算；精确值仍在表单与 API 里。
 * 档位之所以按 M/K 缩写：卡片一行里还要放模型名与服务地址，7 位数字会把它们挤掉。
 */
export function formatContextWindow(tokens: number): string {
  const safe = Number.isFinite(tokens) ? Math.round(tokens) : 0;
  if (safe >= MILLION) return `${trimDecimals(safe / MILLION)}M`;
  if (safe >= THOUSAND) return `${trimDecimals(safe / THOUSAND)}K`;
  return String(Math.max(0, safe));
}

/** 窗口来源 → 语言包 key（与后端 `window_source` 的三个取值一一对应）。 */
export function contextWindowSourceKey(source: string | undefined): MessageKey {
  if (source === "manual") return "contextUsage.window.source.manual";
  if (source === "reference") return "contextUsage.window.source.reference";
  return "contextUsage.window.source.fallback";
}
