// SPDX-License-Identifier: Apache-2.0
/**
 * 条件写（W02）：正文与版式两笔"带版本"的保存。
 *
 * 为什么从 `api/resumes.ts` 单独成文件：
 * 1. `resumes.ts` 已贴单文件 500 行预算（零豁免），这两条是 W02 新增的最长一段；
 * 2. 条件写与旧的无条件写在**契约上就是两件事**：新端点的 body 是
 *    `{content, expected_revision}`，旧 `PUT /resumes/{id}` 的 body 就是一个
 *    `ResumeContent`（形状不能改，否则旧客户端 422）。分开放，import 语句本身就在回答
 *    "这次保存有没有版本保护"。
 *
 * `resumes.ts` 仍 re-export 这两个函数：既有导入路径与测试里
 * `vi.mock("../api/resumes")` 的落点一个都不动。
 */
import type { ResumeDetail, ResumeDocument, ResumeLayout } from "../types";
import { request } from "./client";

/**
 * 条件保存正文（W02）：带上"我是基于哪一版改的"，服务端用一条原子 UPDATE 推进 revision。
 *
 * 版本不匹配时服务端返回 409，响应体顶层带 `code=resume_revision_conflict`——前端从
 * `ApiError.businessCode` 判断，不猜状态码。`expectedRevision` 缺省 = 不做版本比较
 * （等价旧行为）；调用方要冲突保护就必须传。
 */
export function saveResumeContent(
  id: number,
  content: ResumeDocument,
  expectedRevision?: number,
): Promise<ResumeDetail> {
  return request(`/resumes/${id}/content`, {
    method: "PUT",
    body: JSON.stringify({ content, expected_revision: expectedRevision }),
  });
}

/**
 * 条件保存版式（W02）：`PATCH /resumes/{id}/layout` 的可选 `expected_revision`。
 *
 * 版式与正文**共用一个 revision**：两个窗口各自拖一半滑杆同样会互相覆盖，所以版式保存也
 * 参与版本判定。`expectedRevision` 缺省 = 无条件写 + 推进一版（旧行为，形状不变）。
 */
export function saveResumeLayout(
  id: number,
  layout: ResumeLayout,
  expectedRevision?: number,
): Promise<ResumeDetail> {
  return request(`/resumes/${id}/layout`, {
    method: "PATCH",
    body: JSON.stringify({ ...layout, expected_revision: expectedRevision }),
  });
}
