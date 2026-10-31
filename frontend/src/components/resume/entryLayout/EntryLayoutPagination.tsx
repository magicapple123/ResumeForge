// SPDX-License-Identifier: Apache-2.0
/**
 * 条目级「分页」小分组（Q08/Q09）：从新页开始 / 整块不跨页。
 *
 * 从 `EntryLayoutPanel` 拆出（单文件 500 行预算），行为不变：
 * - 写回 `entry.layout.start_on_new_page / keep_together`（Q08 起条目级断页只在结构页签设置）；
 * - 本会话第一次拨动开关时给一条轻提示（与分页面板共用 sessionStorage 标记）。
 */
import { Switch } from "antd";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type { EntryLayout, ResumeDocument, ResumeEntry } from "../../../types/resumeDocument";
import { entryDisplayLabel } from "../../../features/resume-document/summarize";
import { patchEntryLayout } from "../../../features/resume-layout/entryLayoutModel";
import { consumePageBreakToastOnce } from "../pagination/paginationBreakNotice";

export interface EntryLayoutPaginationProps {
  document: ResumeDocument;
  sectionKey: string;
  entry: ResumeEntry;
  /** 锁排版时由面板传入 true，两个开关禁用。 */
  disabled: boolean;
  onChange: (next: ResumeDocument) => void;
  /** 轻提示出口（宿主接 message.info）；不传 = 静默。 */
  onNotice?: (message: string, tone?: "info" | "warning") => void;
}

export default function EntryLayoutPagination({
  document,
  sectionKey,
  entry,
  disabled,
  onChange,
  onNotice,
}: EntryLayoutPaginationProps) {
  useLocale();
  const entryName = entryDisplayLabel(entry) || t("structure.badge.untitledEntry");
  const setEntryPagination = (patch: Pick<EntryLayout, "start_on_new_page" | "keep_together">) => {
    if (!entry.id) return;
    onChange(patchEntryLayout(document, sectionKey, entry.id, patch));
    if (!onNotice) return;
    if (!consumePageBreakToastOnce()) return;
    onNotice(t("toast.pageBreakApplied"));
  };
  return (
    <section
      className="rf-entry-layout-pagination"
      aria-label={t("pagination.entry.title")}
      data-entry-layout-pagination="1"
    >
      <div className="rf-entry-layout-fields-title">{t("pagination.entry.title")}</div>
      <div className="rf-entry-layout-fields-hint">{t("structure.layout.entryPaginationHint")}</div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("pagination.breakBefore")}</span>
        <Switch
          size="small"
          checked={Boolean(entry.layout.start_on_new_page)}
          disabled={disabled || undefined}
          aria-label={t("structure.pagination.entryAria", { name: entryName })}
          onChange={(checked) => setEntryPagination({ start_on_new_page: checked })}
        />
      </div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.pagination.keepTogether")}</span>
        <Switch
          size="small"
          checked={Boolean(entry.layout.keep_together)}
          disabled={disabled || undefined}
          aria-label={t("structure.pagination.entryAria", { name: entryName })}
          onChange={(checked) => setEntryPagination({ keep_together: checked })}
        />
      </div>
    </section>
  );
}
