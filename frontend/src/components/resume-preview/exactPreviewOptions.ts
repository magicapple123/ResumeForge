// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览（方案 A）那组上下文的**唯一构造处**。
 *
 * 为什么单独成文件：主预览与「简历制作台」必须拿到**同一份**上下文，各自拼一份迟早会漂
 * （一处带草稿页数、一处带记录页数，用户就会看到"制作台少一页"）。这份构造本来住在
 * `ResumeDetailPreview` 的 `useMemo` 里，抽出来是为了给它腾出行数预算（那个文件正好贴着
 * 500 行，而新能力还得往里加两个 prop），顺带也让"哪些字段属于草稿值"这件事只有一处答案。
 *
 * 全部走**草稿值**而不是记录值：换完模板还没点保存时，精确预览就得按新的排。
 */
import type { ResumeDetail, ResumeLayout } from "../../types";
import type { ExactPreviewOptions } from "../ResumePreview";

export function buildExactPreviewOptions(
  detail: ResumeDetail,
  layout: ResumeLayout,
  contentSignature: string,
): ExactPreviewOptions {
  return {
    resumeId: detail.id,
    template: layout.template,
    formatName: layout.format_name,
    fontScale: layout.font_scale,
    // 语言也得走草稿值：选了 English 还没保存，精确预览就必须按英文排——这是"草稿选英文、
    // 精确预览还是中文"的唯一修复点。
    language: layout.language ?? "zh-CN",
    formatConfig: layout.format_config as unknown as Record<string, unknown>,
    // 正文签名：改了内容也要重排一次（版式字段已各自进依赖）。
    contentSignature,
  };
}
