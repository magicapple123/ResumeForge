// SPDX-License-Identifier: Apache-2.0
/**
 * 采集批次的两张账目 Alert：「未生效条件」/「站点侧筛选」，
 * 以及可选的「翻页提前停止」说明。
 *
 * 纯展示组件——账目由 collectTaskSummary.ts 从 task.config 解析后经 props 传入。
 */
import { Alert, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { SiteFilterSummary } from "./collectTaskSummary";

interface Props {
  unmapped: string[];
  siteFiltered: SiteFilterSummary | null;
  /** 翻页提前停止的页码（0/缺省 = 没有触发）。 */
  paginationStoppedAt?: number;
}

export default function CollectOutcomeAlerts({
  unmapped,
  siteFiltered,
  paginationStoppedAt = 0,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后账目停在旧文案。
  useLocale();
  const separator = t("applyCollect.outcome.listSeparator");
  return (
    <div className="apply-collect-outcomes">
      {paginationStoppedAt > 0 && (
        <Alert
          className="apply-collect-pagination"
          type="info"
          showIcon
          title={t("applyCollect.outcome.pagination.title", { page: paginationStoppedAt })}
          description={t("applyCollect.outcome.pagination.description")}
        />
      )}
      {unmapped.length > 0 && (
        <Alert
          className="apply-collect-unmapped"
          type="warning"
          showIcon
          title={t("applyCollect.outcome.unmapped.title")}
          description={
            <Typography.Paragraph style={{ marginBottom: 0 }}>
              {t("applyCollect.outcome.unmapped.description", {
                conditions: unmapped.join(separator),
              })}
            </Typography.Paragraph>
          }
        />
      )}

      {/* 站点侧筛选的账目：**哪几条真的生效了**，以及**哪几条没能生效**。后端早就把这两笔账
          写进了批次配置，一直没在界面上露面——那等于记了账不给看。 */}
      {siteFiltered && (
        <Alert
          className="apply-collect-site-filtered"
          type={siteFiltered.unapplied.length > 0 ? "warning" : "success"}
          showIcon
          title={
            siteFiltered.applied.length > 0
              ? t("applyCollect.outcome.siteFiltered.appliedTitle", {
                  conditions: siteFiltered.applied.join(separator),
                })
              : t("applyCollect.outcome.siteFiltered.unappliedTitle")
          }
          description={
            siteFiltered.unapplied.length > 0 ? (
              <Typography.Text type="danger">
                {t("applyCollect.outcome.siteFiltered.unappliedDescription", {
                  conditions: siteFiltered.unapplied.join(separator),
                })}
              </Typography.Text>
            ) : (
              <Typography.Text type="secondary">
                {t("applyCollect.outcome.siteFiltered.appliedDescription")}
              </Typography.Text>
            )
          }
        />
      )}
    </div>
  );
}
