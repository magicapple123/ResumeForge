// SPDX-License-Identifier: Apache-2.0

/** 应用打开时是否弹出近期提醒（默认开）。 */
export interface ReminderPopupSetting {
  enabled: boolean;
}

/**
 * 网申填表「放宽模式」（默认关）。
 *
 * 开启后程序会尝试代点下拉/弹层选项并代勾你逐条确认过的声明项，存在选错可能，
 * 填完请核对；日期选择器与文件上传仍不代做。
 */
export interface WebFormRelaxedModeSetting {
  enabled: boolean;
}

/**
 * 「投投」悬浮球的设置（入口与提示标语，默认均开）。
 *
 * **每个后端字段都必须在这里出现**：这个接口是整份替换语义，少声明一个字段就会在
 * 保存时被默认值填回去（与 `LLMConfig` 同一类坑）。
 */
export interface AssistantOrbSetting {
  enabled: boolean;
  /** 悬浮球是否弹出轮换提示标语；默认开，兼容老数据。 */
  tips_enabled: boolean;
  /**
   * 选中文字后是否浮出动作条（Q9）；默认开，兼容老数据。
   *
   * 可选：更早的后端响应里没有这个字段，此时界面按「开」处理（`!== false`），
   * 且保存时不凭空补一个值——缺字段的那一侧本来就存不下它。
   */
  selection_enabled?: boolean;
}

/** 求职助手「放宽模式」：开启后助手可读取完整资料（含敏感信息），默认关。 */
export interface AssistantRelaxedModeSetting {
  enabled: boolean;
}

/**
 * 求职助手的两条运行上限：一次回复的工具轮次上限与整链时间预算（秒）。
 *
 * 默认 30 轮 / 1800 秒，与后端 `services/assistant_limits` 的常量一致。两项**一起 PUT**：
 * 只提交一项的话，另一项会被默认值填回（整对象落库语义）。
 */
export interface AssistantLimitSetting {
  max_tool_rounds: number;
  stream_budget_seconds: number;
}

/**
 * 上下文自动压缩的三个设置项（需求 #10）。
 *
 * `model` 是**摘要专用**的模型名，空串 = 跟随当前对话所用的模型（默认）；两个阈值都是
 * 「窗口占用百分比」，1–99，默认 60 / 75，语义是：
 * - 占用 ≥ `mask_percent` → 先遮蔽最早的几组工具结果原文（消息结构不变）；
 * - 占用 ≥ `summary_percent` → 再把更早的历史压成一段摘要。
 *
 * 因此 `summary_percent` **必须大于** `mask_percent`（否则达到摘要线时遮蔽还没做，两档
 * 互相覆盖）。后端对越界与"遮蔽 ≥ 摘要"直接 422；三项**一起 PUT**（整对象落库语义），
 * 只提交一项会把另两项打回默认。
 */
export interface AssistantCompactionSetting {
  model: string;
  mask_percent: number;
  summary_percent: number;
}

export interface NavigationVisibility {
  hidden: string[];
}

/**
 * 「生成内容保存位置」设置。
 *
 * `path` 为空串 = 默认行为（仅浏览器下载）；非空时从本机前端导出会同时把产物落盘一份到该目录。
 */
export interface ExportSaveLocation {
  path: string;
}
