// SPDX-License-Identifier: Apache-2.0
/**
 * 简历列表行的「复制」子菜单（2026-10-24，2026-11-19 收口到通用工厂）。
 *
 * ## 为什么单独成文件
 *
 * `ResumeTable.tsx` 已经贴着 500 行预算（零豁免），而这一组动作是**纯数据构造**：
 * 不碰行状态、不碰弹窗，只是把字段拼成一张 `CopyField[]`。
 *
 * ## 为什么是"复制到剪贴板"而不是"复制一条记录"
 *
 * 列表里已经能预览、重命名、备注、对比、收藏、删除。真正缺的是**把数据拿出去**：
 * 贴到招聘网站的表单、发给内推人、或者粘进 Excel 做投递记录。这三件事都不该逼用户
 * 先进详情页再手工选中文字。所以本文件里所有动作都是写剪贴板，不会新建任何记录。
 *
 * 每条都只在**有内容时**出现：备注为空还摆一条「复制备注」，点了只得到空字符串——
 * 那比不给更糟。
 *
 * ## 机制不在本文件
 *
 * 子菜单壳 / 异步取值 / 剪贴板 / 同 key Toast 在 `components/common/copyMenu.tsx`：
 * 岗位广场那张字段表用的是同一套，两处行为不会漂。文案一律走 `t()`。
 */
import {
  buildCopyMenu,
  copyItemsFor,
  type CopyField,
  type CopyNotifier,
  type CopyTexts,
} from "../../components/common/copyMenu";
import type { RowActionItem } from "../../components/common/RowActions";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";

/** 用 Tab 分隔，粘进 Excel / 飞书表格就是一行一格。 */
const CELL_SEPARATOR = "\t";

/**
 * 拼一整行摘要：标题 / 目标岗位 / 公司 / 来源 / 最近修改。
 *
 * 用 Tab 而不是逗号：标题里带逗号是常态（"Java 开发，3 年"），逗号分隔会让粘出来的表错列。
 * 时间保留 ISO（`2026-11-19T04:11:46`）：整行是给表格用的，ISO 可排序、Excel 能识别。
 */
function rowSummary(record: ResumeBrief): string {
  const cells = [
    record.title,
    record.job_title,
    record.company,
    record.source === "ai" ? t("resumes.copy.source.ai") : t("resumes.copy.source.manual"),
    record.updated_at || record.created_at,
  ];
  return cells.map((cell) => (cell ?? "").trim()).join(CELL_SEPARATOR);
}

/** 简历的复制字段表：标题恒有，其余字段有内容才出现，整行恒有。 */
export function resumeCopyFields(record: ResumeBrief): CopyField[] {
  const fields: CopyField[] = [
    {
      key: "copy_title",
      label: t("resumes.copy.title"),
      noun: t("resumes.copy.field.title"),
      pick: () => record.title,
    },
  ];
  if (record.job_title.trim()) {
    fields.push({
      key: "copy_job",
      label: t("resumes.copy.job"),
      noun: t("resumes.copy.field.job"),
      pick: () => record.job_title,
    });
  }
  if (record.company.trim()) {
    fields.push({
      key: "copy_company",
      label: t("resumes.copy.company"),
      noun: t("resumes.copy.field.company"),
      pick: () => record.company,
    });
  }
  if (record.note.trim()) {
    fields.push({
      key: "copy_note",
      label: t("resumes.copy.note"),
      noun: t("resumes.copy.field.note"),
      pick: () => record.note,
    });
  }
  fields.push({
    key: "copy_row",
    label: t("resumes.copy.row"),
    noun: t("resumes.copy.field.row"),
    pick: () => rowSummary(record),
  });
  return fields;
}

/** 简历侧提示文案：失败要说清下一步（桌面端点不了"浏览器"，只能手动选中后按快捷键）。 */
export function resumeCopyTexts(): CopyTexts {
  return {
    menu: t("resumes.copy.menu"),
    success: (field) => t("resumes.copy.done", { field }),
    failed: t("resumes.copy.failed"),
  };
}

/**
 * 子菜单内容（摊平）。
 *
 * 保留这个导出是因为测试要逐项断言 key 顺序；生产代码用下面的 `copyMenuFor`。
 */
export function copyActionsFor(
  record: ResumeBrief,
  notify: CopyNotifier,
  texts: CopyTexts = resumeCopyTexts(),
): RowActionItem[] {
  return copyItemsFor(resumeCopyFields(record), notify, texts);
}

/**
 * 「复制」子菜单：右键与行内「⋯」两处共用。
 *
 * 两处必须是同一个函数：菜单项不一致时用户会以为是"右键能复制、三点不能"的 bug。
 */
export function copyMenuFor(
  record: ResumeBrief,
  notify: CopyNotifier,
  texts: CopyTexts = resumeCopyTexts(),
): RowActionItem {
  return buildCopyMenu(resumeCopyFields(record), notify, texts);
}
