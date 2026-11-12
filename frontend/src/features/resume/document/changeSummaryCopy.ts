// SPDX-License-Identifier: Apache-2.0
/**
 * `ChangeSummary` → 一句人话（R-17）。
 *
 * 从 `changeSummary.ts` 拆出（那个文件加上渲染层会到 504 行，超 500 行预算）：
 * 上一步只负责"算出发生了什么"，这里只负责"怎么说"。两边都是纯函数，测试可以各自钉住。
 */
import { t } from "../../../i18n";
import type { ChangeReport, ChangeSummary } from "./changeSummary";

/** 把结构化变更翻成一句话（新文案全部走 i18n）。 */
export function describeChange(report: ChangeReport): string {
  const main = describeMain(report.main);
  if (report.others <= 0) return main;
  return t("workbench.history.change.more", { main, count: report.others });
}

function describeMain(change: ChangeSummary): string {
  switch (change.kind) {
    case "section-add":
      return t("workbench.history.change.sectionAdd", { section: change.section });
    case "section-remove":
      return t("workbench.history.change.sectionRemove", { section: change.section });
    case "section-move":
      return t("workbench.history.change.sectionMove", {
        section: change.section,
        index: change.index,
      });
    case "entry-add":
      return t("workbench.history.change.entryAdd", {
        section: change.section,
        entry: change.entry,
      });
    case "entry-remove":
      return t("workbench.history.change.entryRemove", {
        section: change.section,
        entry: change.entry,
      });
    case "entry-move":
      return t("workbench.history.change.entryMove", {
        section: change.section,
        entry: change.entry,
        index: change.index,
      });
    case "entry-hide":
      return t("workbench.history.change.entryHide", {
        section: change.section,
        entry: change.entry,
      });
    case "entry-show":
      return t("workbench.history.change.entryShow", {
        section: change.section,
        entry: change.entry,
      });
    case "entry-layout":
      return t("workbench.history.change.entryLayout", {
        section: change.section,
        entry: change.entry,
      });
    case "field-add":
      return t("workbench.history.change.fieldAdd", {
        entry: change.entry,
        field: change.field,
      });
    case "field-remove":
      return t("workbench.history.change.fieldRemove", {
        entry: change.entry,
        field: change.field,
      });
    case "field-move":
      return t("workbench.history.change.fieldMove", {
        entry: change.entry,
        field: change.field,
        index: change.index,
      });
    case "value":
      return change.count > 1
        ? t("workbench.history.change.valueMany", {
            entry: change.entry,
            count: change.count,
            field: change.field,
          })
        : t("workbench.history.change.valueOne", {
            entry: change.entry,
            field: change.field,
          });
    case "layout-pages":
      return t("workbench.history.change.layoutPages", { pages: change.pages });
    case "layout-font":
      return t("workbench.history.change.layoutFont", { scale: change.scale });
    case "layout-template":
      return t("workbench.history.change.layoutTemplate", { name: change.name });
    case "layout-format":
      return t("workbench.history.change.layoutFormat", { count: change.count });
  }
}
