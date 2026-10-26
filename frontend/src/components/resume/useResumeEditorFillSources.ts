// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑**已保存简历**时的「资料候选 + 冻结编辑器视图」来源（F10）。
 *
 * 为什么需要单独一层（而不是在 `ResumeDetailPreview` 里直接调 `useProfileFillSources`）：
 *
 * 1. `ResumeDetailPreview` 贴着 500 行预算，这里只替它换一行调用；
 * 2. 写端点（PUT/PATCH）返回的 `ResumeOut` **有意**不含 `profile_usage`（后端保持写响应
 *    形状不变，见 `api/resumes/profile_usage_routes.py` 文件头），所以"内容或版式保存一次"
 *    之后 `detail.profile_usage` 会变成 undefined。编辑器视图必须按简历 id **黏住**第一次
 *    读到的快照，否则用户一保存，页签与字段就跳回"当前方案"——那正是用户要避免的
 *    「已保存简历受方案修改影响」。
 * 3. 换一份简历（id 变化）时重新开始：新简历的 `GET /resumes/{id}` 一定自带
 *    `profile_usage`（可为 null = 旧简历/无快照）。
 */
import { useState } from "react";
import type { ResumeDetail } from "../../types";
import type { ResumeProfileUsageSnapshot } from "../../types/resumeProfileUsage";
import { useProfileFillSources, type ProfileFillSourcesApi } from "./useProfileFillSources";

interface StickyUsage {
  resumeId: number;
  usage: ResumeProfileUsageSnapshot | null;
}

export function useResumeEditorFillSources(
  wanted: boolean,
  detail: ResumeDetail,
): ProfileFillSourcesApi {
  // 渲染期守卫式调整（与 `ResumeDetailModal` 的 prevRecordId 同一写法），只把"这份简历第一次
  // 看到的快照"记下来，不触发请求。局部变量让**本次渲染**就用新值，避免旧简历视图闪一帧。
  const [sticky, setSticky] = useState<StickyUsage>(() => ({
    resumeId: detail.id,
    usage: detail.profile_usage ?? null,
  }));
  let usage = sticky.usage;
  if (sticky.resumeId !== detail.id) {
    usage = detail.profile_usage ?? null;
    setSticky({ resumeId: detail.id, usage });
  } else if (detail.profile_usage && detail.profile_usage !== sticky.usage) {
    usage = detail.profile_usage;
    setSticky({ resumeId: detail.id, usage });
  }
  return useProfileFillSources(wanted, usage, true);
}
