// SPDX-License-Identifier: Apache-2.0
/**
 * 深链 `?job_id=` 的解析：正整数才认，其余按"没带参"处理。
 *
 * 单独成文件是为了让 `InterviewPage` 留在 500 行预算内（页面本体只该编排，不该寄存
 * 这种一行的工具函数）。
 */
export function parseLinkedJobId(raw: string | null): number | undefined {
  const parsed = Number(raw);
  return raw && Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}
