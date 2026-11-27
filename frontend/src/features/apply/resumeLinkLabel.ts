// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台「这一条用的是哪份简历」的展示名（T30）。
 *
 * 三个地方要说同一句话：队列行的简历标签、队列详情抽屉、投递记录列表的「简历」列。
 * 三处各拼一次必然漂移（一处漏前缀、一处漏兜底），所以只在这里拼：
 *
 * - 外部简历 → `外部 · xxx.pdf`（前缀走 i18n，后端只回显名字；外部简历被彻底删除后
 *   `external_resume_id` 会变空，前缀自然消失，名字快照仍照实显示）；
 * - 内部简历 → 快照标题；
 * - 都没有 → 调用方给的兜底文案（队列行是「按默认规则解析」，记录列是 `-`）。
 *
 * `resume_title` 是**快照**：外部简历改名之后，历史投递记录仍显示当时的名字——
 * 与内部简历同一口径，这里不做实时回查（要回查的是详情抽屉，不是列表）。
 */
import { t } from "../../i18n";

/** 记录 / 队列条目上"用哪份简历"的字段（两种记录类型都满足）。 */
export interface ApplyResumeLinkFields {
  external_resume_id?: number | null;
  resume_title?: string;
}

/**
 * 展示名。`fallback` 由调用方给：队列行用「按默认规则解析」，记录列用 `-`。
 * 外部简历连名字都读不到时退回 `#id`（如实告知，不假装有名字）。
 */
export function applyResumeLabel(record: ApplyResumeLinkFields, fallback: string): string {
  const title = (record.resume_title ?? "").trim();
  const externalId = record.external_resume_id;
  if (externalId != null) {
    const name = title || `#${externalId}`;
    return `${t("applyUi.resume.externalTag")} · ${name}`;
  }
  return title || fallback;
}
