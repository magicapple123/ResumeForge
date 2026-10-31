// SPDX-License-Identifier: Apache-2.0
/**
 * 「上次没提交的草稿」与「当前内容」的差异摘要。
 *
 * ## 为什么复用 `computeFieldDiff` 而不是另写一份
 *
 * 字段级对比（标量做词级高亮、列表按稳定键匹配条目）已经在 `utils/resumeFieldDiff`
 * 里实现过一遍，并且有测试守着。这里的职责只是把它那份"给版本对比页看的富结构"
 * **压平成一行一条**，供草稿条的展开区使用——不重复实现匹配与高亮逻辑。
 *
 * ## 为什么不用 `ResumeFieldDiffView`
 *
 * 那个视图要求后端下发的源码 diff（`DiffViewData.raw`）来渲染"新增/删除/未变"三个
 * 计数与底部的原始差异折叠块。草稿只存在于浏览器里，没有服务端 diff 可比；为了凑齐
 * 那个形状去伪造一份 `raw` 只会让用户看到"新增 0 删除 0"这种假数据。
 *
 * ## 输出的形状
 *
 * 每个变化一个条目：`label` 是中文分组名（来自 `resumeFieldDiff` 的字段表），
 * `before` / `after` 是可直接上屏的短文本。列表字段不展开每个子字段（那会让展开区
 * 变成一个几百行的大表），只给出"草稿比现在多了几条、改了几条"。
 *
 * ## 文案为什么全走 `t()`
 *
 * 本文件是**新建**的，`cjkRatchet` 对它按"基线 0"逐文件比较——写一个中文字面量就会红。
 * 所以占位符与"新增/改动/独有"这些词全部进 `i18n/messages/zh-CN.workbench.ts`
 * （那个目录被 `cjkScan` 排除）。
 */
import type { ResumeContent } from "../types/resume";
import type { ResumeDocument } from "../types/resumeDocument";
import { t } from "../i18n";
import { computeFieldDiff } from "./resumeFieldDiff";

export interface DraftDiffEntry {
  /** 分组名（姓名 / 教育经历 / 专业技能…）。 */
  label: string;
  /** 当前内容那一侧的一句话摘要。 */
  before: string;
  /** 草稿那一侧的一句话摘要。 */
  after: string;
}

/** 单行文本的展示上限：草稿差异是"扫一眼看出改了什么"，不是全文对照。 */
const PREVIEW_LIMIT = 60;

/** 空值统一显示成占位符，否则前后两列会出现"看起来什么都没写"的空白。 */
function preview(text: string): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length === 0) return t("workbench.draftDiff.empty");
  return trimmed.length > PREVIEW_LIMIT ? `${trimmed.slice(0, PREVIEW_LIMIT)}…` : trimmed;
}

/**
 * 算一次草稿与当前内容的差异。
 *
 * `base` 是**当前**这一侧（用户现在表单里的内容），`against` 是草稿那一侧——
 * 顺序与 `computeFieldDiff(base, against)` 的参数一致，所以 `before` 永远是"现在"、
 * `after` 永远是"草稿里"。这个方向不能反：用户点开差异是想知道"恢复会把什么改掉"。
 */
export function summarizeDraftDiff(
  base: ResumeContent | ResumeDocument,
  against: ResumeContent | ResumeDocument,
): DraftDiffEntry[] {
  const { changed } = computeFieldDiff(base, against, "", "");
  return changed.map((section) => {
    if (section.type === "string") {
      return {
        label: section.label,
        before: preview(section.oldText),
        after: preview(section.newText),
      };
    }
    // 列表：说清"增 / 删 / 改"的条数，不展开每一条的子字段。
    const oldParts: string[] = [];
    const newParts: string[] = [];
    if (section.removed.length > 0) {
      oldParts.push(t("workbench.draftDiff.onlyHere", { count: section.removed.length }));
    }
    if (section.added.length > 0) {
      newParts.push(t("workbench.draftDiff.added", { count: section.added.length }));
    }
    if (section.modified.length > 0) {
      const modified = t("workbench.draftDiff.modified", { count: section.modified.length });
      oldParts.push(modified);
      newParts.push(modified);
    }
    const none = t("workbench.draftDiff.none");
    return {
      label: section.label,
      before: oldParts.length > 0 ? oldParts.join(" · ") : none,
      after: newParts.length > 0 ? newParts.join(" · ") : none,
    };
  });
}
