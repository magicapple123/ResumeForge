// SPDX-License-Identifier: Apache-2.0
/**
 * `features/resume-review` 公共出口（W18 离线对象批注）。
 *
 * - `parseReviewPack` / `serializeReviewPack`：`annotations.json` v1 的前端校验与序列化；
 * - `resolveAnnotationAnchor`：按 object_id（优先）/ path（兼容）解析当前定位；
 * - `mergeAnnotationRecords` / `filterAnnotationsByStatus` / `summarizeAnnotationStatus`：列表；
 * - `ReviewAnnotationApi` / `createReviewAnnotationApi` / `createMockReviewAnnotationApi`：
 *   HTTP 适配与有状态假实现（W18-BE 未就绪时 UI 用 mock）。
 */
export * from "./types";
export * from "./pack";
export * from "./anchors";
export * from "./dedupe";
export * from "./reviewApi";
