// SPDX-License-Identifier: Apache-2.0
/**
 * W08 溢出定位：显示后端真 PDF 排版报告（页数/溢出/第一条未显示内容/手动断页/警告），
 * 并把"定位"变成宿主可执行的语义目标（objectId / section / page）。
 *
 * ## 定位复用既有机制
 *
 * `onLocate` 把目标交给宿主：条目/板块走 `pickTarget`（已有点纸面字段定位链路），
 * 页码走 W15 的 `PageNavigator`（fe-delivery 提供）。本组件**不自己滚动 DOM、不新造高亮**。
 *
 * ## 不假装有报告
 *
 * 端点未就绪/请求失败/旧快照都如实显示对应状态；没有报告时不显示任何页数结论。
 */
import { Alert, Button, Flex, Space, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { MessageKey } from "../../../i18n";
import {
  manualBreakLocateTarget,
  truncationLocateTarget,
  type LocateTarget,
  type PaginationReport,
} from "../../../features/resume-pagination/paginationReport";

const KIND_LABEL: Record<string, MessageKey> = {
  section: "pagination.report.kind.section",
  entry: "pagination.report.kind.entry",
  point: "pagination.report.kind.point",
  meta: "pagination.report.kind.meta",
};

interface Props {
  report: PaginationReport | null;
  loading?: boolean;
  error?: string | null;
  /** 报告基于上一版（宿主比对快照后传入）。 */
  stale?: boolean;
  /** 取/重取报告；不传则只读展示（诊断/只读宿主）。 */
  onRefresh?: () => void;
  /** 定位回调（宿主接 pickTarget / PageNavigator）；不传时定位按钮禁用。 */
  onLocate?: (target: LocateTarget) => void;
  /** 板块键 → 显示名（用于手动断页名单）。 */
  sectionLabels?: Record<string, string>;
}

function kindLabel(kind: string): string {
  const key = KIND_LABEL[kind];
  return key ? t(key) : kind;
}

function scopeName(
  item: { objectId?: string | null; section?: string | null },
  sectionLabels: Record<string, string> | undefined,
): string {
  if (item.section && sectionLabels?.[item.section]) return sectionLabels[item.section];
  if (item.section) return item.section;
  return item.objectId ?? "";
}

export default function OverflowLocator({
  report,
  loading = false,
  error = null,
  stale = false,
  onRefresh,
  onLocate,
  sectionLabels,
}: Props) {
  useLocale();
  const truncatedTarget = truncationLocateTarget(report);
  const limit = report?.pageLimit ?? null;
  const pages = report?.pagesNeeded ?? report?.pages ?? null;

  return (
    <section className="resume-pagination-report" aria-label={t("pagination.report.title")}>
      <Flex gap={8} wrap align="center">
        <Typography.Text strong>{t("pagination.report.title")}</Typography.Text>
        {onRefresh ? (
          <Button size="small" loading={loading} onClick={onRefresh}>
            {loading ? t("pagination.report.loading") : t("pagination.report.refresh")}
          </Button>
        ) : null}
      </Flex>

      {error ? (
        <Space size={6}>
          <Typography.Text type="danger">{t("pagination.report.failed")}</Typography.Text>
          {onRefresh ? (
            <Button size="small" onClick={onRefresh}>
              {t("pagination.report.retry")}
            </Button>
          ) : null}
        </Space>
      ) : null}

      {!report && !loading && !error ? (
        <Typography.Text type="secondary">{t("pagination.report.empty")}</Typography.Text>
      ) : null}

      {stale ? (
        <Typography.Text type="warning">{t("pagination.report.stale")}</Typography.Text>
      ) : null}

      {report && pages !== null && limit !== null ? (
        <Typography.Text>{t("pagination.report.pages", { pages, limit })}</Typography.Text>
      ) : null}

      {report?.overflow ? (
        <Alert type="warning" showIcon title={t("pagination.report.overflow")} />
      ) : null}

      {report?.truncatedAt ? (
        <Space size={8} wrap>
          <Typography.Text type="warning">
            {t("pagination.report.truncated", {
              preview: report.truncatedAt.textPreview || kindLabel(report.truncatedAt.kind),
            })}
          </Typography.Text>
          <Tooltip title={onLocate && truncatedTarget ? undefined : t("pagination.report.empty")}>
            <Button
              size="small"
              disabled={!onLocate || !truncatedTarget}
              onClick={() => {
                if (onLocate && truncatedTarget) onLocate(truncatedTarget);
              }}
            >
              {t("pagination.report.locate")}
            </Button>
          </Tooltip>
        </Space>
      ) : null}

      {report && report.manualBreaks.length > 0 ? (
        <Flex vertical gap={2}>
          <Typography.Text strong>{t("pagination.report.manualBreaks")}</Typography.Text>
          {report.manualBreaks.map((item, index) => {
            const target = manualBreakLocateTarget(item);
            return (
              <Space key={`${index}-${item.page ?? ""}`} size={8} wrap>
                <Typography.Text type="secondary">
                  {t("pagination.report.manualBreak", {
                    page: item.page ?? "?",
                    name: scopeName(item, sectionLabels),
                  })}
                </Typography.Text>
                <Button
                  size="small"
                  disabled={!onLocate || !target}
                  onClick={() => {
                    if (onLocate && target) onLocate(target);
                  }}
                >
                  {t("pagination.report.locate")}
                </Button>
              </Space>
            );
          })}
        </Flex>
      ) : null}

      {report && report.warnings.length > 0 ? (
        <Flex vertical gap={2}>
          <Typography.Text strong>{t("pagination.report.warnings")}</Typography.Text>
          {report.warnings.map((warning, index) => (
            <Typography.Text key={`${warning.code}-${index}`} type="secondary">
              {warning.detail || warning.code}
            </Typography.Text>
          ))}
        </Flex>
      ) : null}
    </section>
  );
}
