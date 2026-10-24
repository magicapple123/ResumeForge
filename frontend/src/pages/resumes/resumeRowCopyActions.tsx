// SPDX-License-Identifier: Apache-2.0
/**
 * 简历列表行的「复制」子菜单（2026-10-24）。
 *
 * ## 为什么单独成文件
 *
 * `ResumeTable.tsx` 已经贴着 500 行预算（零豁免），而这一组动作是**纯数据构造**：
 * 不碰行状态、不碰弹窗，只是把字段拼成几条 `RowActionItem`。搬出来之后，
 * 表格那边只多一行 import 和一行调用。
 *
 * ## 为什么是"复制"而不是更多按钮
 *
 * 列表里已经能预览、重命名、备注、对比、收藏、删除。真正缺的是**把数据拿出去**：
 * 贴到招聘网站的表单、发给内推人、或者粘进 Excel 做投递记录。这三件事都不该逼用户
 * 先进详情页再手工选中文字。
 *
 * 每条都只在**有内容时**出现：备注为空还摆一条「复制备注」，点了只得到空字符串——
 * 那比不给更糟。
 *
 * 文案一律走 `t()`：本文件是新增文件，中文棘轮对它没有基线可让（见 `cjkRatchet`）。
 */
import { CopyOutlined } from "@ant-design/icons";
import type { RowActionItem } from "../../components/common/RowActions";
import { t } from "../../i18n";
import type { ResumeBrief } from "../../types";
import { copyText } from "../../utils/clipboard";

/** 复制结果回调：`ok=false` 时文案要告诉用户还能怎么做（手选文字）。 */
export type CopyNotice = (field: string, ok: boolean) => void;

/**
 * 只要求"能弹一句成功/警告"的最小接口。
 *
 * 不直接收 `MessageInstance` 的全量类型：这里只用到两个方法，收窄之后既不用引
 * antd 的内部类型路径，测试里也能塞一个哑对象进来。
 */
export interface CopyNotifier {
  success: (text: string) => void;
  warning: (text: string) => void;
}

/** 用 Tab 分隔，粘进 Excel / 飞书表格就是一行一格。 */
const CELL_SEPARATOR = "\t";

/**
 * 拼一整行摘要：标题 / 目标岗位 / 公司 / 来源 / 最近修改。
 *
 * 用 Tab 而不是逗号：标题里带逗号是常态（"Java 开发，3 年"），逗号分隔会让粘出来的表错列。
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

/** 一条复制动作：`noun` 是提示语里的字段名，`label` 是菜单文案。 */
function copyItem(
  key: string,
  label: string,
  noun: string,
  pick: () => string,
  notice: CopyNotice,
): RowActionItem {
  return {
    key,
    label,
    onClick: () => {
      void copyText(pick()).then((ok) => notice(noun, ok));
    },
  };
}

/**
 * 构造「复制」子菜单的条目。
 *
 * @param record 当前行。
 * @param notice 复制结果回调（成功/失败文案由调用方按自己的 Toast 风格给）。
 * @returns 至少两条（标题 + 整行），所以调用方不必判空。
 */
export function copyActionsFor(record: ResumeBrief, notice: CopyNotice): RowActionItem[] {
  const items: RowActionItem[] = [
    copyItem(
      "copy_title",
      t("resumes.copy.title"),
      t("resumes.copy.field.title"),
      () => record.title,
      notice,
    ),
  ];
  if (record.job_title.trim()) {
    items.push(
      copyItem(
        "copy_job",
        t("resumes.copy.job"),
        t("resumes.copy.field.job"),
        () => record.job_title,
        notice,
      ),
    );
  }
  if (record.company.trim()) {
    items.push(
      copyItem(
        "copy_company",
        t("resumes.copy.company"),
        t("resumes.copy.field.company"),
        () => record.company,
        notice,
      ),
    );
  }
  if (record.note.trim()) {
    items.push(
      copyItem(
        "copy_note",
        t("resumes.copy.note"),
        t("resumes.copy.field.note"),
        () => record.note,
        notice,
      ),
    );
  }
  items.push({
    key: "copy_row",
    label: t("resumes.copy.row"),
    onClick: () => {
      void copyText(rowSummary(record)).then((ok) => notice(t("resumes.copy.field.row"), ok));
    },
  });
  return items;
}

/**
 * 右键菜单里的「复制」子菜单（带图标、带 Toast 汇报）。
 *
 * 收在这里而不是表格里：`ResumeTable.tsx` 贴着 500 行预算，这段是纯装配代码；
 * 而且"复制成功/失败怎么说"应当只有一处，别让每个列表各写一遍。
 */
export function copyMenuFor(record: ResumeBrief, notify: CopyNotifier): RowActionItem {
  return {
    key: "copy",
    label: t("resumes.copy.menu"),
    icon: <CopyOutlined />,
    children: copyActionsFor(record, (field, ok) =>
      ok
        ? notify.success(t("resumes.copy.done", { field }))
        : notify.warning(t("resumes.copy.failed")),
    ),
  };
}
