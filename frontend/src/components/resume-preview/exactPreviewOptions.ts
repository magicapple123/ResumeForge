// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览（方案 A）那组上下文的**唯一构造处**与类型定义处。
 *
 * 为什么单独成文件：主预览与「简历制作台」必须拿到**同一份**上下文，各自拼一份迟早会漂
 * （一处带草稿页数、一处带记录页数，用户就会看到"制作台少一页"）。这份构造本来住在
 * `ResumeDetailPreview` 的 `useMemo` 里，抽出来是为了给它腾出行数预算（那个文件正好贴着
 * 500 行，而新能力还得往里加两个 prop），顺带也让"哪些字段属于草稿值"这件事只有一处答案。
 *
 * 类型也搬到这里（2026-11）：`ResumePreview.tsx` 同样贴着 500 行预算，而这个类型只被
 * "构造它的人"与"消费它的组件"用到。`ResumePreview.tsx` 仍 **re-export** 它，所以
 * `import type { ExactPreviewOptions } from "../ResumePreview"` 那几处调用一行都没改；
 * 本文件**不**反向 import `ResumePreview`，依赖方向因此是单向的（类型 → 组件）。
 *
 * 全部走**草稿值**而不是记录值：换完模板还没点保存时，精确预览就得按新的排。
 */
import type { ResumeDetail, ResumeLayout, ResumeTemplateCatalog } from "../../types";

/** 精确预览需要的那组上下文（与 `ResumeDetailPreview` 手里的草稿值一致）。 */
export interface ExactPreviewOptions {
  resumeId: number;
  /** 草稿的模板名（内置或自制）。 */
  template: string;
  /** 草稿的版式名。 */
  formatName: string;
  fontScale: string;
  /**
   * 纸面文案的语言（`zh-CN` / `en-US`）。
   *
   * 必须一路传到服务端：精确预览显示的就是导出产物本身，语言传不进去就会
   * "草稿里选了英文、精确预览还是中文"。
   */
  language: string;
  formatConfig: Record<string, unknown>;
  /** 正文 + 模板的身份：内容改了也要重排一次 PDF（见 `ExactPreviewPanel`）。 */
  contentSignature: string;
  /**
   * 这个模板的**标题字族是衬线**（`elegant` / `editorial`）。
   *
   * 精确预览用的是嵌入 PDF 的中文黑体，草稿里的衬线标题是 CSS 字族——这一项**注定不同**，
   * 所以只在为真时给一句说明（P1-2）。它由 `buildExactPreviewOptions` 从模板目录里填，
   * 缺省 `false` = 不提示。
   */
  headingSerif?: boolean;
}

export function buildExactPreviewOptions(
  detail: ResumeDetail,
  layout: ResumeLayout,
  contentSignature: string,
  /**
   * 模板目录（宿主 `useResumeTemplateCatalog()` 那一份，**不要**再拉一次）。
   *
   * 只用来查"这个模板的标题是不是衬线"；不传时 `headingSerif` 为 `false`（不提示），
   * 与旧行为逐字一致。
   */
  catalog?: ResumeTemplateCatalog,
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
    // 衬线标题 → 精确模式常驻一句"字族与草稿不同"（P1-2）。自制模板恒 false。
    headingSerif: Boolean(
      catalog?.templates.find((item) => item.name === layout.template)?.serif_heading,
    ),
  };
}
