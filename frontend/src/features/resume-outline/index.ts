// SPDX-License-Identifier: Apache-2.0
/**
 * `features/resume-outline` 的公共出口。
 *
 * 制作台（wb-core）只需要 import 这一处：
 * - `buildOutline` / `selectionFromPath`：只读模型与纸面反向定位；
 * - `applyOutlineCommand` / `OutlineCommand`：结构命令入口（W03 历史可直接消费）；
 * - `buildPathRemap` / `remapPathMap` / `remapAnnotationPaths`：排序后把加粗 overlay 与
 *   事实标注的 path 键改成新下标（不这样做它们会绑到错误条目上）。
 */
export * from "./types";
export * from "./flags";
export * from "./model";
export * from "./commands";
export * from "./paths";
export * from "./highlight";
export * from "./search";
export * from "./scrollMemory";
