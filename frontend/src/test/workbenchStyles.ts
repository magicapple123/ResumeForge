// SPDX-License-Identifier: Apache-2.0
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";

declare const process: { cwd(): string };

/**
 * 工作台样式的原文（四个分片按 @import 顺序拼接）。
 *
 * 2026-10-23 起 `styles/resume-workbench.css` 只是聚合清单，规则分散在
 * `workbench-*.css` 里（拆分原因：原文件 492 行，只剩 8 行余量）。
 * 断言"某条规则存在"的测试必须读拼接后的全文，否则会因为规则换了文件而假红——
 * **不要**为此放宽断言，读对文件即可。
 */
const WORKBENCH_SHARDS = [
  "workbench-shell.css",
  "workbench-params.css",
  "workbench-canvas.css",
  "workbench-narrow.css",
];

export function readWorkbenchCss(): string {
  return WORKBENCH_SHARDS.map((name) =>
    readFileSync([process.cwd(), "src", "styles", name].join("/"), "utf8"),
  ).join("\n");
}
