// SPDX-License-Identifier: Apache-2.0
/**
 * 3-A：把覆盖度清单里点名的资料条目**确定性**补进简历（不调模型）。
 *
 * 单独成文件的理由与 `resumeCreation` / `resumeLayout` / `resumeDocument` 完全一样：
 * `api/resumes.ts` 贴着 500 行硬预算（本文件落笔时 469 行），而这条接口与生成/修订/导出
 * 没有任何共享字段。`api/resumes.ts` 里 re-export，调用方与
 * `vi.mock("../api/resumes")` 的落点都不用改。
 */
import type { ResumeDetail } from "../types";
import { request } from "./client";

/** 补入结果：更新后的简历 + 实际写进去 / 被跳过的条目名。 */
export interface AppendProfileEntriesResult {
  resume: ResumeDetail;
  /** 实际写进正文的条目名（按身份名）。 */
  appended: string[];
  /** 已经在正文里、按身份名去重命中的条目名——不是失败。 */
  skipped: string[];
}

/**
 * `POST /api/resumes/{id}/append-profile-entries`。
 *
 * 与 `reviseResume` 的分工：修订协议只能改写**已有字段的值**，不能新增条目或分区，所以
 * "整条资料没写进简历"这类要求必须走这里。服务端按生成时同一份投影写出条目、按身份名
 * 去重、走条件写推进版本，并把刚补入的几条从 `coverage_notes` 里摘掉。
 *
 * `entryIds` 来自 `coverage_notes[].entry_ids`（旧记录没有这个字段，调用方应改走
 * 「去制作台添加」，不要传空数组硬试）；`baseRevision` 是**当前** revision，期间别的
 * 窗口保存过就 409，不会静默覆盖。
 *
 * `signal` 只进 fetch 选项，**不能**随请求体发出去：后端 `AppendProfileEntriesRequest`
 * 是 `extra="forbid"`，多一个 `"signal": {}`（AbortSignal 的 JSON 序列化结果）就会 422，
 * 而前端只能看到 Pydantic 那句 "Extra inputs are not permitted"——与
 * `previewResumeTemplate` 是同一个坑，所以这里把 body 显式挑字段拼出来。
 */
export function appendProfileEntries(
  resumeId: number,
  payload: {
    /** 目标分区的资料分区键（`custom:<id>` 或用归一前的系统分区键）。 */
    sectionKey: string;
    /** 要补入的条目 id（可定位到资料条目的那些名字对应的 id）。 */
    entryIds: string[];
    /** 点按钮时的那一版（W02 条件写）；`null`/省略 = 不带前置条件。 */
    baseRevision?: number | null;
    /** 调用方取消：只进 fetch 选项。 */
    signal?: AbortSignal;
  },
): Promise<AppendProfileEntriesResult> {
  const { signal, sectionKey, entryIds, baseRevision } = payload;
  const body = JSON.stringify({
    section_key: sectionKey,
    entry_ids: entryIds,
    base_revision: baseRevision ?? null,
  });
  return request(`/resumes/${resumeId}/append-profile-entries`, { method: "POST", body, signal });
}
