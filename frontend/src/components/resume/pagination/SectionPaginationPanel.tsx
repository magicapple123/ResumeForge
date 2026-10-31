// SPDX-License-Identifier: Apache-2.0
/**
 * 分页控制（v2）：板块级「从新页开始 / 整块不跨页」+「已设置断页」汇总 + 恢复自然分页。
 *
 * Q08 重排：每个板块无条件展开全部条目 + 两个开关曾把左栏撑成 60+ 行排版墙，条目名
 * 还一律是「未命名条目 N」。现在：
 * - 这里**只保留板块级**两开关；
 * - 条目级断页挪进「本份简历结构」页签（选中条目后在条目字段排版面板里设置）；
 * - 汇总条把两类已设置断页都列出来（点击跳转 / 单个 ✕ 清除）；
 * - 「恢复自然分页」只清板块级断页（条目级由结构页签管理，面板里写明）。
 *
 * Q07：行内 / 单段板块没有「条目」这层概念（planner 的 inline 只产 rows、text 只产一段
 * 正文），所以这里从来不给它们渲染条目级控件——条目级开关整体搬走后，这类板块与其它
 * 板块一样只有板块级两个开关。
 *
 * Q09：顶部固定说明 +「切到精确预览」（宿主控制预览口径，不传则不渲染，避免死控件）；
 * 本会话第一次拨动任一断页开关时给一条 ≤20 字轻提示。
 *
 * 数据落点（v2 唯一真相）：
 * - 板块级：`document.sections[i].layout.start_on_new_page / keep_together`；
 * - 条目级：`document.sections[i].entries[j].layout.*`（本文件的汇总/清除与结构页签同源）。
 * 经 `onChange` 交给工作台记历史/标脏/保存，组件自己不发请求、不写库。
 */
import { Button, Flex, Switch, Tooltip, Typography } from "antd";
import { useMemo } from "react";
import { useLocale } from "../../../i18n/i18nContext";
import { t } from "../../../i18n";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { PreviewMode } from "../../resume-preview/config";
import { patchSectionLayout } from "../../../features/resume-layout/entryLayoutModel";
import EmptyState from "../../common/EmptyState";
import { sectionDisplayLabel } from "../sectionLabels";
import {
  clearPageBreak,
  collectPageBreaks,
  hasSectionPageBreaks,
  restoreSectionPagination,
  type ConfiguredPageBreak,
  type PageBreakFlag,
} from "./paginationBreaks";
import { consumePageBreakToastOnce } from "./paginationBreakNotice";
import "./pagination.css";

export interface SectionPaginationPanelProps {
  document: ResumeDocument;
  /** 唯一回流口：新文档交给工作台（进历史 + 保存）。 */
  onChange: (next: ResumeDocument) => void;
  disabled?: boolean;
  /** 点击汇总条芯片 → 宿主切到「本份简历结构」并选中该节点（不传 = 芯片不可点）。 */
  onJumpToBreak?: (path: string) => void;
  /** 切到精确预览（宿主控制预览口径；不传 = 不渲染按钮，不留死控件）。 */
  onSwitchToExactPreview?: () => void;
  /** 当前预览口径：已在精确预览时按钮禁用并说明。 */
  previewMode?: PreviewMode;
  /** 轻提示出口（宿主接 message.info）；不传 = 静默。 */
  onNotify?: (message: string) => void;
}

const FLAG_LABEL_KEYS: Record<
  PageBreakFlag,
  "pagination.breakBefore" | "structure.pagination.keepTogether"
> = {
  start_on_new_page: "pagination.breakBefore",
  keep_together: "structure.pagination.keepTogether",
};

