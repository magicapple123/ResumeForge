// SPDX-License-Identifier: Apache-2.0
/**
 * 「编辑表单值 → 完整正文」的**唯一**合并口径（需求 #12 拆出的纯函数）。
 *
 * 保存（`handleFinish`）与制作台实时预览（`onDraftContent`）都只走这一句：预览所见
 * 与保存所得的机械一致性就靠它，两处各写一份必然漂移。
 *
 * 三条边界：
 * 1. `photo` 不在编辑表单里（base64 图片走单独的上传校验），永远保留服务端那一份；
 * 2. 三个 `stripEmpty*` 清掉"画不出来"的空条目（科研三栏 / 自建板块 / 语言能力）——
 *    用户点了「添加」什么都不填就保存，不该在正文里留下空占位或被后端 422 拦下；
 * 3. `content` 为 null（新建流程还没有服务端内容）时返回 null，由调用方决定怎么处理。
 */
import type { ResumeContent } from "../../types";
import { stripEmptyResearch } from "../../features/resume-research/real";
import { stripEmptyCustomSections } from "../../utils/stripEmptyCustomSections";
import { stripEmptyLanguages } from "../../utils/stripEmptyLanguages";

export function mergeEditorContent(
  content: ResumeContent | null,
  values: Partial<ResumeContent> | undefined,
): ResumeContent | null {
  if (!content) return null;
  return stripEmptyCustomSections(
    stripEmptyLanguages(
      stripEmptyResearch({ ...content, ...(values ?? {}), photo: content.photo }),
    ),
  );
}
