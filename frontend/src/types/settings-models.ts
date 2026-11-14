// SPDX-License-Identifier: Apache-2.0

/**
 * 「模型窗口参考」列表（只读）。
 *
 * 数据来自后端内置表 `model_context_windows.MODEL_WINDOWS`：窗口是模型的能力常数，
 * 不是用户数据；这里只负责把它显示出来，并提供官方文档链接供核对。
 */
export interface ModelWindowEntry {
  /** 显示用型号名（同窗口的几个型号可能合成一条）。 */
  label: string;
  /** 上下文窗口（token）。 */
  tokens: number;
  /** 官方文档链接。 */
  reference: string;
}

/** 当前生效模型在表里的位置；`label` 为空表示表里没有，按保守值估算。 */
export interface CurrentModelWindow {
  model: string;
  label: string | null;
  tokens: number;
  /** manual = 用户手填；reference = 命中表；fallback = 未知型号的保守值。 */
  source: "manual" | "reference" | "fallback";
}

export interface ModelWindowReference {
  /** 表里没有的型号使用的保守值。 */
  default_tokens: number;
  entries: ModelWindowEntry[];
  current: CurrentModelWindow;
}