export default function SectionPaginationPanel({
  document,
  onChange,
  disabled = false,
  onJumpToBreak,
  onSwitchToExactPreview,
  previewMode,
  onNotify,
}: SectionPaginationPanelProps) {
  useLocale();
  const breaks = useMemo(() => collectPageBreaks(document), [document]);
  const canRestore = hasSectionPageBreaks(document);

  if (document.sections.length === 0) {
    return <EmptyState inline description={t("structure.pagination.empty")} />;
  }

  const notifyFirstBreak = () => {
    if (!onNotify) return;
    if (!consumePageBreakToastOnce()) return;
    onNotify(t("toast.pageBreakApplied"));
  };

  const setSectionFlag = (
    sectionKey: string,
    patch: { start_on_new_page?: boolean; keep_together?: boolean },
  ) => {
    const section = document.sections.find((candidate) => candidate.key === sectionKey);
    if (!section) return;
    // 值没变不产生历史点（两个开关都是"未设置 = false"，但显式写 false 也别制造脏值）。
    const unchanged = Object.entries(patch).every(
      ([key, value]) => section.layout[key as "start_on_new_page" | "keep_together"] === value,
    );
    if (unchanged) return;
    onChange(patchSectionLayout(document, sectionKey, patch));
    notifyFirstBreak();
  };

  const clearBreak = (item: ConfiguredPageBreak) => {
    onChange(clearPageBreak(document, item));
  };

  const sectionNameOf = (sectionKey: string): string => {
    const section = document.sections.find((candidate) => candidate.key === sectionKey);
    if (!section) return t("structure.section.untitled");
    return sectionDisplayLabel(section);
  };

  const chipLabelOf = (item: ConfiguredPageBreak): string => {
    const sectionName = sectionNameOf(item.sectionKey);
    const flag = t(FLAG_LABEL_KEYS[item.flag]);
    if (item.kind === "entry") {
      const entryName = item.entryLabel || t("pagination.breaks.unknownEntry");
      return `${sectionName} · ${entryName} · ${flag}`;
    }
    return `${sectionName} · ${flag}`;
  };

  return (
    <Flex vertical gap={8} className="resume-section-pagination">
      <div className="resume-section-pagination-head">
        <Typography.Text type="secondary" className="resume-section-pagination-hint">
          {t("structure.pagination.hint")}
        </Typography.Text>
        {onSwitchToExactPreview ? (
          <Tooltip
            title={
              previewMode === "exact"
                ? t("pagination.exactPreview.already")
                : t("pagination.exactPreview.hint")
            }
          >
            <Button
              size="small"
              disabled={previewMode === "exact" || disabled || undefined}
              onClick={onSwitchToExactPreview}
            >
              {t("pagination.exactPreview.switch")}
            </Button>
          </Tooltip>
        ) : null}
      </div>

      <Flex vertical gap={4} className="resume-section-pagination-sections">
        {document.sections.map((section) => {
          const name = sectionDisplayLabel(section);
          return (
            <Flex
              key={section.key}
              align="center"
              justify="space-between"
              gap={8}
              wrap
              className="resume-section-pagination-row"
              data-section-pagination={section.key}
            >
              <span className="resume-section-pagination-name">{name}</span>
              <Flex align="center" gap={12} wrap>
                <Flex align="center" gap={4}>
                  <Typography.Text>{t("pagination.breakBefore")}</Typography.Text>
                  <Switch
                    size="small"
                    checked={section.layout.start_on_new_page}
                    disabled={disabled || undefined}
                    aria-label={t("structure.pagination.sectionAria", { name })}
                    title={t("pagination.breakBefore.hint")}
                    onChange={(checked) =>
                      setSectionFlag(section.key, { start_on_new_page: checked })
                    }
                  />
                </Flex>
                <Flex align="center" gap={4}>
                  <Typography.Text>{t("structure.pagination.keepTogether")}</Typography.Text>
                  <Switch
                    size="small"
                    checked={section.layout.keep_together}
                    disabled={disabled || undefined}
                    aria-label={t("structure.pagination.sectionAria", { name })}
                    title={t("structure.pagination.keepTogetherHint")}
                    onChange={(checked) => setSectionFlag(section.key, { keep_together: checked })}
                  />
                </Flex>
              </Flex>
            </Flex>
          );
        })}
      </Flex>

      <Flex
        vertical
        gap={4}
        className="resume-section-pagination-summary"
        data-pagination-summary="1"
      >
        <Flex align="center" justify="space-between" gap={8} wrap>
          <Typography.Text strong>{t("pagination.breaks.title")}</Typography.Text>
          {canRestore ? (
            <Button
              type="link"
              size="small"
              className="resume-pagination-restore"
              title={t("pagination.breaks.restoreHint")}
              onClick={() => onChange(restoreSectionPagination(document))}
            >
              {t("pagination.breaks.restore")}
            </Button>
          ) : null}
        </Flex>
        {breaks.length === 0 ? (
          <Typography.Text type="secondary" className="resume-section-pagination-hint">
            {t("pagination.breaks.empty")}
          </Typography.Text>
        ) : (
          <>
            <ul className="resume-pagination-break-list">
              {breaks.map((item) => {
                const label = chipLabelOf(item);
                return (
                  <li
                    key={item.id}
                    className="resume-pagination-break-chip"
                    data-break-chip={item.id}
                  >
                    {onJumpToBreak ? (
                      <Tooltip title={t("pagination.breaks.jumpHint")}>
                        <Button
                          type="link"
                          size="small"
                          className="resume-pagination-break-label"
                          onClick={() => onJumpToBreak(item.path)}
                        >
                          {label}
                        </Button>
                      </Tooltip>
                    ) : (
                      <span className="resume-pagination-break-label">{label}</span>
                    )}
                    <Button
                      type="text"
                      size="small"
                      className="resume-pagination-break-clear"
                      aria-label={t("pagination.breaks.clearChip", { label })}
                      onClick={() => clearBreak(item)}
                    >
                      ×
                    </Button>
                  </li>
                );
              })}
            </ul>
            <Typography.Text type="secondary" className="resume-section-pagination-hint">
              {t("pagination.breaks.entryHint")}
            </Typography.Text>
          </>
        )}
      </Flex>
    </Flex>
  );
}
