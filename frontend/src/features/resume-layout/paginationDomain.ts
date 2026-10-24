// SPDX-License-Identifier: Apache-2.0
/**
 * 兼容入口：wave2 契约 §3.7 把前端类型落在 `features/resume-layout/paginationDomain.ts`，
 * 而 W08 的任务写入范围是 `features/resume-pagination/`。
 *
 * 唯一实现放在 `features/resume-pagination/paginationDomain.ts`；这里只 re-export，
 * **不放第二份逻辑**（契约与任务书两条路径都能 import，不会出现两份真相）。
 */
export * from "../resume-pagination/paginationDomain";
