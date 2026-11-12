// SPDX-License-Identifier: Apache-2.0
/**
 * 历史步骤时间格式化的**兼容出口**（审计 R-22 把实现提到 `utils/formatDateTime.ts`）。
 *
 * 实现只剩一份：这里只做 re-export，避免 `history/*` 的既有 import 全量搬家。
 * 新代码请直接用 `utils/formatDateTime`（导出核对卡的 `formatStampTime` 也在那里）。
 *
 * 原文件里那段"为什么不用 toLocaleTimeString"的取舍说明随实现一起搬过去了，
 * 见 `utils/formatDateTime.ts` 的文件头。
 */
export { formatStepTime } from "../../../utils/formatDateTime";
