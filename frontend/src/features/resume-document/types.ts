// SPDX-License-Identifier: Apache-2.0
/** 简历文档的编辑状态与命令类型（W01/W02 的稳定契约，W03 起由统一历史消费）。 */

import type { ResumeDetail } from "../../types/resume";
import type { ResumeDocument } from "../../types/resumeDocument";

/** 选项"基于哪一版"的整数。0 = 0052 之前写入的旧记录。 */
export interface ResumeDocumentState {
  content: ResumeDocument;
  /** 服务端最近一次确认的版本（保存成功后用它对齐）。 */
  revision: number;
  /** 下一次条件写要发回的版本；与 `revision` 不同即"本地改过还没保存"。 */
  expectedRevision: number;
}

/** 一次保存尝试的终态。`conflict` 不是失败：它要求用户选择怎么解决。 */
export type SaveOutcome =
  | { status: "saved"; revision: number }
  | { status: "unchanged"; revision: number }
  /**
   * 版本冲突。`currentRevision` = 服务端当前版本；**null = 客户端此刻还不知道**
   * （`api/client` 的错误契约只上交 detail/code，不解析 409 响应体里的 revision）。
   * 需要真实版本时由"用最新的 / 比较差异"动作自己 GET，绝不在这里编一个数。
   */
  | { status: "conflict"; currentRevision: number | null }
  | { status: "failed"; error: unknown };

/** 条目族字段名，与后端 `document_identity.POINT_FIELDS` 一一对应。 */
export const ENTRY_POINT_FIELDS = {
  education: ["courses", "achievements"],
  experience: ["description"],
  campus_experience: ["description"],
  projects: ["tech_stack", "description", "highlights"],
  skills: [],
  awards: [],
} as const;

export type EntryField = keyof typeof ENTRY_POINT_FIELDS;

/**
 * 编辑器"保存一次"的终态（正文那条链路）。
 *
 * 为什么不直接用 `SaveOutcome`：正文保存由 antd 表单驱动，表单校验没通过时**根本没有发请求**
 * （既不是失败也不是冲突，不能因此清 dirty）。revision 也可能是 null——旧宿主走的是无版本
 * 端点，不知道新版本号。
 */
export type EditorSaveOutcome =
  | { status: "saved"; revision: number | null }
  | { status: "invalid" }
  | { status: "conflict"; currentRevision: number | null }
  | { status: "failed"; error: unknown };

/**
 * 制作台与宿主之间的**保存通道**（W02 契约；W03/W13 继续消费）。
 *
 * 为什么是宿主注入而不是制作台直接调 API：保存成功后的落点（`setDetail` / 重新渲染 html /
 * 刷新列表）都在宿主里，制作台只该决定"什么时候按什么顺序调"。把 API 调用
 * 放进来会让"保存成功"与"界面其实没更新"分成两套，正是 W02 要消灭的那类缺陷。
 */
export interface ResumeDocumentPipeline {
  /** 打开这份文档时服务端确认的版本；保存成功后宿主更新 detail，下一轮渲染这里就是新值。 */
  revision: number;
  /** 先版式后内容里的"版式"一步（`PATCH /layout` + expected_revision）。 */
  saveLayout: (expectedRevision: number) => Promise<SaveOutcome>;
  /**
   * 正文条件写：成功返回**保存后的版本**；失败与冲突**抛出**。
   *
   * 抛出的理由：正文保存由编辑器表单提交驱动，`useResumeEditorPanel` 用 try/catch 统一做
   * "失败保留草稿 + 错误指引"，返回错误对象会让那条既有链路把失败当成功（清 dirty、清草稿）。
   */
  saveContent: (content: ResumeDocument, expectedRevision: number) => Promise<number>;
  /** 草稿"仅发布"一步（什么都没脏时清 draft 标记）；成功返回终态。 */
  publishDraft: (expectedRevision: number) => Promise<SaveOutcome>;
  /** 冲突时读服务端最新（GET /resumes/{id}，含 revision 与完整正文）。 */
  fetchLatest: () => Promise<ResumeDetail>;
  /** 冲突时"用最新的"：宿主替换 detail/html/layout 并清草稿。 */
  adoptLatest: (latest: ResumeDetail) => Promise<void> | void;
  /** 冲突时"另存副本"：宿主用本地内容建一份新简历（draft=false，标题带（副本））。 */
  saveAsCopy: (content: ResumeDocument) => Promise<ResumeDetail>;
}
