// SPDX-License-Identifier: Apache-2.0
/**
 * v2 文档的纯函数出口（工作台 / 结构面板 / 编辑器都从这里 import，不要深路径）。
 *
 * 全部纯函数、无 React、无请求；改名时只改这个文件与调用方，测试按文件分。
 */
export * from "./normalize";
export * from "./paths";
export * from "./defaults";
export * from "./placement";
export * from "./drag";
export * from "./entries";
export * from "./mutations";
export * from "./summarize";
export * from "./format";
export * from "./fieldCatalog";
export * from "./convertFromProfile";
export * from "./inlineEntry";
