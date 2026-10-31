// SPDX-License-Identifier: Apache-2.0
/**
 * 资料投影 → v2 文档的适配层（2026-10-30 切 v2 后）。
 *
 * projection.data.content 现在是 **v2 ResumeDocument**（backend-api 契约），本层只做：
 * 1. normalizeDocument（过滤空 entry / 补 id），保证编辑器拿到合法 v2 文档；
 * 2. 岗位模式把求职意向覆盖成岗位名（其余字段逐字来自投影，前端不维护第二份字段映射）。
 */
import type { Job, ResumeDocument } from "../types";
import type { PaperProjectionOut } from "../features/profile-library/types";
import { ensureIds, normalizeDocument } from "../features/resume-document/normalize";

/** 投影内容 -> v2 文档（岗位模式覆盖 header 里 placement=subtitle 的意向字段）。 */
export function projectionToResumeDocument(
  projection: PaperProjectionOut,
  job?: Job | null,
): ResumeDocument {
  // types 层正由 frontend-core 把 content 切成 ResumeDocument；运行期已是 v2，按 unknown 收口。
  // ensureIds 让结果与 DocumentEditor 打开时的归一化形态一致（含 layout 默认值），
  // 否则编辑器挂载时会再做一次归一化、把文档标脏（新建弹窗不应一打开就是脏的）。
  const document = ensureIds(normalizeDocument(projection.content as unknown as ResumeDocument));
  const intent = (job?.title ?? "").trim();
  if (!intent) return document;
  const items = document.header.items;
  const index = items.findIndex((item) => item.placement === "subtitle");
  if (index < 0) return document;
  return {
    ...document,
    header: {
      ...document.header,
      items: items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, value: intent } : item,
      ),
    },
  };
}
