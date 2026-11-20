// SPDX-License-Identifier: Apache-2.0
/**
 * 岗位列表行的「复制」子菜单（2026-11-19，台账第 13 条）。
 *
 * 只写**字段表**：机制（子菜单壳、异步取值、剪贴板、同 key Toast）在
 * `components/common/copyMenu.tsx`。这样简历中心与岗位广场是同一套行为，
 * 将来收藏夹/备选岗位要加复制，也只加一张表。
 *
 * ## 为什么「JD 全文」是异步的
 *
 * 列表接口是瘦身版（PR-17）：`JobList` 不带 `description`，只带 `has_description`。
 * 把 JD 加回列表接口会让响应随 JD 长度线性膨胀（一份 JD 上万字很常见），所以点下去
 * 才 `getJob(id)` 取详情。代价是三条约束，都必须守住：
 *
 * 1. `has_description === false` 时**整项不出现**——摆一个点了才报错的项比不给更糟；
 * 2. 取详情失败要说话（「JD 没取到，请打开详情后再复制」），不能静默；
 * 3. Toast 里**不回显内容**：JD 可能上万字，塞进一条 message 会把界面顶穿。
 *
 * ## 整行为什么是 ISO 时间
 *
 * 整行是给表格用的（贴进 Excel 做投递记录）：ISO（`2026-11-19T04:11:46`）可排序、
 * Excel 能识别成日期。要人读的场景走单项复制，不要在整行里改成中文日期。
 */
import { getJob } from "../../api/jobs";
import {
  buildCopyMenu,
  type CopyField,
  type CopyNotifier,
  type CopyTexts,
} from "../../components/common/copyMenu";
import type { RowActionItem } from "../../components/common/RowActions";
import { t, type MessageKey } from "../../i18n";
import type { Job, JobList } from "../../types";
import { JOB_SOURCE_LABEL_KEYS, jobSourceKind } from "../../utils/jobSource";
import { jobStatusText } from "./jobStatusText";

/** 用 Tab 分隔：粘进 Excel / 飞书表格就是一行八格。 */
const CELL_SEPARATOR = "\t";

/**
 * 一整行摘要：名称 / 公司 / 城市 / 薪资 / 状态 / 来源 / 链接 / 更新时间。
 *
 * 状态与来源用**界面显示名**（与列表 Tag 同一口径），时间保留 ISO。
 * 空字段保留空单元格，不跳格——跳格会让整张表错列。
 */
function rowSummary(job: JobList): string {
  const cells = [
    job.title,
    job.company,
    job.location,
    job.salary,
    jobStatusText(job.status),
    t(JOB_SOURCE_LABEL_KEYS[jobSourceKind(job)]),
    job.source_url,
    job.updated_at,
  ];
  return cells.map((cell) => (cell ?? "").trim()).join(CELL_SEPARATOR);
}

/** 单条字段：label 是菜单文案，noun 是提示语里的字段名。 */
function field(
  key: string,
  labelKey: MessageKey,
  nounKey: MessageKey,
  pick: CopyField["pick"],
): CopyField {
  return { key, label: t(labelKey), noun: t(nounKey), pick };
}

/**
 * 岗位的复制字段表（顺序按使用频率：名称 → 公司 → 城市 → 薪资 → 链接 → 备注 → JD → 整行）。
 *
 * `loadJob` 只为测试注入：生产环境一律走 `getJob`，不在调用点各写一份取数。
 */
export function jobCopyFields(
  job: JobList,
  loadJob: (id: number) => Promise<Job> = getJob,
): CopyField[] {
  const fields: CopyField[] = [
    field("copy_title", "jobs.copy.title", "jobs.copy.field.title", () => job.title),
  ];
  if (job.company?.trim()) {
    fields.push(
      field("copy_company", "jobs.copy.company", "jobs.copy.field.company", () => job.company),
    );
  }
  if (job.location?.trim()) {
    fields.push(
      field("copy_location", "jobs.copy.location", "jobs.copy.field.location", () => job.location),
    );
  }
  if (job.salary?.trim()) {
    fields.push(
      field("copy_salary", "jobs.copy.salary", "jobs.copy.field.salary", () => job.salary),
    );
  }
  if (job.source_url?.trim()) {
    fields.push(field("copy_url", "jobs.copy.url", "jobs.copy.field.url", () => job.source_url));
  }
  if (job.note?.trim()) {
    fields.push(field("copy_note", "jobs.copy.note", "jobs.copy.field.note", () => job.note));
  }
  if (job.has_description) {
    // 列表项没有正文，点下去才取详情：异步 + 失败要说话 + 不回显内容。
    fields.push(
      field("copy_jd", "jobs.copy.jd", "jobs.copy.field.jd", async () => {
        const detail = await loadJob(job.id);
        return detail.description ?? "";
      }),
    );
  }
  fields.push(field("copy_row", "jobs.copy.row", "jobs.copy.field.row", () => rowSummary(job)));
  return fields;
}

/** 岗位侧提示文案（与简历侧各用各的 key，措辞可以不同）。 */
export function jobCopyTexts(): CopyTexts {
  return {
    menu: t("jobs.copy.menu"),
    success: (noun) => t("jobs.copy.done", { field: noun }),
    failed: t("jobs.copy.failed"),
    pickupFailed: t("jobs.copy.jdFailed"),
  };
}

/** 右键菜单与行内「⋯」共用的「复制」子菜单（两处必须完全一致）。 */
export function jobCopyMenu(job: JobList, notify: CopyNotifier): RowActionItem {
  return buildCopyMenu(jobCopyFields(job), notify, jobCopyTexts());
}
